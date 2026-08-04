import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import { withGithubRetry } from "./github-resilience.js";
import { requireCommand, runCommand } from "./process.js";
import type { IsolationProvider } from "./isolation-provider.js";
import { redactSensitiveText } from "./logs.js";
import { runProjectCommand } from "./project-command.js";

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

export const git = (
  cwd: string,
  args: readonly string[],
) => requireCommand("git", args, { cwd });

export const gitResult = (
  cwd: string,
  args: readonly string[],
) => runCommand("git", args, { cwd });

export const commitWorktreeChanges = async (
  cwd: string,
  message: string,
): Promise<boolean> => {
  await git(cwd, ["add", "--all"]);
  const staged = await gitResult(cwd, ["diff", "--cached", "--quiet"]);
  if (staged.exitCode === 0) return false;
  await git(cwd, ["commit", "-m", message]);
  return true;
};

export const localRepoInfo = async (
  cwd: string,
): Promise<{ nameWithOwner: string; defaultBranch: string }> => {
  const branch = await gitResult(cwd, ["branch", "--show-current"]).catch(() => {
    throw new Error(
      "Local mode requires Git. / Для локального режима требуется Git.",
    );
  });
  if (branch.exitCode !== 0) {
    throw new Error(
      "Local mode requires a Git repository. / Для локального режима требуется Git-репозиторий.",
    );
  }
  return {
    nameWithOwner: basename(resolve(cwd)),
    defaultBranch: branch.stdout.trim() || "main",
  };
};

export const gitCommonDirectory = async (cwd: string): Promise<string> => {
  const value = (await git(cwd, ["rev-parse", "--git-common-dir"])).stdout.trim();
  return isAbsolute(value) ? value : resolve(cwd, value);
};

/**
 * Sits next to the worktree, not inside it, so it never dirties `git status`
 * and survives until the worktree itself is removed.
 */
const worktreeSetupMarker = (worktreePath: string): string =>
  `${worktreePath}.setup-complete`;

