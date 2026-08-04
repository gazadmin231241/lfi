import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureTaskWorktree, fastForwardFromOrigin } from "../src/git.js";
import { runCommand } from "../src/process.js";

const gitIn = async (cwd: string, ...args: string[]) => {
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
};

/** A repository with an `origin` that is one commit ahead of the local clone. */
const repoBehindOrigin = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "lfi-origin-refresh-"));
  const origin = join(root, "origin.git");
  const clone = join(root, "clone");
  const seed = join(root, "seed");
  await gitIn(root, "init", "--bare", "-b", "main", origin);
  await gitIn(root, "clone", origin, seed);
  await gitIn(seed, "config", "user.name", "LFI Test");
  await gitIn(seed, "config", "user.email", "lfi@example.test");
  await writeFile(join(seed, "tracked.txt"), "base\n");
  await gitIn(seed, "add", "tracked.txt");
  await gitIn(seed, "commit", "-m", "test: initialize repository");
  await gitIn(seed, "push", "origin", "main");
  await gitIn(root, "clone", origin, clone);
  await gitIn(clone, "config", "user.name", "LFI Test");
  await gitIn(clone, "config", "user.email", "lfi@example.test");
  await writeFile(join(seed, "tracked.txt"), "upstream\n");
  await gitIn(seed, "commit", "-am", "test: advance origin");
  await gitIn(seed, "push", "origin", "main");
  return clone;
};

test("a clean worktree behind origin fast-forwards", async () => {
  const clone = await repoBehindOrigin();

  assert.deepEqual(await fastForwardFromOrigin(clone, "main"), {
    outcome: "fast-forwarded",
    branch: "main",
  });
  assert.equal(
    await gitIn(clone, "log", "-1", "--format=%s"),
    "test: advance origin",
  );
});

test("an unreachable origin leaves the worktree usable instead of failing the run", async () => {
  const clone = await repoBehindOrigin();
  const head = await gitIn(clone, "rev-parse", "HEAD");
  await gitIn(clone, "remote", "set-url", "origin", join(clone, "missing.git"));

  assert.deepEqual(await fastForwardFromOrigin(clone, "main"), {
    outcome: "skipped",
    branch: "main",
    reason: "fetch-failed",
  });
  assert.equal(await gitIn(clone, "rev-parse", "HEAD"), head);
});

test("uncommitted work is never refreshed away", async () => {
  const clone = await repoBehindOrigin();
  const head = await gitIn(clone, "rev-parse", "HEAD");
  await writeFile(join(clone, "tracked.txt"), "work in progress\n");

  assert.deepEqual(await fastForwardFromOrigin(clone, "main"), {
    outcome: "skipped",
    branch: "main",
    reason: "dirty",
  });
  assert.equal(await gitIn(clone, "rev-parse", "HEAD"), head);
  assert.equal(
    await gitIn(clone, "show", ":tracked.txt"),
    "base",
  );
});

test("a diverged branch keeps its unpushed commits", async () => {
  const clone = await repoBehindOrigin();
  await writeFile(join(clone, "local.txt"), "local\n");
  await gitIn(clone, "add", "local.txt");
  await gitIn(clone, "commit", "-m", "test: unpushed local work");
  const head = await gitIn(clone, "rev-parse", "HEAD");

  assert.deepEqual(await fastForwardFromOrigin(clone, "main"), {
    outcome: "skipped",
    branch: "main",
    reason: "diverged",
  });
  assert.equal(await gitIn(clone, "rev-parse", "HEAD"), head);
});

test("a failed worktree setup is retried when the worktree is reused", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-worktree-setup-retry-"));
  await gitIn(root, "init", "-b", "main");
  await gitIn(root, "config", "user.name", "LFI Test");
  await gitIn(root, "config", "user.email", "lfi@example.test");
  await writeFile(join(root, "tracked.txt"), "base\n");
  await gitIn(root, "add", "tracked.txt");
  await gitIn(root, "commit", "-m", "test: initialize repository");
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const worktreeOptions = {
    repoRoot: root,
    worktreesRoot,
    taskKey: "retry",
    baseRef: "main",
    gitDirectory: join(root, ".git"),
    isolationProvider: "none",
  } as const;

  await assert.rejects(
    ensureTaskWorktree({ ...worktreeOptions, setupCommand: "exit 1" }),
    /Worktree setup failed/,
  );

  const retried = await ensureTaskWorktree({
    ...worktreeOptions,
    setupCommand: "printf ok > setup-ran.txt",
  });
  assert.equal(retried.created, false);
  assert.equal(
    await readFile(join(worktreesRoot, "retry", "setup-ran.txt"), "utf8"),
    "ok",
  );

  // The marker written by the successful retry prevents further setup runs.
  const reused = await ensureTaskWorktree({
    ...worktreeOptions,
    setupCommand: "exit 1",
  });
  assert.equal(reused.created, false);
});

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
