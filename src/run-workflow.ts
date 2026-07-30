import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attemptWork } from "./attempt-work.js";
import { mapConcurrent } from "./concurrency.js";
import { loadConfig } from "./config.js";
import { closeIssue, commentFinalFailure, setIssueStatus } from "./github.js";
import { git, gitCommonDirectory, localRepoInfo, removeWorktreeAndBranch } from "./git.js";
import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";
import { integrateAttempts } from "./integration.js";
import { loadLocalTracker, runnableLocalTasks } from "./local-tracker.js";
import { recordLocalCompletion } from "./local-run-state.js";
import { pruneExpiredRunLogs, writeFailureLog } from "./logs.js";
import { isShutdownRequested } from "./process.js";
import { printIntegrationCompleted, printIntegrationFailed, printIntegrationStarted, printIteration, printRunSummary, printValidationStarted, printWorkFinished, printWorkStarted } from "./run-display.js";
import { saveRunSummary } from "./run-history.js";
import { listWork } from "./run-source.js";
import type { Attempt } from "./runner-types.js";
import {
  checkpointTracker,
  readPendingClosures,
  ValidationFailure,
  writePendingClosures,
} from "./runner-support.js";
import { reconcileTrackerFilenames } from "./tracker-files.js";

export const runLfi = async (
  cwd: string,
  language: Language,
  selectedIds: readonly string[] = [],
): Promise<number> => {
  const lfiRoot = join(cwd, ".lfi");
  const config = await loadConfig(join(lfiRoot, "config.env"));
  if (!config.VALIDATE_COMMAND) {
    throw new Error(
      localize(
        language,
        "VALIDATE_COMMAND is empty. Set it in .lfi/config.env before `lfi run`.",
        "VALIDATE_COMMAND пуст. Укажите команду в .lfi/config.env перед `lfi run`.",
      ),
    );
  }
  if (config.TASK_SOURCE === "local") {
    await reconcileTrackerFilenames(
      await loadLocalTracker(lfiRoot),
      new Set(),
    );
    await checkpointTracker(cwd, "docs(lfi): update local task tracker");
    if (selectedIds.length > 0) {
      const tracker = await loadLocalTracker(lfiRoot);
      const blocked = runnableLocalTasks(tracker, selectedIds).blocked;
      for (const task of blocked) {
        const unfinished = task.blockedBy.filter(
          (id) =>
            tracker.tasks.find((candidate) => candidate.id === id)?.status !==
            "completed",
        );
        console.error(
          localize(
            language,
            `${task.id} is blocked by ${unfinished.join(", ")}.`,
            `${task.id} заблокирована задачами ${unfinished.join(", ")}.`,
          ),
        );
      }
    }
  }
  const stateRoot = join(lfiRoot, "state");
  const logsRoot = join(lfiRoot, "logs");
  const worktreesRoot = join(lfiRoot, "worktrees");
  await mkdir(stateRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const runId = startedAt.replaceAll(":", "-");
  const lockPath = join(stateRoot, "run.lock");
  const lock = await open(lockPath, "wx").catch(() => undefined);
  if (!lock) {
    throw new Error(
      localize(
        language,
        "Another LFI run appears to be active.",
        "Похоже, другой запуск LFI всё ещё активен.",
      ),
    );
  }
  await lock.writeFile(`${JSON.stringify({ pid: process.pid, runId })}\n`);
  const currentStatePath = join(stateRoot, "current-run.json");
  const pendingPath = join(stateRoot, "pending-closures.json");
  const completed = new Set<string>();
  const attempted = new Map<string, string>();
  let iterations = 0;
  let pending = await readPendingClosures(pendingPath);
  if (config.TASK_SOURCE === "local") pending = [];
  const branch =
    config.TASK_SOURCE === "local"
      ? (await localRepoInfo(cwd)).defaultBranch
      : config.BASE_BRANCH;
  const baseRef =
    config.TASK_SOURCE === "local" ? branch : `origin/${config.BASE_BRANCH}`;
  const gitDirectory = await gitCommonDirectory(cwd);
  const taskTemplate = await readFile(join(lfiRoot, "task-prompt.md"), "utf8");
  await pruneExpiredRunLogs(logsRoot, {
    retentionDays: config.LOG_RETENTION_DAYS,
    activeRunName: runId,
  });
  try {
    if (config.TASK_SOURCE === "github") {
      const stillPending = [];
      for (const item of pending) {
        try {
          await closeIssue(cwd, item.number, item.sha, language);
        } catch {
          stillPending.push(item);
        }
      }
      pending = stillPending;
      await writePendingClosures(pendingPath, pending);
    }
    for (let stage = 1; stage <= config.MAX_STAGES; stage++) {
      if (config.TASK_SOURCE === "github") {
        await git(cwd, ["fetch", "origin", config.BASE_BRANCH]);
      }
      const runnable = await listWork(cwd, completed, selectedIds);
      await writeFile(
        currentStatePath,
        `${JSON.stringify({
          runId,
          startedAt,
          status: "running",
          stage,
          activeIssues: runnable.map((item) => item.id),
          completed: [...completed],
        }, null, 2)}\n`,
      );
      if (runnable.length === 0) break;
      iterations = stage;
      const log = { directory: logsRoot, startedAt, iteration: stage };
      if (config.TASK_SOURCE === "github") {
        await mapConcurrent(runnable, 3, (issue) =>
          setIssueStatus(cwd, issue.number, "running", issue.title),
        );
      }
      printIteration(language, stage, runnable.map((item) => item.id));
      for (const issue of runnable) printWorkStarted(language, issue.id);
      const attempts = await mapConcurrent(
        runnable,
        config.MAX_PARALLEL,
        (issue) =>
          attemptWork({
            cwd,
            worktreesRoot,
            baseRef,
            issue,
            config,
            gitDirectory,
            log,
            taskTemplate,
            language,
          }),
      );
      for (const attempt of attempts) {
        attempted.set(attempt.issue.id, attempt.summary);
        printWorkFinished(language, attempt.issue.id, attempt.accepted);
      }
      const accepted = attempts.filter((attempt) => attempt.accepted);
      if (accepted.length === 0) continue;
      try {
        printIntegrationStarted(language, accepted.map((attempt) => ({ id: attempt.issue.id, branch: attempt.branch })));
        const result = await integrateAttempts({
          cwd,
          worktreesRoot,
          baseRef,
          baseBranch: config.BASE_BRANCH,
          runId,
          log,
          attempts: accepted,
          config,
          gitDirectory,
          language,
          onValidationStarted: () => printValidationStarted(language),
        });
        printIntegrationCompleted(language, branch);
        if (config.TASK_SOURCE === "local") {
          await recordLocalCompletion(cwd, accepted);
        } else {
          for (const attempt of accepted) {
            pending.push({ number: attempt.issue.number, sha: result.sha });
            await writePendingClosures(pendingPath, pending);
            try {
              await closeIssue(cwd, attempt.issue.number, result.sha, language);
              pending = pending.filter(
                (item) => item.number !== attempt.issue.number,
              );
            } catch {
              console.error(
                localize(
                  language,
                  `Published ${attempt.issue.id}, but closing it failed; the next run will retry.`,
                  `${attempt.issue.id} опубликована, но закрыть её не удалось; следующий запуск повторит попытку.`,
                ),
              );
            }
          }
          await writePendingClosures(pendingPath, pending);
        }
        for (const attempt of accepted) {
          completed.add(attempt.issue.id);
          await removeWorktreeAndBranch({
            repoRoot: cwd,
            path: attempt.worktreePath,
            branch: attempt.branch,
          }).catch(() => undefined);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await printIntegrationFailed(
          language,
          reason,
          error instanceof ValidationFailure ? error.command : undefined,
          logsRoot,
        );
        for (const attempt of accepted) {
          attempted.set(attempt.issue.id, reason);
          if (attempt.logName && attempt.rawOutput !== undefined) {
            await writeFailureLog(log, attempt.logName, attempt.rawOutput);
          }
        }
      }
      if (isShutdownRequested()) {
        throw new Error(localize(language, "Interrupted", "Выполнение прервано"));
      }
    }
    if (config.TASK_SOURCE === "local" && selectedIds.length > 0) {
      const tracker = await loadLocalTracker(lfiRoot);
      for (const task of runnableLocalTasks(tracker, selectedIds).blocked) {
        const unfinished = task.blockedBy.filter(
          (id) =>
            tracker.tasks.find((candidate) => candidate.id === id)?.status !==
            "completed",
        );
        attempted.set(
          task.id,
          localize(
            language,
            `blocked by ${unfinished.join(", ")}`,
            `заблокирована задачами ${unfinished.join(", ")}`,
          ),
        );
      }
    }
    const unresolved = [...attempted].filter(([id]) => !completed.has(id));
    if (config.TASK_SOURCE === "github") {
      for (const [id] of unresolved) {
        await setIssueStatus(cwd, Number(id.slice(1)), "ready").catch(() => undefined);
        await commentFinalFailure(cwd, Number(id.slice(1)), language).catch(
          () => undefined,
        );
      }
    }
    const summary = {
      runId,
      startedAt,
      iterations,
      completed: [...completed],
      unresolved: unresolved.map(([id, reason]) => ({ id, reason })),
      pendingClosures: pending.map((item) => item.number),
      finishedAt: new Date().toISOString(),
    };
    await saveRunSummary(stateRoot, runId, summary);
    await printRunSummary(language, [...completed], unresolved, logsRoot);
    await rm(currentStatePath, { force: true });
    if (config.TASK_SOURCE === "local") {
      await reconcileTrackerFilenames(
        await loadLocalTracker(lfiRoot),
        new Set(),
      );
    }
    return unresolved.length === 0 && pending.length === 0 ? 0 : 1;
  } catch (error) {
    await writeFile(
      currentStatePath,
      `${JSON.stringify({
        runId,
        startedAt,
        status: isShutdownRequested() ? "interrupted" : "failed",
        stage: iterations,
        completed: [...completed],
        error: error instanceof Error ? error.message : String(error),
      }, null, 2)}\n`,
    );
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
};
