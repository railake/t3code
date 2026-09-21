import { assert, describe, it } from "@effect/vitest";

import {
  findForkIdentityProblems,
  findMacZipArtifact,
  planUpdate,
  selectBackupsToPrune,
} from "./fork-update.ts";

const intactSources = {
  buildScript: 'const DESKTOP_APP_ID = "com.t3tools.t3code.railake";',
  statePaths: 'input.joinPath(input.homeDirectory, input.isDevelopment ? ".t3" : ".t3-railake")',
  environment: 'const userDataDirName = isDevelopment ? "t3code-dev" : "t3code-railake";',
};

describe("planUpdate", () => {
  it("merges when upstream has commits the branch lacks", () => {
    const plan = planUpdate({
      head: "a",
      upstreamAlreadyMerged: false,
      installedCommit: "a",
      force: false,
    });
    assert.deepStrictEqual(plan, {
      kind: "rebuild",
      merge: true,
      reason: "upstream has new commits",
    });
  });

  it("rebuilds without merging when local fork commits moved the branch", () => {
    const plan = planUpdate({
      head: "b",
      upstreamAlreadyMerged: true,
      installedCommit: "a",
      force: false,
    });
    assert.strictEqual(plan.kind === "rebuild" && !plan.merge, true);
  });

  it("rebuilds when nothing records what is installed", () => {
    const plan = planUpdate({
      head: "a",
      upstreamAlreadyMerged: true,
      installedCommit: null,
      force: false,
    });
    assert.strictEqual(plan.kind, "rebuild");
  });

  it("does nothing when the installed build matches the branch unless forced", () => {
    const input = { head: "a", upstreamAlreadyMerged: true, installedCommit: "a" };
    assert.strictEqual(planUpdate({ ...input, force: false }).kind, "up-to-date");
    assert.strictEqual(planUpdate({ ...input, force: true }).kind, "rebuild");
  });
});

describe("findForkIdentityProblems", () => {
  it("accepts the fork identity", () => {
    assert.deepStrictEqual(findForkIdentityProblems(intactSources), []);
  });

  it("reports an upstream merge that restores the official identity", () => {
    const problems = findForkIdentityProblems({
      buildScript: 'const DESKTOP_APP_ID = "com.t3tools.t3code";',
      statePaths: 'input.joinPath(input.homeDirectory, ".t3")',
      environment: 'const userDataDirName = isDevelopment ? "t3code-dev" : "t3code";',
    });
    assert.strictEqual(problems.length, 3);
  });
});

describe("findMacZipArtifact", () => {
  it("picks the arm64 ZIP over the DMG and blockmaps", () => {
    const entries = [
      "T3-Code-0.0.42-arm64.dmg",
      "T3-Code-0.0.42-arm64.zip.blockmap",
      "T3-Code-0.0.42-arm64.zip",
      "builder-debug.yml",
    ];
    assert.strictEqual(findMacZipArtifact(entries), "T3-Code-0.0.42-arm64.zip");
    assert.strictEqual(findMacZipArtifact(["T3-Code-0.0.42-arm64.dmg"]), null);
  });
});

describe("selectBackupsToPrune", () => {
  it("prunes the oldest snapshots and ignores other backups", () => {
    const entries = [
      "state-2026-09-03T00-00-00-000Z-pre-update.sqlite",
      "T3 Code (railake).app",
      "state-2026-09-01T00-00-00-000Z-pre-update.sqlite",
      "state-2026-09-02T00-00-00-000Z-pre-rollback.sqlite",
    ];
    assert.deepStrictEqual(selectBackupsToPrune(entries, 2), [
      "state-2026-09-01T00-00-00-000Z-pre-update.sqlite",
    ]);
    assert.deepStrictEqual(selectBackupsToPrune(entries, 5), []);
  });
});
