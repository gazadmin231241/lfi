import { access, mkdir, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { requireCommand, runCommand, runShell } from "./process.js";

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

export const gitCommonDirectory = async (cwd: string): Promise<string> => {
  const value = (await git(cwd, ["rev-parse", "--git-common-dir"])).stdout.trim();
  return isAbsolute(value) ? value : resolve(cwd, value);
};

export const ensureIssueWorktree = async (options: {
  repoRoot: string;
  worktreesRoot: string;
  issueNumber: number;
  baseBranch: string;
  setupCommand: string;
}): Promise<{ path: string; branch: string; created: boolean }> => {
  const path = join(options.worktreesRoot, `issue-${options.issueNumber}`);
  const branch = `lfi/issue-${options.issueNumber}`;
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
          `origin/${options.baseBranch}`,
        ],
  );
  if (options.setupCommand) {
    const setup = await runShell(options.setupCommand, { cwd: path });
    if (setup.exitCode !== 0) {
      throw new Error(`Worktree setup failed:\n${setup.stderr || setup.stdout}`);
    }
  }
  return { path, branch, created: true };
};

export const createIntegrationWorktree = async (options: {
  repoRoot: string;
  worktreesRoot: string;
  baseBranch: string;
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
    `origin/${options.baseBranch}`,
  ]);
  return { path, branch };
};

export const worktreeClean = async (cwd: string): Promise<boolean> =>
  (await git(cwd, ["status", "--porcelain"])).stdout.trim() === "";

export const commitsAhead = async (
  cwd: string,
  baseBranch: string,
): Promise<number> =>
  Number(
    (
      await git(cwd, [
        "rev-list",
        "--count",
        `origin/${baseBranch}..HEAD`,
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
