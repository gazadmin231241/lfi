import { access, mkdir, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

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
  if (await exists(path)) return { path, branch, created: false };
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
  if (options.setupCommand) {
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
  }
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
};
