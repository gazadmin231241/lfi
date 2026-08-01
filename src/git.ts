import { access, mkdir, rm } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

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

export const commitWorktreeChanges = async (
  cwd: string,
  message: string,
): Promise<void> => {
  if (await worktreeClean(cwd)) return;
  const unmerged = (
    await git(cwd, ["diff", "--name-only", "--diff-filter=U"])
  ).stdout.trim();
  if (unmerged) {
    throw new Error(
      `Unresolved merge conflicts remain / Остались неразрешённые конфликты слияния:\n${unmerged}`,
    );
  }
  await git(cwd, ["add", "--all"]);
  const stagedCheck = await gitResult(cwd, ["diff", "--cached", "--check"]);
  const stagedDiagnostics = `${stagedCheck.stdout}${stagedCheck.stderr}`;
  if (stagedDiagnostics.includes("leftover conflict marker")) {
    throw new Error(
      `Unresolved merge conflict markers remain / Остались маркеры неразрешённых конфликтов слияния:\n${stagedDiagnostics.trim()}`,
    );
  }
  await git(cwd, ["commit", "-m", message]);
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
