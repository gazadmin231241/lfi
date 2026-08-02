import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureTaskWorktree } from "../src/git.js";
import { runCommand } from "../src/process.js";

test("worktree setup failures redact sensitive output", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-worktree-setup-redaction-"));
  const secret = "github_pat_EXAMPLE_SECRET_123456";
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await writeFile(join(root, "tracked.txt"), "base\n");
  await git("add", "tracked.txt");
  await git("commit", "-m", "test: initialize repository");

  await assert.rejects(
    ensureTaskWorktree({
      repoRoot: root,
      worktreesRoot: join(root, ".lfi", "worktrees"),
      taskKey: "redaction",
      baseRef: "main",
      setupCommand: `printf '%s\\n' '${secret}' >&2; exit 1`,
      gitDirectory: join(root, ".git"),
      isolationProvider: "none",
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("[REDACTED]") &&
      !error.message.includes(secret),
  );
});
