import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { runCodex } from "./codex.js";
import { loadConfig } from "./config.js";
import { closeIssue, commentFinalFailure, listAllOpenIssueNumbers, listOpenIssues, nativeBlockers, repoInfo } from "./github.js";
import {
  commitsAhead,
  createIntegrationWorktree,
  ensureIssueWorktree,
  git,
  gitCommonDirectory,
  gitResult,
  removeWorktreeAndBranch,
  worktreeClean,
} from "./git.js";
import { selectRunnableIssues, type GithubIssue } from "./issues.js";
import { localize, type Language } from "./i18n.js";
import { pruneExpiredRunLogs } from "./logs.js";
import { mergerPrompt, renderWorkerPrompt } from "./prompts.js";
import { isShutdownRequested, runShell } from "./process.js";
import { evaluateWorkerResult } from "./worker-result.js";

interface Attempt {
  issue: GithubIssue;
  accepted: boolean;
  summary: string;
  worktreePath: string;
  branch: string;
}

const mapConcurrent = async <T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await worker(values[index]!);
      }
    }),
  );
  return results;
};

interface PendingClosure {
  number: number;
  sha: string;
}

const readPendingClosures = async (path: string): Promise<PendingClosure[]> => {
  const source = await readFile(path, "utf8").catch(() => "[]");
  const parsed = JSON.parse(source) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is PendingClosure => {
      if (typeof item !== "object" || item === null) return false;
      return (
        typeof Reflect.get(item, "number") === "number" &&
        typeof Reflect.get(item, "sha") === "string"
      );
    },
  );
};

const writePendingClosures = async (
  path: string,
  pending: readonly PendingClosure[],
): Promise<void> => {
  await writeFile(path, `${JSON.stringify(pending, null, 2)}\n`);
};

const mergeWithAgent = async (options: {
  cwd: string;
  context: string;
  config: Awaited<ReturnType<typeof loadConfig>>;
  gitDirectory: string;
  logsDirectory: string;
  logName: string;
  language: Language;
}): Promise<void> => {
  const result = await runCodex({
    cwd: options.cwd,
    prompt: mergerPrompt(options.context),
    model: options.config.MERGER_MODEL || options.config.CODEX_MODEL,
    reasoning: options.config.MERGER_REASONING_EFFORT,
    gitDirectory: options.gitDirectory,
    logsDirectory: options.logsDirectory,
    logName: options.logName,
    idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
    structured: false,
    prefix: "merge",
  });
  if (result.exitCode !== 0 || !(await worktreeClean(options.cwd))) {
    throw new Error(
      localize(
        options.language,
        `Merger failed: ${result.summary}`,
        `Агент слияния завершился с ошибкой: ${result.summary}`,
      ),
    );
  }
  if (result.rawLogPath) await rm(result.rawLogPath, { force: true });
};

export const dryRun = async (
  cwd: string,
): Promise<{ runnable: GithubIssue[]; blocked: GithubIssue[] }> => {
  const config = await loadConfig(join(cwd, ".lfi", "config.env"));
  const repository = await repoInfo(cwd);
  const [issues, allOpen] = await Promise.all([
    listOpenIssues(cwd, config.ISSUE_LABEL),
    listAllOpenIssueNumbers(cwd),
  ]);
  const blockers = await nativeBlockers(
    cwd,
    repository.nameWithOwner,
    issues.map((issue) => issue.number),
  );
  const runnable = selectRunnableIssues(issues, allOpen, {
    includeLabel: config.ISSUE_LABEL,
    excludeLabels: config.EXCLUDE_LABELS.split(",").map((label) => label.trim()),
    nativeBlockers: blockers,
  });
  const runnableNumbers = new Set(runnable.map((issue) => issue.number));
  return {
    runnable,
    blocked: issues.filter((issue) => !runnableNumbers.has(issue.number)),
  };
};

