import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attemptWork } from "./attempt-work.js";
import { mapConcurrent } from "./concurrency.js";
import { loadConfig, resolveWorkerModel } from "./config.js";
import { git, gitCommonDirectory, removeWorktreeAndBranch } from "./git.js";
import { localize, type Language } from "./i18n.js";
import { integrateAttempts } from "./integration.js";
import { configureLocalTrackerStorage } from "./local-setup.js";
import { loadLocalTracker, runnableLocalTasks } from "./local-tracker.js";
import { recordLocalCompletion } from "./local-run-state.js";
import { createRunOutput, pruneExpiredRunLogs } from "./logs.js";
import { isShutdownRequested } from "./process.js";
import { printIntegrationCompleted, printIntegrationFailed, printIntegrationStarted, printIteration, printRunSummary, printValidationStarted, printWorkFinished, printWorkStarted, reportUnavailableModelSkip } from "./run-display.js";
import { saveRunSummary } from "./run-history.js";
import { listWork } from "./run-source.js";
import type { Attempt } from "./runner-types.js";
import {
  checkpointTracker,
  ValidationFailure,
} from "./runner-support.js";
import { loadReconciledLocalTracker } from "./tracker-files.js";

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
  const startupErrors: string[] = [];
  await configureLocalTrackerStorage(cwd);
  await loadReconciledLocalTracker(lfiRoot);
  await checkpointTracker(cwd, "docs(lfi): update local task tracker");
  await git(cwd, ["fetch", "origin", config.BASE_BRANCH]);
  await git(cwd, [
    "merge",
    `origin/${config.BASE_BRANCH}`,
    "--no-edit",
  ]);
  if (selectedIds.length > 0) {
    const tracker = await loadLocalTracker(lfiRoot);
    const blocked = runnableLocalTasks(tracker, selectedIds).blocked;
    for (const task of blocked) {
      const unfinished = task.blockedBy.filter(
        (id) =>
          tracker.tasks.find((candidate) => candidate.id === id)?.status !==
          "completed",
      );
      startupErrors.push(
        localize(
          language,
          `${task.id} is blocked by ${unfinished.join(", ")}.`,
          `${task.id} заблокирована задачами ${unfinished.join(", ")}.`,
        ),
      );
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
  const completed = new Set<string>();
  const attempted = new Map<string, string>();
  const warnedMissingTier = new Set<string>();
  const unavailableModels = new Set<string>();
  const reportedUnavailableTasks = new Set<string>();
  let iterations = 0;
  const branch = config.BASE_BRANCH;
  const baseRef = branch;
  const gitDirectory = await gitCommonDirectory(cwd);
  const taskTemplate = await readFile(join(lfiRoot, "task-prompt.md"), "utf8");
  await pruneExpiredRunLogs(logsRoot, {
    retentionDays: config.LOG_RETENTION_DAYS,
    activeRunName: runId,
  });
  const output = await createRunOutput(logsRoot, startedAt);
  for (const message of startupErrors) output.error(message);
  try {
    for (let stage = 1; stage <= config.MAX_STAGES; stage++) {
      await git(cwd, ["fetch", "origin", branch]);
      const candidates = await listWork(cwd, completed, selectedIds);
      const runnable = candidates.flatMap((task) => {
        if (task.executionTier === undefined) {
          if (!warnedMissingTier.has(task.id)) {
            output.log(
              localize(
                language,
                `${task.id} has no execution tier; using standard.`,
                `${task.id}: уровень выполнения не указан; используется standard.`,
              ),
            );
            warnedMissingTier.add(task.id);
          }
          task = { ...task, executionTier: "standard" as const };
        }
        const model = resolveWorkerModel(config, task.executionTier ?? "standard");
        if (model && unavailableModels.has(model)) {
          const reason = reportUnavailableModelSkip(
            output,
            language,
            reportedUnavailableTasks,
            task.id,
            task.executionTier ?? "standard",
            model,
          );
          attempted.set(task.id, reason);
          return [];
        }
        return [task];
      });
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
      const log = {
        directory: logsRoot,
        startedAt,
        iteration: stage,
        output,
      };
      printIteration(output, language, stage, runnable.map((item) => item.id));
      const attempts = await mapConcurrent(
        runnable,
        config.MAX_PARALLEL,
        async (task) => {
          const model = resolveWorkerModel(config, task.executionTier ?? "standard");
          if (model && unavailableModels.has(model)) {
            const summary = reportUnavailableModelSkip(
              output,
              language,
              reportedUnavailableTasks,
              task.id,
              task.executionTier ?? "standard",
              model,
            );
            return {
              task,
              accepted: false,
              summary,
              worktreePath: join(worktreesRoot, task.id.toLowerCase()),
              branch: `lfi/${task.id.toLowerCase()}`,
            };
          }
          printWorkStarted(output, language, task.id, model, config.CODEX_REASONING_EFFORT);
          const attempt = await attemptWork({
            cwd,
            worktreesRoot,
            baseRef,
            task,
            config,
            gitDirectory,
            log,
            taskTemplate,
            language,
          });
          if (attempt.unavailableModel) {
            unavailableModels.add(attempt.unavailableModel);
            output.error(
              localize(
                language,
                `${task.id}: configured ${task.executionTier ?? "standard"} tier model ${attempt.unavailableModel} is unavailable; LFI will not fall back and will skip other tasks using it for this run.`,
                `${task.id}: настроенная модель ${attempt.unavailableModel} уровня ${task.executionTier ?? "standard"} недоступна; LFI не будет использовать fallback и пропустит остальные задачи с этой моделью в текущем запуске.`,
              ),
            );
          }
          return attempt;
        },
      );
      for (const attempt of attempts) {
        attempted.set(attempt.task.id, attempt.summary);
        printWorkFinished(
          output,
          language,
          attempt.task.id,
          attempt.accepted,
        );
      }
      const accepted = attempts.filter((attempt) => attempt.accepted);
      if (accepted.length === 0) continue;
      try {
        printIntegrationStarted(
          output,
          language,
          accepted.map((attempt) => ({
            id: attempt.task.id,
            branch: attempt.branch,
          })),
        );
        await integrateAttempts({
          cwd,
          worktreesRoot,
          baseRef,
          baseBranch: branch,
          runId,
          log,
          attempts: accepted,
          config,
          gitDirectory,
          language,
          onValidationStarted: () => printValidationStarted(output, language),
          beforeDelivery: (integrationPath) =>
            recordLocalCompletion(integrationPath, accepted),
          beforeHostUpdate: async () => {
            await loadReconciledLocalTracker(lfiRoot, new Set());
          },
        });
        printIntegrationCompleted(output, language, branch);
        for (const attempt of accepted) {
          completed.add(attempt.task.id);
          await removeWorktreeAndBranch({
            repoRoot: cwd,
            path: attempt.worktreePath,
            branch: attempt.branch,
          }).catch(() => undefined);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await printIntegrationFailed(
          output,
          language,
          reason,
          error instanceof ValidationFailure ? error.command : undefined,
          logsRoot,
        );
        for (const attempt of accepted) attempted.set(attempt.task.id, reason);
        break;
      }
      if (isShutdownRequested()) {
        throw new Error(localize(language, "Interrupted", "Выполнение прервано"));
      }
    }
    if (selectedIds.length > 0) {
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
    const summary = {
      runId,
      startedAt,
      iterations,
      completed: [...completed],
      unresolved: unresolved.map(([id, reason]) => ({ id, reason })),
      finishedAt: new Date().toISOString(),
    };
    await saveRunSummary(stateRoot, runId, summary);
    await printRunSummary(
      output,
      language,
      [...completed],
      unresolved,
      logsRoot,
    );
    await rm(currentStatePath, { force: true });
    await loadReconciledLocalTracker(lfiRoot);
    return unresolved.length === 0 ? 0 : 1;
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
    await output.flush();
    await lock.close();
    await rm(lockPath, { force: true });
  }
};
