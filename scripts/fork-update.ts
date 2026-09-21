#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off globalConsole:off - Host-side operator script that drives git, the build, and /Applications directly.
// Keeps the installed T3 Code (railake).app current with upstream without an
// Apple Developer ID. Squirrel.Mac only installs updates signed like the running
// app, and ad-hoc builds never are, so instead this merges upstream/main into
// the current branch, rebuilds, and swaps the app in /Applications.
//
//   node scripts/fork-update.ts            merge, build, install if anything changed
//   node scripts/fork-update.ts --force    rebuild and reinstall even when current
//   node scripts/fork-update.ts rollback   restore the previous app and its database
//
// The app swap runs in a detached process so this works from a terminal inside
// the app it replaces. Progress goes to ~/.t3-railake/fork-update.log.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import {
  FORK_APP_NAME,
  FORK_BUNDLE_ID,
  FORK_HOME_DIR_NAME,
  findForkIdentityProblems,
  findMacZipArtifact,
  planUpdate,
  selectBackupsToPrune,
} from "./lib/fork-update.ts";

const SNAPSHOTS_TO_KEEP = 5;
const QUIT_TIMEOUT_MS = 60_000;

const forkHome = NodePath.join(NodeOS.homedir(), FORK_HOME_DIR_NAME);
const logPath = NodePath.join(forkHome, "fork-update.log");
const statePath = NodePath.join(forkHome, "fork-update-state.json");
const lockPath = NodePath.join(forkHome, "fork-update.lock");
const backupsDir = NodePath.join(forkHome, "backups");
const databasePath = NodePath.join(forkHome, "userdata", "state.sqlite");
const appPath = NodePath.join("/Applications", `${FORK_APP_NAME}.app`);
const previousAppPath = NodePath.join(backupsDir, `${FORK_APP_NAME}.app`);
const scriptPath = NodeURL.fileURLToPath(import.meta.url);

interface InstallState {
  readonly installedCommit: string;
  readonly installedAt: string;
  readonly previousCommit: string | null;
  readonly snapshotPath: string | null;
}

class UpdateError extends Error {}

// ELECTRON_RUN_AS_NODE leaks in from T3 Code terminals and turns Electron into
// plain Node. The feed variables would bake an update feed into an unsigned app
// that can download updates but never install them.
const childEnv: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !["ELECTRON_RUN_AS_NODE", "T3CODE_DESKTOP_UPDATE_REPOSITORY", "GITHUB_REPOSITORY"].includes(
          key,
        ),
    ),
  ),
  PATH: [NodePath.join(NodeOS.homedir(), ".cargo", "bin"), process.env.PATH ?? ""].join(
    NodePath.delimiter,
  ),
};

function log(message: string, options: { readonly quiet?: boolean } = {}): void {
  NodeFS.mkdirSync(forkHome, { recursive: true });
  NodeFS.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  if (!options.quiet) console.log(message);
}

function notify(message: string): void {
  NodeChildProcess.spawnSync(
    "osascript",
    [
      "-e",
      "on run argv",
      "-e",
      "display notification (item 1 of argv) with title (item 2 of argv)",
      "-e",
      "end run",
      message,
      `${FORK_APP_NAME} update`,
    ],
    { env: childEnv },
  );
}