export const runLfi = async (
  cwd: string,
  language: Language,
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
  const logsRoot = join(lfiRoot, "logs");
  const worktreesRoot = join(lfiRoot, "worktrees");
  const stateRoot = join(lfiRoot, "state");
  await mkdir(stateRoot, { recursive: true });
  const currentStatePath = join(stateRoot, "current-run.json");
  const pendingClosuresPath = join(stateRoot, "pending-closures.json");
  const runId = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/u, "Z");
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
  const runLogs = join(logsRoot, runId);
  await mkdir(runLogs, { recursive: true });
  await pruneExpiredRunLogs(logsRoot, {
    retentionDays: config.LOG_RETENTION_DAYS,
    activeRunName: runId,
  });
  const taskTemplate = await readFile(join(lfiRoot, "task-prompt.md"), "utf8");
  const gitDirectory = await gitCommonDirectory(cwd);
  const repository = await repoInfo(cwd);
  const attempted = new Map<number, string>();
  const completed: number[] = [];
  let pendingClosures = await readPendingClosures(pendingClosuresPath);

  await writeFile(
    currentStatePath,
    `${JSON.stringify({
      runId,
      status: "running",
      stage: 0,
      activeIssues: [],
      completed,
      startedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );

  try {
    if (pendingClosures.length > 0) {
      const stillPending: PendingClosure[] = [];
      for (const pending of pendingClosures) {
        try {
          await closeIssue(cwd, pending.number, pending.sha, language);
        } catch (error) {
          stillPending.push(pending);
          console.error(
            localize(
              language,
              `Could not close previously published issue #${pending.number}: ${error instanceof Error ? error.message : String(error)}`,
              `Не удалось закрыть ранее опубликованную задачу #${pending.number}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }
      pendingClosures = stillPending;
      await writePendingClosures(pendingClosuresPath, pendingClosures);
    }

    for (let stage = 1; stage <= config.MAX_STAGES; stage++) {
      console.log(
        `\n${localize(language, "Stage", "Этап")} ${stage}/${config.MAX_STAGES}`,
      );
      await git(cwd, ["fetch", "origin", config.BASE_BRANCH]);
      const [issues, allOpen] = await Promise.all([
        listOpenIssues(cwd, config.ISSUE_LABEL),
        listAllOpenIssueNumbers(cwd),
      ]);
      const blockers = await nativeBlockers(
        cwd,
        repository.nameWithOwner,
        issues.map((issue) => issue.number),
      );
      const runnable = selectRunnableIssues(issues, allOpen, {
        includeLabel: config.ISSUE_LABEL,
        excludeLabels: config.EXCLUDE_LABELS.split(",").map((label) => label.trim()),
        nativeBlockers: blockers,
      }).filter(
        (issue) =>
          !completed.includes(issue.number) &&
          !pendingClosures.some((pending) => pending.number === issue.number),
      );
      await writeFile(
        currentStatePath,
        `${JSON.stringify({
          runId,
          status: "running",
          stage,
          activeIssues: runnable.map((issue) => issue.number),
          completed,
          updatedAt: new Date().toISOString(),
        }, null, 2)}\n`,
      );
      if (runnable.length === 0) break;
      console.log(
        `${localize(language, "Runnable", "Доступны")}: ${runnable.map((issue) => `#${issue.number}`).join(", ")}`,
      );

      const attempts = await mapConcurrent(
        runnable,
        config.MAX_PARALLEL,
        async (issue): Promise<Attempt> => {
          if (isShutdownRequested()) {
            throw new Error(localize(language, "Interrupted", "Выполнение прервано"));
          }
          try {
            const worktree = await ensureIssueWorktree({
              repoRoot: cwd,
              worktreesRoot,
              issueNumber: issue.number,
              baseBranch: config.BASE_BRANCH,
              setupCommand: config.WORKTREE_SETUP_COMMAND,
            });
            if (!worktree.created) {
              const update = await gitResult(worktree.path, [
                "merge",
                `origin/${config.BASE_BRANCH}`,
                "--no-edit",
              ]);
              if (update.exitCode !== 0) {
                await mergeWithAgent({
                  cwd: worktree.path,
                  context: `Update issue #${issue.number} branch with origin/${config.BASE_BRANCH}.`,
                  config,
                  gitDirectory,
                  logsDirectory: runLogs,
                  logName: `issue-${issue.number}-update-stage-${stage}`,
                  language,
                });
              }
            }
            const codex = await runCodex({
              cwd: worktree.path,
              prompt: renderWorkerPrompt(taskTemplate, issue),
              model: config.CODEX_MODEL,
              reasoning: config.CODEX_REASONING_EFFORT,
              gitDirectory,
              logsDirectory: runLogs,
              logName: `issue-${issue.number}-stage-${stage}`,
              idleTimeoutMinutes: config.IDLE_TIMEOUT_MINUTES,
              prefix: `issue-${issue.number}`,
            });
            const evaluation = evaluateWorkerResult({
              processExitCode: codex.exitCode,
              status: codex.status,
              commitsAhead: await commitsAhead(worktree.path, config.BASE_BRANCH),
              worktreeClean: await worktreeClean(worktree.path),
            });
            const summary = evaluation.accepted
              ? codex.summary
              : `${codex.summary}\n${evaluation.reasons.join(", ")}`;
            if (evaluation.accepted && codex.rawLogPath) {
              await rm(codex.rawLogPath, { force: true });
            }
            attempted.set(issue.number, summary);
            return {
              issue,
              accepted: evaluation.accepted,
              summary,
              worktreePath: worktree.path,
              branch: worktree.branch,
            };
          } catch (error) {
            const summary = error instanceof Error ? error.message : String(error);
            attempted.set(issue.number, summary);
            return {
              issue,
              accepted: false,
              summary,
              worktreePath: join(worktreesRoot, `issue-${issue.number}`),
              branch: `lfi/issue-${issue.number}`,
            };
          }
        },
      );
      if (isShutdownRequested()) {
        throw new Error(localize(language, "Interrupted", "Выполнение прервано"));
      }

      const accepted = attempts.filter((attempt) => attempt.accepted);
      if (accepted.length === 0) continue;
      const integration = await createIntegrationWorktree({
        repoRoot: cwd,
        worktreesRoot,
        baseBranch: config.BASE_BRANCH,
        runId: `${runId}-${stage}`,
      });
      let integrationSucceeded = false;
      try {
        for (const attempt of accepted) {
          const merge = await gitResult(integration.path, [
            "merge",
            attempt.branch,
            "--no-edit",
          ]);
          if (merge.exitCode !== 0) {
            await mergeWithAgent({
              cwd: integration.path,
              context: `Merge ${attempt.branch} for issue #${attempt.issue.number}.\n${attempt.issue.body}`,
              config,
              gitDirectory,
              logsDirectory: runLogs,
              logName: `merge-${attempt.issue.number}-stage-${stage}`,
              language,
            });
          }
        }
        if (config.WORKTREE_SETUP_COMMAND) {
          const setup = await runShell(config.WORKTREE_SETUP_COMMAND, {
            cwd: integration.path,
            onStdout: (chunk) => process.stdout.write(`[setup] ${chunk}`),
            onStderr: (chunk) => process.stderr.write(`[setup] ${chunk}`),
          });
          if (setup.exitCode !== 0) {
            throw new Error(
              localize(
                language,
                `Integration setup failed:\n${setup.stderr || setup.stdout}`,
                `Подготовка общего worktree завершилась с ошибкой:\n${setup.stderr || setup.stdout}`,
              ),
            );
          }
        }
        let validation = await runShell(config.VALIDATE_COMMAND, {
          cwd: integration.path,
          onStdout: (chunk) => process.stdout.write(`[validate] ${chunk}`),
          onStderr: (chunk) => process.stderr.write(`[validate] ${chunk}`),
        });
        if (validation.exitCode !== 0) {
          await mergeWithAgent({
            cwd: integration.path,
            context: `Combined validation failed.\n${validation.stdout}\n${validation.stderr}`,
            config,
            gitDirectory,
            logsDirectory: runLogs,
            logName: `merge-validation-stage-${stage}`,
            language,
          });
          validation = await runShell(config.VALIDATE_COMMAND, {
            cwd: integration.path,
          });
        }
        if (validation.exitCode !== 0) {
          throw new Error(
            localize(
              language,
              `Validation failed:\n${validation.stderr || validation.stdout}`,
              `Проверка завершилась с ошибкой:\n${validation.stderr || validation.stdout}`,
            ),
          );
        }
        await git(integration.path, [
          "push",
          "origin",
          `HEAD:${config.BASE_BRANCH}`,
        ]);
        const sha = (await git(integration.path, ["rev-parse", "HEAD"])).stdout.trim();
        const published = accepted.map((attempt) => ({
          number: attempt.issue.number,
          sha,
        }));
        pendingClosures = [
          ...pendingClosures.filter(
            (pending) =>
              !published.some((item) => item.number === pending.number),
          ),
          ...published,
        ];
        await writePendingClosures(pendingClosuresPath, pendingClosures);
        for (const attempt of accepted) {
          try {
            await closeIssue(cwd, attempt.issue.number, sha, language);
            pendingClosures = pendingClosures.filter(
              (pending) => pending.number !== attempt.issue.number,
            );
            await writePendingClosures(pendingClosuresPath, pendingClosures);
          } catch (error) {
            console.error(
              localize(
                language,
                `Published issue #${attempt.issue.number}, but GitHub did not close it. LFI will retry on the next run.`,
                `Задача #${attempt.issue.number} опубликована, но GitHub не смог её закрыть. LFI повторит попытку при следующем запуске.`,
              ),
            );
          }
          completed.push(attempt.issue.number);
          await removeWorktreeAndBranch({
            repoRoot: cwd,
            path: attempt.worktreePath,
            branch: attempt.branch,
          }).catch((error) => {
            console.error(
              `${localize(language, "[cleanup]", "[очистка]")} #${attempt.issue.number}: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        }
        await writeFile(
          currentStatePath,
          `${JSON.stringify({
            runId,
            status: "running",
            stage,
            activeIssues: [],
            completed,
            pendingClosures: pendingClosures.map((item) => item.number),
            updatedAt: new Date().toISOString(),
          }, null, 2)}\n`,
        );
        integrationSucceeded = true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `${localize(language, "[integration]", "[интеграция]")} ${reason}`,
        );
        for (const attempt of accepted) {
          attempted.set(
            attempt.issue.number,
            localize(
              language,
              `Integration failed: ${reason}`,
              `Интеграция завершилась с ошибкой: ${reason}`,
            ),
          );
        }
      } finally {
        await removeWorktreeAndBranch({
          repoRoot: cwd,
          path: integration.path,
          branch: integration.branch,
        }).catch(() => undefined);
      }
      if (!integrationSucceeded) continue;
    }

    const unresolved = [...attempted.entries()].filter(
      ([number]) => !completed.includes(number),
    );
    for (const [number] of unresolved) {
      await commentFinalFailure(cwd, number, language).catch((error) => {
        console.error(
          localize(
            language,
            `Could not post final comment for #${number}: ${error instanceof Error ? error.message : String(error)}`,
            `Не удалось отправить итоговый комментарий для #${number}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      });
    }
    const summary = {
      runId,
      completed,
      unresolved: unresolved.map(([number, reason]) => ({ number, reason })),
      pendingClosures: pendingClosures.map((item) => item.number),
      finishedAt: new Date().toISOString(),
    };
    await writeFile(join(stateRoot, "last-run.json"), `${JSON.stringify(summary, null, 2)}\n`);
    const historyRoot = join(stateRoot, "history");
    await mkdir(historyRoot, { recursive: true });
    await writeFile(join(historyRoot, `${runId}.json`), `${JSON.stringify(summary, null, 2)}\n`);
    const historyItems = (await readdir(historyRoot)).sort();
    for (const old of historyItems.slice(0, Math.max(0, historyItems.length - 50))) {
      await rm(join(historyRoot, old), { force: true });
    }
    await writeFile(join(runLogs, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    await rm(currentStatePath, { force: true });
    return unresolved.length === 0 && pendingClosures.length === 0 ? 0 : 1;
  } catch (error) {
    await writeFile(
      currentStatePath,
      `${JSON.stringify({
        runId,
        status: isShutdownRequested() ? "interrupted" : "failed",
        completed,
        pendingClosures: pendingClosures.map((item) => item.number),
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      }, null, 2)}\n`,
    );
    throw error;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
    await pruneExpiredRunLogs(logsRoot, {
      retentionDays: config.LOG_RETENTION_DAYS,
      activeRunName: runId,
    });
  }
};
