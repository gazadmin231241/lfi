import { join } from "node:path";

import {
  isUnavailableModelError,
  runCodex,
} from "./codex.js";
import {
  resolveWorkerModel,
  type LfiConfig,
} from "./config.js";
import {
  commitWorktreeChanges,
  commitsAhead,
  ensureIssueWorktree,
  gitResult,
  worktreeClean,
} from "./git.js";
import type { Language } from "./i18n.js";
import type { RunLogContext } from "./logs.js";
import { renderWorkerPrompt } from "./prompts.js";
import type { Attempt, WorkItem } from "./runner-types.js";
import { mergeWithAgent } from "./runner-support.js";
import { evaluateWorkerResult } from "./worker-result.js";

export const attemptWork = async (options: {
  cwd: string;
  worktreesRoot: string;
  baseRef: string;
  issue: WorkItem;
  config: LfiConfig;
  gitDirectory: string;
  log: RunLogContext;
  taskTemplate: string;
  language: Language;
}): Promise<Attempt> => {
  const key =
    options.config.TASK_SOURCE === "local"
      ? options.issue.id.toLowerCase()
      : `issue-${options.issue.number}`;
  const logName = options.config.TASK_SOURCE === "local" ? options.issue.id : key;
  const model = resolveWorkerModel(
    options.config,
    options.issue.executionTier ?? "standard",
  );
  try {
    const worktree = await ensureIssueWorktree({
      repoRoot: options.cwd,
      worktreesRoot: options.worktreesRoot,
      issueNumber: options.issue.number,
      workItem: key,
      baseRef: options.baseRef,
      setupCommand: options.config.WORKTREE_SETUP_COMMAND,
    });
    if (!worktree.created) {
      const update = await gitResult(worktree.path, [
        "merge",
        options.baseRef,
        "--no-edit",
      ]);
      if (update.exitCode !== 0) {
        await mergeWithAgent({
          cwd: worktree.path,
          context: `Update ${options.issue.id} from ${options.baseRef}.`,
          config: options.config,
          gitDirectory: options.gitDirectory,
          log: options.log,
          logName: "integration",
          language: options.language,
        });
      }
    }
    const codex = await runCodex({
      cwd: worktree.path,
      prompt: renderWorkerPrompt(
        options.taskTemplate,
        options.issue,
        options.language,
      ),
      model,
      reasoning: options.config.CODEX_REASONING_EFFORT,
      gitDirectory: options.gitDirectory,
      log: options.log,
      logName,
      idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
      prefix: key,
    });
    if (codex.exitCode === 0 && codex.status === "completed") {
      await commitWorktreeChanges(
        worktree.path,
        `feat(lfi): implement ${options.issue.id}`,
      );
    }
    const evaluation = evaluateWorkerResult({
      processExitCode: codex.exitCode,
      status: codex.status,
      commitsAhead: await commitsAhead(worktree.path, options.baseRef),
      worktreeClean: await worktreeClean(worktree.path),
    });
    return {
      issue: options.issue,
      accepted: evaluation.accepted,
      summary: evaluation.accepted
        ? codex.summary
        : `${codex.summary}\n${evaluation.reasons.join(", ")}`,
      worktreePath: worktree.path,
      branch: worktree.branch,
      logName,
      ...(codex.exitCode !== 0 &&
      model &&
      isUnavailableModelError(codex.summary)
        ? { unavailableModel: model }
        : {}),
    };
  } catch (error) {
    return {
      issue: options.issue,
      accepted: false,
      summary: error instanceof Error ? error.message : String(error),
      worktreePath: join(options.worktreesRoot, key),
      branch: `lfi/${key}`,
    };
  }
};