function capture(command: string, args: readonly string[], cwd?: string): string {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd,
    env: childEnv,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new UpdateError(
      `${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result.stdout.trim();
}

function succeeds(command: string, args: readonly string[], cwd?: string): boolean {
  return (
    NodeChildProcess.spawnSync(command, args, { cwd, env: childEnv, stdio: "ignore" }).status === 0
  );
}

/** Runs a command, streaming its output to the terminal and the log. */
function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  log(`$ ${command} ${args.join(" ")}`);
  const logFile = NodeFS.openSync(logPath, "a");
  return new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const forward = (target: NodeJS.WriteStream) => (chunk: Buffer) => {
      target.write(chunk);
      NodeFS.writeSync(logFile, chunk);
    };
    child.stdout.on("data", forward(process.stdout));
    child.stderr.on("data", forward(process.stderr));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new UpdateError(`${command} ${args.join(" ")} exited with code ${code}`)),
    );
  }).finally(() => NodeFS.closeSync(logFile));
}

function readState(): InstallState | null {
  try {
    return JSON.parse(NodeFS.readFileSync(statePath, "utf8")) as InstallState;
  } catch {
    return null;
  }
}

function writeState(state: InstallState): void {
  NodeFS.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function withLock<T>(action: () => Promise<T>): Promise<T> {
  NodeFS.mkdirSync(forkHome, { recursive: true });
  try {
    NodeFS.mkdirSync(lockPath);
  } catch {
    throw new UpdateError(`Another fork update is running (remove ${lockPath} if it is stale).`);
  }
  return action().finally(() => NodeFS.rmSync(lockPath, { recursive: true, force: true }));
}

function spawnDetached(args: readonly string[]): void {
  NodeChildProcess.spawn(process.execPath, [scriptPath, ...args], {
    detached: true,
    stdio: "ignore",
    env: childEnv,
  }).unref();
}

// --- Build ------------------------------------------------------------------

function assertForkIdentity(repo: string): void {
  const read = (file: string) => NodeFS.readFileSync(NodePath.join(repo, file), "utf8");
  const problems = findForkIdentityProblems({
    buildScript: read("scripts/build-desktop-artifact.ts"),
    statePaths: read("apps/desktop/src/app/DesktopStatePaths.ts"),
    environment: read("apps/desktop/src/app/DesktopEnvironment.ts"),
  });
  if (problems.length > 0) {
    throw new UpdateError(`The merge broke the fork identity:\n- ${problems.join("\n- ")}`);
  }
}

async function buildStagedApp(repo: string, options: { readonly skipChecks: boolean }) {
  const vp = NodePath.join(repo, "node_modules", ".bin", "vp");
  await run(NodeFS.existsSync(vp) ? vp : "vp", ["i"], repo);
  if (!options.skipChecks) {
    for (const app of ["desktop", "server", "web"]) {
      await run(vp, ["run", "typecheck"], NodePath.join(repo, "apps", app));
    }
  }

  const workDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-fork-update-"));
  const outputDir = NodePath.join(workDir, "release");
  await run(
    process.execPath,
    [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      "--arch",
      "arm64",
      "--output-dir",
      outputDir,
    ],
    repo,
  );

  const zip = findMacZipArtifact(NodeFS.readdirSync(outputDir));
  if (zip === null) throw new UpdateError(`The build produced no arm64 ZIP in ${outputDir}.`);
  const stagedApp = NodePath.join(workDir, `${FORK_APP_NAME}.app`);
  capture("ditto", ["-x", "-k", NodePath.join(outputDir, zip), workDir]);

  const bundleId = capture("plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    NodePath.join(stagedApp, "Contents", "Info.plist"),
  ]);
  if (bundleId !== FORK_BUNDLE_ID) {
    throw new UpdateError(`The built app has bundle ID ${bundleId}, expected ${FORK_BUNDLE_ID}.`);
  }
  return { workDir, stagedApp };
}

async function update(options: { readonly force: boolean; readonly skipChecks: boolean }) {
  const repo = capture("git", ["rev-parse", "--show-toplevel"]);
  const branch = NodeChildProcess.spawnSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).stdout.trim();
  if (branch === "" || branch === "main") {
    throw new UpdateError("Run this on the fork's working branch, not main or a detached HEAD.");
  }
  if (capture("git", ["status", "--porcelain", "--untracked-files=no"], repo) !== "") {
    throw new UpdateError("Commit or set aside tracked changes before updating.");
  }

  await run("git", ["fetch", "upstream", "main"], repo);
  const startCommit = capture("git", ["rev-parse", "HEAD"], repo);
  const plan = planUpdate({
    head: startCommit,
    upstreamAlreadyMerged: succeeds(
      "git",
      ["merge-base", "--is-ancestor", "upstream/main", "HEAD"],
      repo,
    ),
    installedCommit: readState()?.installedCommit ?? null,
    force: options.force,
  });
  if (plan.kind === "up-to-date") {
    log(`${FORK_APP_NAME} is already built from ${branch} at ${startCommit.slice(0, 9)}.`);
    return;
  }
  log(`Updating ${branch}: ${plan.reason}.`);

  if (plan.merge) {
    try {
      await run("git", ["merge", "--no-edit", "upstream/main"], repo);
    } catch (error) {
      succeeds("git", ["merge", "--abort"], repo);
      throw new UpdateError(`Merging upstream/main into ${branch} conflicts; merge it by hand.`, {
        cause: error,
      });
    }
  }

  let staged: { readonly workDir: string; readonly stagedApp: string };
  try {
    assertForkIdentity(repo);
    staged = await buildStagedApp(repo, options);
  } catch (error) {
    if (plan.merge) {
      capture("git", ["reset", "--hard", startCommit], repo);
      log(`Restored ${branch} to ${startCommit.slice(0, 9)}.`);
    }
    throw error;
  }

  const commit = capture("git", ["rev-parse", "HEAD"], repo);
  spawnDetached(["install", staged.stagedApp, "--commit", commit]);
  log(`Built ${commit.slice(0, 9)}. Installing in the background; see ${logPath}.`);
}

// --- Install and rollback (detached) ----------------------------------------

function isAppRunning(): boolean {
  return capture("osascript", ["-e", `application id "${FORK_BUNDLE_ID}" is running`]) === "true";
}

async function quitApp(): Promise<boolean> {
  if (!isAppRunning()) return false;
  capture("osascript", ["-e", `tell application id "${FORK_BUNDLE_ID}" to quit`]);
  const deadline = Date.now() + QUIT_TIMEOUT_MS;
  while (isAppRunning()) {
    if (Date.now() > deadline) throw new UpdateError(`${FORK_APP_NAME} did not quit.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return true;
}

function snapshotDatabase(label: string): string | null {
  if (!NodeFS.existsSync(databasePath)) return null;
  NodeFS.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  const snapshotPath = NodePath.join(backupsDir, `state-${stamp}-${label}.sqlite`);
  const database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
  for (const entry of selectBackupsToPrune(NodeFS.readdirSync(backupsDir), SNAPSHOTS_TO_KEEP)) {
    NodeFS.rmSync(NodePath.join(backupsDir, entry), { force: true });
  }
  return snapshotPath;
}

function restoreDatabase(snapshotPath: string): void {
  for (const suffix of ["-wal", "-shm"]) NodeFS.rmSync(`${databasePath}${suffix}`, { force: true });
  NodeFS.copyFileSync(snapshotPath, databasePath);
}

/** Moves `from` to `to`, replacing `to`. */
function moveApp(from: string, to: string): void {
  NodeFS.rmSync(to, { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true });
  capture("mv", [from, to]);
}

async function install(stagedApp: string, commit: string): Promise<void> {
  const wasRunning = await quitApp();
  try {
    const snapshotPath = snapshotDatabase("pre-update");
    if (NodeFS.existsSync(appPath)) moveApp(appPath, previousAppPath);
    capture("ditto", [stagedApp, appPath]);
    NodeChildProcess.spawnSync("xattr", ["-dr", "com.apple.quarantine", appPath]);
    writeState({
      installedCommit: commit,
      installedAt: new Date().toISOString(),
      previousCommit: readState()?.installedCommit ?? null,
      snapshotPath,
    });
    log(`Installed ${commit.slice(0, 9)}; database snapshot ${snapshotPath ?? "skipped"}.`, {
      quiet: true,
    });
    notify(`Updated to ${commit.slice(0, 9)}.`);
  } catch (error) {
    if (!NodeFS.existsSync(appPath) && NodeFS.existsSync(previousAppPath)) {
      moveApp(previousAppPath, appPath);
    }
    throw error;
  } finally {
    NodeFS.rmSync(NodePath.dirname(stagedApp), { recursive: true, force: true });
    if (wasRunning) NodeChildProcess.spawnSync("open", ["-b", FORK_BUNDLE_ID]);
  }
}

async function rollback(): Promise<void> {
  const state = readState();
  if (!NodeFS.existsSync(previousAppPath))
    throw new UpdateError("There is no previous app to restore.");
  const wasRunning = await quitApp();
  try {
    // Keep the current database so rolling back is not a one-way door either.
    const currentSnapshot = snapshotDatabase("pre-rollback");
    const swapPath = `${previousAppPath}.swap`;
    moveApp(appPath, swapPath);
    moveApp(previousAppPath, appPath);
    moveApp(swapPath, previousAppPath);
    if (state?.snapshotPath && NodeFS.existsSync(state.snapshotPath)) {
      restoreDatabase(state.snapshotPath);
    }
    writeState({
      installedCommit: state?.previousCommit ?? "unknown",
      installedAt: new Date().toISOString(),
      previousCommit: state?.installedCommit ?? null,
      snapshotPath: currentSnapshot,
    });
    log(`Rolled back to ${state?.previousCommit?.slice(0, 9) ?? "the previous app"}.`, {
      quiet: true,
    });
    notify("Rolled back to the previous build.");
  } finally {
    if (wasRunning) NodeChildProcess.spawnSync("open", ["-b", FORK_BUNDLE_ID]);
  }
}

// --- CLI --------------------------------------------------------------------

const { positionals, values } = NodeUtil.parseArgs({
  allowPositionals: true,
  options: {
    force: { type: "boolean", default: false },
    "skip-checks": { type: "boolean", default: false },
    commit: { type: "string" },
  },
});

const [command = "update", stagedApp] = positionals;
const detached = command === "install" || command === "apply-rollback";

try {
  if (command === "update") {
    await withLock(() => update({ force: values.force, skipChecks: values["skip-checks"] }));
  } else if (command === "rollback") {
    spawnDetached(["apply-rollback"]);
    console.log(`Rolling back in the background; see ${logPath}.`);
  } else if (command === "install" && stagedApp && values.commit) {
    await install(stagedApp, values.commit);
  } else if (command === "apply-rollback") {
    await rollback();
  } else {
    throw new UpdateError(`Unknown command: ${positionals.join(" ")}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`Failed: ${message}`, { quiet: detached });
  notify(`Failed: ${message.split("\n")[0]}`);
  process.exitCode = 1;
}
