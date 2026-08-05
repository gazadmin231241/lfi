import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { forgetAcceptedAttempt } from "./accepted-attempts.js";
import { attemptWork } from "./attempt-work.js";
import { mapConcurrent } from "./concurrency.js";
import {
  agentModelKey,
  loadConfig,
  resolveWorkerModel,
} from "./config.js";
import {
  gitCommonDirectory,
  reconcileDefaultBranch,
  removeWorktreeAndBranch,
} from "./git.js";
import { localize, type Language } from "./i18n.js";
import { integrateAttempts } from "./integration.js";
import { configureLocalTrackerStorage } from "./local-setup.js";
import { loadLocalTracker, runnableLocalTasks } from "./local-tracker.js";
import { recordLocalCompletion } from "./local-run-state.js";
import { createRunOutput, pruneExpiredRunLogs } from "./logs.js";
import { isShutdownRequested } from "./process.js";
import { acquireRunLock } from "./run-lock.js";
import {
  loadPromptTemplates,
  validatePromptTemplates,
} from "./prompts.js";
import { printDefaultBranchPushed, printDefaultBranchReconciled, printIntegrationCompleted, printIntegrationFailed, printIntegrationStarted, printIteration, printIterationHeaderClosed, printPushNote, printRunSummary, printValidationStarted, printWorkFinished, printWorkStarted, printWorktreePreserved, reportUnavailableModelSkip } from "./run-display.js";
import { saveRunSummary } from "./run-history.js";
import { listWork } from "./run-source.js";
import type { Attempt } from "./runner-types.js";
import {
  checkpointTracker,
  ValidationFailure,
} from "./runner-support.js";
import { installedSkillNames } from "./skills.js";
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
  const promptTemplates = await loadPromptTemplates(lfiRoot, language);
  validatePromptTemplates(
    promptTemplates,
    await installedSkillNames(),
    language,
  );
  const branchReconciliation = await reconcileDefaultBranch(
    cwd,
    config.BASE_BRANCH,
  );
  if (branchReconciliation.outcome === "blocked") {
    throw new Error(
      localize(
        language,
        branchReconciliation.reason === "not-current"
          ? `A run must start on local ${branchReconciliation.branch}. Switch and reconcile before starting a run: ${branchReconciliation.command}`
          : `Local ${branchReconciliation.branch} cannot reconcile delivered commits from origin/${branchReconciliation.branch} because it is ${branchReconciliation.reason === "dirty" ? "dirty" : "diverged"}. Reconcile before starting a run: ${branchReconciliation.command}`,
        branchReconciliation.reason === "not-current"
          ? `Запуск должен начинаться на локальной ветке ${branchReconciliation.branch}. Переключитесь и выполните сверку до запуска: ${branchReconciliation.command}`
          : `Локальная ${branchReconciliation.branch} не может сверить доставленные коммиты из origin/${branchReconciliation.branch}: ${branchReconciliation.reason === "dirty" ? "есть незакоммиченные изменения" : "ветки разошлись"}. Сверьте ветку до запуска: ${branchReconciliation.command}`,
      ),
    );
  }
  const startupErrors: string[] = [];
  await configureLocalTrackerStorage(cwd);
  await loadReconciledLocalTracker(join(cwd, ".scratch"));
  await checkpointTracker(cwd, "docs(lfi): update local task tracker");
  if (selectedIds.length > 0) {
    const tracker = await loadLocalTracker(join(cwd, ".scratch"));
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
  const lock = await acquireRunLock(stateRoot, runId);
  if (!lock) {
    throw new Error(
      localize(
        language,
        "Another LFI run appears to be active.",
        "Похоже, другой запуск LFI всё ещё активен.",
      ),
    );
  }
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
  await pruneExpiredRunLogs(logsRoot, {
    retentionDays: config.LOG_RETENTION_DAYS,
    activeRunName: runId,
  });
  const output = await createRunOutput(logsRoot, startedAt);
  if (branchReconciliation.outcome === "fast-forwarded") {
    printDefaultBranchReconciled(output, language, branch);
  }
  if (branchReconciliation.outcome === "pushed") {
    printDefaultBranchPushed(output, language, branch);
  }
  if (branchReconciliation.outcome === "push-deferred") {
    printPushNote(
      output,
      localize(
        language,
        `Push of local ${branch} to origin/${branch} deferred: ${branchReconciliation.note}`,
        `Push локальной ${branch} в origin/${branch} отложен: ${branchReconciliation.note}`,
      ),
    );
  }
  for (const message of startupErrors) output.error(message);
  try {
    for (let stage = 1; stage <= config.MAX_STAGES; stage++) {
      const candidates = await listWork(cwd, completed, selectedIds);
      const runnable = candidates.flatMap((task) => {
        if (attempted.has(task.id)) return [];
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
        const target = resolveWorkerModel(config, task.executionTier ?? "standard");
        if (target.model && unavailableModels.has(agentModelKey(target))) {
          const reason = reportUnavailableModelSkip(
            output,
            language,
            reportedUnavailableTasks,
            task.id,
            task.executionTier ?? "standard",
            target,
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
      let headerClosed = false;
      const log = {
        directory: logsRoot,
        startedAt,
        iteration: stage,
        output,
        onAgentOutput: () => {
          if (headerClosed) return;
          headerClosed = true;
          printIterationHeaderClosed(output);
        },
      };
      printIteration(output, language, stage, runnable.map((item) => item.id));
      const attempts = await mapConcurrent(
        runnable,
        config.MAX_PARALLEL,
        async (task) => {
          const target = resolveWorkerModel(config, task.executionTier ?? "standard");
          if (target.model && unavailableModels.has(agentModelKey(target))) {
            const summary = reportUnavailableModelSkip(
              output,
              language,
              reportedUnavailableTasks,
              task.id,
              task.executionTier ?? "standard",
              target,
            );
            return {
              task,
              accepted: false,
              summary,
              worktreePath: join(worktreesRoot, task.id.toLowerCase()),
              branch: `lfi/${task.id.toLowerCase()}`,
            };
          }
          printWorkStarted(output, language, task.id, target, target.reasoning);
          const attempt = await attemptWork({
            cwd,
            worktreesRoot,
            baseRef,
            task,
            config,
            gitDirectory,
            log,
            taskTemplate: promptTemplates.task.content,
            promptTemplates,
            language,
            stateRoot,
          });
          if (attempt.unavailableModel) {
            unavailableModels.add(agentModelKey(attempt.unavailableModel));
            output.error(
              localize(
                language,
                `${task.id}: model ${attempt.unavailableModel.model} for agent ${attempt.unavailableModel.agent}, configured through the ${task.executionTier ?? "standard"} tier mapping, is unavailable; LFI will not fall back and will skip other tasks using this agent and model for this run.`,
                `${task.id}: модель ${attempt.unavailableModel.model} для агента ${attempt.unavailableModel.agent}, настроенная маршрутизацией уровня ${task.executionTier ?? "standard"}, недоступна; LFI не будет использовать fallback и пропустит остальные задачи с этим агентом и моделью в текущем запуске.`,
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
          attempt.validationPending ?? false,
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
        const integration = await integrateAttempts({
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
          promptTemplates,
          onValidationStarted: () => printValidationStarted(output, language),
          beforeDelivery: (integrationPath) =>
            recordLocalCompletion(integrationPath, accepted),
          beforeHostUpdate: async () => {
            await loadReconciledLocalTracker(join(cwd, ".scratch"), new Set());
          },
        });
        printIntegrationCompleted(output, language, branch);
        if (integration.push === "deferred") {
          printPushNote(output, integration.pushNote ?? "");
        }
        for (const attempt of accepted) {
          completed.add(attempt.task.id);
          // The acceptance has been delivered, so the record that guarded it
          // against a redundant re-attempt has nothing left to protect.
          await forgetAcceptedAttempt(stateRoot, attempt.task.id);
          if (attempt.dirtyWorktree) {
            printWorktreePreserved(
              output,
              language,
              attempt.task.id,
              attempt.worktreePath,
              attempt.branch,
            );
            continue;
          }
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
      const tracker = await loadLocalTracker(join(cwd, ".scratch"));
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
    await loadReconciledLocalTracker(join(cwd, ".scratch"));
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
    await lock.release();
  }
};
