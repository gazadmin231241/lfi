import type { LfiConfig } from "./config.js";
import {
  createIntegrationWorktree,
  git,
  gitResult,
  removeWorktreeAndBranch,
} from "./git.js";
import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";
import type { Attempt } from "./runner-types.js";
import { mergeWithAgent, validateIntegration } from "./runner-support.js";

export const integrateAttempts = async (options: {
  cwd: string;
  worktreesRoot: string;
  baseRef: string;
  baseBranch: string;
  runId: string;
  stage: number;
  attempts: Attempt[];
  config: LfiConfig;
  gitDirectory: string;
  logsDirectory: string;
  language: Language;
}): Promise<{ sha: string; preserveIntegration: boolean }> => {
  const integration = await createIntegrationWorktree({
    repoRoot: options.cwd,
    worktreesRoot: options.worktreesRoot,
    baseRef: options.baseRef,
    runId: `${options.runId}-${options.stage}`,
  });
  let preserveIntegration = false;
  try {
    for (const attempt of options.attempts) {
      const merge = await gitResult(integration.path, [
        "merge",
        attempt.branch,
        "--no-edit",
      ]);
      if (merge.exitCode !== 0) {
        await mergeWithAgent({
          cwd: integration.path,
          context: `Merge ${attempt.branch} for ${attempt.issue.id}.\n${attempt.issue.body}`,
          config: options.config,
          gitDirectory: options.gitDirectory,
          logsDirectory: options.logsDirectory,
          logName: `merge-${attempt.issue.id}-${options.stage}`,
          language: options.language,
        });
      }
    }
    await validateIntegration({
      cwd: integration.path,
      config: options.config,
      language: options.language,
      repair: () =>
        mergeWithAgent({
          cwd: integration.path,
          context: "Combined validation failed.",
          config: options.config,
          gitDirectory: options.gitDirectory,
          logsDirectory: options.logsDirectory,
          logName: `merge-validation-${options.stage}`,
          language: options.language,
        }),
    });
    if (options.config.TASK_SOURCE === "github") {
      await git(integration.path, [
        "push",
        "origin",
        `HEAD:${options.baseBranch}`,
      ]);
    } else {
      const merge = await gitResult(options.cwd, [
        "merge",
        integration.branch,
        "--no-edit",
      ]);
      if (merge.exitCode !== 0) {
        preserveIntegration = true;
        throw new Error(
          localize(
            options.language,
            `Could not merge validated work into the current branch. Preserved ${integration.branch} at ${integration.path}. Resolve local changes and run: git merge ${integration.branch}`,
            `Не удалось слить проверенную работу в текущую ветку. ${integration.branch} сохранена в ${integration.path}. Разберите локальные изменения и выполните: git merge ${integration.branch}`,
          ),
        );
      }
    }
    return {
      sha: (await git(integration.path, ["rev-parse", "HEAD"])).stdout.trim(),
      preserveIntegration,
    };
  } finally {
    if (!preserveIntegration) {
      await removeWorktreeAndBranch({
        repoRoot: options.cwd,
        path: integration.path,
        branch: integration.branch,
      }).catch(() => undefined);
    }
  }
};