export const ensureTaskWorktree = async (options: {
  repoRoot: string;
  worktreesRoot: string;
  taskKey: string;
  baseRef: string;
  setupCommand: string;
  gitDirectory: string;
  isolationProvider: IsolationProvider;
}): Promise<{ path: string; branch: string; created: boolean }> => {
  const key = options.taskKey;
  const path = join(options.worktreesRoot, key);
  const branch = `lfi/${key}`;
  const runSetup = async () => {
    if (!options.setupCommand) return;
    const setup = await runProjectCommand({
      command: options.setupCommand,
      cwd: path,
      gitDirectory: options.gitDirectory,
      isolationProvider: options.isolationProvider,
    });
    if (setup.exitCode !== 0) {
      throw new Error(
        `Worktree setup failed:\n${redactSensitiveText(setup.stderr || setup.stdout)}`,
      );
    }
    await writeFile(worktreeSetupMarker(path), "");
  };
  if (await exists(path)) {
    // A worktree without the marker was left behind by a failed setup (or the
    // setup command was added after the worktree was created): retry setup
    // instead of silently reusing a half-prepared environment.
    if (options.setupCommand && !(await exists(worktreeSetupMarker(path)))) {
      await runSetup();
    }
    return { path, branch, created: false };
  }
  await mkdir(options.worktreesRoot, { recursive: true });
  const branchExists =
    (
      await gitResult(options.repoRoot, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${branch}`,
      ])
    ).exitCode === 0;
  await git(
    options.repoRoot,
    branchExists
      ? ["worktree", "add", path, branch]
      : [
          "worktree",
          "add",
          "-b",
          branch,
          path,
          options.baseRef,
        ],
  );
  await runSetup();
  return { path, branch, created: true };
};

export const createIntegrationWorktree = async (options: {
  repoRoot: string;
  worktreesRoot: string;
  baseRef: string;
  runId: string;
}): Promise<{ path: string; branch: string }> => {
  const path = join(options.worktreesRoot, `integration-${options.runId}`);
  const branch = `lfi/integration-${options.runId}`;
  await git(options.repoRoot, [
    "worktree",
    "add",
    "-b",
    branch,
    path,
    options.baseRef,
  ]);
  return { path, branch };
};

export const worktreeClean = async (cwd: string): Promise<boolean> =>
  (await git(cwd, ["status", "--porcelain"])).stdout.trim() === "";

export type OriginRefresh =
  | { outcome: "fast-forwarded"; branch: string }
  | { outcome: "up-to-date"; branch: string }
  | {
      outcome: "skipped";
      branch: string;
      reason: "detached" | "dirty" | "fetch-failed" | "diverged";
    };

export type DefaultBranchReconciliation =
  | { outcome: "up-to-date"; branch: string }
  | { outcome: "fast-forwarded"; branch: string }
  | { outcome: "pushed"; branch: string }
  | { outcome: "push-deferred"; branch: string; note: string }
  | {
      outcome: "blocked";
      branch: string;
      reason: "dirty" | "diverged" | "not-current";
      command: string;
    };

/**
 * Bring the checked-out default branch and its remote copy to the same
 * delivered result when doing so cannot lose local work. The local branch is
 * the source of truth: an unreachable origin defers publication instead of
 * failing, and a branch with commits on both sides is deliberately left
 * untouched for its owner to reconcile.
 */
export const reconcileDefaultBranch = async (
  cwd: string,
  branch: string,
): Promise<DefaultBranchReconciliation> => {
  const current = await gitResult(cwd, ["branch", "--show-current"]);
  const command = `git switch ${branch} && git fetch origin ${branch} && git merge --ff-only origin/${branch}`;
  if (current.exitCode !== 0 || current.stdout.trim() !== branch) {
    return { outcome: "blocked", branch, reason: "not-current", command };
  }
  const fetched = await gitResult(cwd, ["fetch", "origin", branch]);
  const remote = `origin/${branch}`;
  const remoteSha = await gitResult(cwd, ["rev-parse", "--verify", remote]);
  if (remoteSha.exitCode !== 0) return { outcome: "up-to-date", branch };
  const reconciliationCommand = `git merge --ff-only ${remote}`;
  const localIsBehind = await gitResult(cwd, [
    "merge-base",
    "--is-ancestor",
    "HEAD",
    remote,
  ]);
  if (localIsBehind.exitCode === 0) {
    const before = (await git(cwd, ["rev-parse", "HEAD"])).stdout.trim();
    if (before === remoteSha.stdout.trim()) return { outcome: "up-to-date", branch };
    if (!(await worktreeClean(cwd))) {
      return {
        outcome: "blocked",
        branch,
        reason: "dirty",
        command: reconciliationCommand,
      };
    }
    await git(cwd, ["merge", "--ff-only", remote]);
    return { outcome: "fast-forwarded", branch };
  }
  const remoteIsBehind = await gitResult(cwd, [
    "merge-base",
    "--is-ancestor",
    remote,
    "HEAD",
  ]);
  if (remoteIsBehind.exitCode !== 0) {
    return {
      outcome: "blocked",
      branch,
      reason: "diverged",
      command: reconciliationCommand,
    };
  }
  if (fetched.exitCode !== 0) {
    return {
      outcome: "push-deferred",
      branch,
      note: fetched.stderr.trim().split("\n")[0] ?? "origin unreachable",
    };
  }
  try {
    await withGithubRetry(() => git(cwd, ["push", "origin", branch]), {
      attempts: 2,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      outcome: "push-deferred",
      branch,
      note: reason.trim().split("\n")[0] ?? reason,
    };
  }
  return { outcome: "pushed", branch };
};

/**
 * Best-effort refresh of a reused worktree from `origin/<branch>`.
 *
 * Never fails the run: an offline fetch, a diverged branch, a detached HEAD
 * (paused rebase), or uncommitted work all skip the refresh and leave the
 * worktree exactly as it was. `--ff-only` guarantees the refresh can neither
 * create a merge commit nor discard unpushed commits.
 */
export const fastForwardFromOrigin = async (
  cwd: string,
  branch: string,
): Promise<OriginRefresh> => {
  const head = await gitResult(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
  if (head.exitCode !== 0) return { outcome: "skipped", branch, reason: "detached" };
  if (!(await worktreeClean(cwd)))
    return { outcome: "skipped", branch, reason: "dirty" };
  const fetch = await gitResult(cwd, ["fetch", "origin", branch]);
  if (fetch.exitCode !== 0)
    return { outcome: "skipped", branch, reason: "fetch-failed" };
  const before = (await git(cwd, ["rev-parse", "HEAD"])).stdout.trim();
  const merge = await gitResult(cwd, [
    "merge",
    "--ff-only",
    `origin/${branch}`,
  ]);
  if (merge.exitCode !== 0)
    return { outcome: "skipped", branch, reason: "diverged" };
  const after = (await git(cwd, ["rev-parse", "HEAD"])).stdout.trim();
  return { outcome: before === after ? "up-to-date" : "fast-forwarded", branch };
};

export const commitsAhead = async (
  cwd: string,
  baseRef: string,
): Promise<number> =>
  Number(
    (
      await git(cwd, [
        "rev-list",
        "--count",
        `${baseRef}..HEAD`,
      ])
    ).stdout.trim(),
  );

export const removeWorktreeAndBranch = async (options: {
  repoRoot: string;
  path: string;
  branch: string;
}): Promise<void> => {
  await git(options.repoRoot, ["worktree", "remove", "--force", options.path]);
  await gitResult(options.repoRoot, ["branch", "-D", options.branch]);
  await rm(options.path, { recursive: true, force: true });
  await rm(worktreeSetupMarker(options.path), { force: true });
};
