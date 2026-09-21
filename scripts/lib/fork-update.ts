// Pure decisions for scripts/fork-update.ts, kept separate so they can be tested
// without git, a build, or an installed app.

export const FORK_BUNDLE_ID = "com.t3tools.t3code.railake";
export const FORK_HOME_DIR_NAME = ".t3-railake";
export const FORK_APP_NAME = "T3 Code (railake)";

export type UpdatePlan =
  | { readonly kind: "up-to-date" }
  | { readonly kind: "rebuild"; readonly merge: boolean; readonly reason: string };

/**
 * Decides whether a run should merge upstream and whether it needs a rebuild.
 * A rebuild is needed when upstream has new commits, when the branch moved past
 * the installed build (local fork commits), or when forced.
 */
export function planUpdate(input: {
  readonly head: string;
  readonly upstreamAlreadyMerged: boolean;
  readonly installedCommit: string | null;
  readonly force: boolean;
}): UpdatePlan {
  if (!input.upstreamAlreadyMerged) {
    return { kind: "rebuild", merge: true, reason: "upstream has new commits" };
  }
  if (input.installedCommit === null) {
    return { kind: "rebuild", merge: false, reason: "no record of the installed build" };
  }
  if (input.installedCommit !== input.head) {
    return { kind: "rebuild", merge: false, reason: "branch moved since the installed build" };
  }
  if (input.force) {
    return { kind: "rebuild", merge: false, reason: "forced" };
  }
  return { kind: "up-to-date" };
}

export interface ForkIdentitySources {
  readonly buildScript: string;
  readonly statePaths: string;
  readonly environment: string;
}

/**
 * Returns what an upstream merge broke in the fork's packaged identity, or an
 * empty list. Upstream edits to these files can silently point the fork back
 * at the official app's bundle ID and live ~/.t3 database.
 */
export function findForkIdentityProblems(sources: ForkIdentitySources): string[] {
  const problems: string[] = [];
  if (!sources.buildScript.includes(`const DESKTOP_APP_ID = "${FORK_BUNDLE_ID}";`)) {
    problems.push(
      `scripts/build-desktop-artifact.ts no longer sets DESKTOP_APP_ID to ${FORK_BUNDLE_ID}`,
    );
  }
  if (!sources.statePaths.includes(`"${FORK_HOME_DIR_NAME}"`)) {
    problems.push(
      `DesktopStatePaths.ts no longer defaults the packaged home to ~/${FORK_HOME_DIR_NAME}`,
    );
  }
  if (!sources.environment.includes(`"t3code-railake"`)) {
    problems.push(`DesktopEnvironment.ts no longer uses the t3code-railake userData directory`);
  }
  return problems;
}

/** Picks the arm64 mac ZIP out of the build's output directory listing. */
export function findMacZipArtifact(entries: readonly string[]): string | null {
  return entries.find((entry) => entry.endsWith("-arm64.zip")) ?? null;
}

/** Oldest-first backups beyond the newest `keep` entries, for deletion. */
export function selectBackupsToPrune(entries: readonly string[], keep: number): string[] {
  const backups = entries.filter((entry) => /^state-.+\.sqlite$/u.test(entry)).toSorted();
  return backups.slice(0, Math.max(0, backups.length - keep));
}
