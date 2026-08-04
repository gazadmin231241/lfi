import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  forgetAcceptedAttempt,
  readAcceptedAttempt,
  recordAcceptedAttempt,
} from "./accepted-attempts.js";
import {
  runAgent,
} from "./agent-provider.js";
import {
  resolveReviewerModel,
  resolveWorkerModel,
  type LfiConfig,
} from "./config.js";
import {
  commitWorktreeChanges,
  commitsAhead,
  ensureTaskWorktree,
  fastForwardFromOrigin,
  git,
  gitResult,
  worktreeClean,
} from "./git.js";
import { localize, type Language } from "./i18n.js";
import type { RunLogContext } from "./logs.js";
import { appendRunLog, redactSensitiveText } from "./logs.js";
import {
  reReviewPrompt,
  remediationPrompt,
  renderWorkerPrompt,
  reviewPrompt,
  type PromptTemplates,
} from "./prompts.js";
import { printOriginRefresh } from "./run-display.js";
import type { Attempt, WorkItem } from "./runner-types.js";
import { mergeWithAgent } from "./runner-support.js";
import { evaluateWorkerResult } from "./worker-result.js";
import {
  openIsolationSession,
  resolveGitIdentity,
  withIsolationSession,
} from "./isolation-provider.js";
import { runProjectCommand } from "./project-command.js";
import {
  parseReviewFindings,
  parseVerificationVerdicts,
  type ReviewFinding,
} from "./review-findings.js";

const pathIsInside = (parent: string, candidate: string): boolean => {
  const path = relative(resolve(parent), resolve(candidate));
  return path === "" || (
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
};

const validateAttempt = async (options: {
  cwd: string;
  config: LfiConfig;
  gitDirectory: string;
  language: Language;
  log: RunLogContext;
  logName: string;
  session: Awaited<ReturnType<typeof openIsolationSession>>;
}): Promise<string | undefined> => {
  if (!options.config.VALIDATE_COMMAND) return undefined;
  const validation = await runProjectCommand({
    command: options.config.VALIDATE_COMMAND,
    cwd: options.cwd,
    gitDirectory: options.gitDirectory,
    isolationProvider: options.config.ISOLATION_PROVIDER,
    session: options.session,
  });
  await appendRunLog(
    options.log,
    `${options.logName}-validation`,
    [
      "$ " + options.config.VALIDATE_COMMAND,
      validation.stdout,
      validation.stderr,
      "exit=" + validation.exitCode,
    ].filter(Boolean),
  );
  if (validation.exitCode === 0) return undefined;
  const output = redactSensitiveText(
    [validation.stdout, validation.stderr].filter(Boolean).join("\n"),
  );
  return localize(
    options.language,
    "Validation failed:\n" + (output || "exit=" + validation.exitCode),
    "Проверка завершилась с ошибкой:\n" + (output || "exit=" + validation.exitCode),
  );
};

/**
 * Pins an acceptance to the commit that earned it, so a later run can hand the
 * same work to integration instead of paying for the whole attempt again.
 *
 * A dirty worktree is never recorded: its content is not described by `HEAD`,
 * so nothing later could confirm the record still matches the accepted work.
 */
const rememberAcceptedAttempt = async (options: {
  stateRoot?: string;
  taskId: string;
  worktreePath: string;
  baseRef: string;
  dirtyWorktree: boolean;
}): Promise<void> => {
  if (!options.stateRoot || options.dirtyWorktree) return;
  const head = await gitResult(options.worktreePath, ["rev-parse", "HEAD"]);
  if (head.exitCode !== 0) return;
  const base = await gitResult(options.worktreePath, [
    "rev-parse",
    options.baseRef,
  ]);
  await recordAcceptedAttempt(options.stateRoot, {
    taskId: options.taskId,
    commit: head.stdout.trim(),
    baseRef: options.baseRef,
    baseCommit: base.exitCode === 0 ? base.stdout.trim() : "",
    recordedAt: new Date().toISOString(),
  });
};

/**
 * Returns the attempt to reuse when a reused worktree still holds exactly the
 * commit that was accepted, and clears a record that no longer describes it.
 *
 * Must run before the worktree is merged with the base: merging moves `HEAD`
 * and would make every record look stale. Divergence from the base is not a
 * reason to redo the work — integration merges the attempt itself.
 */
const resumeAcceptedAttempt = async (options: {
  stateRoot?: string;
  task: WorkItem;
  worktreePath: string;
  branch: string;
  clean: boolean;
  language: Language;
  logName: string;
}): Promise<Attempt | undefined> => {
  if (!options.stateRoot) return undefined;
  const record = await readAcceptedAttempt(options.stateRoot, options.task.id);
  if (!record) return undefined;
  const head = await gitResult(options.worktreePath, ["rev-parse", "HEAD"]);
  const matches =
    options.clean &&
    head.exitCode === 0 &&
    head.stdout.trim() === record.commit;
  if (!matches) {
    await forgetAcceptedAttempt(options.stateRoot, options.task.id);
    return undefined;
  }
  return {
    task: options.task,
    accepted: true,
    summary: localize(
      options.language,
      `Reused the attempt accepted earlier at ${record.commit.slice(0, 12)}; no agent phases were run.`,
      `Переиспользована принятая ранее попытка на коммите ${record.commit.slice(0, 12)}; фазы агентов не запускались.`,
    ),
    worktreePath: options.worktreePath,
    branch: options.branch,
    logName: options.logName,
  };
};

const finishAcceptedAttempt = async (options: {
  task: WorkItem;
  summary: string;
  worktreePath: string;
  branch: string;
  cwd: string;
  config: LfiConfig;
  gitDirectory: string;
  language: Language;
  log: RunLogContext;
  logName: string;
  baseRef: string;
  stateRoot?: string;
  session: Awaited<ReturnType<typeof openIsolationSession>>;
}): Promise<Attempt> => {
  const validationFailure = await validateAttempt(options);
  const dirtyWorktree = !(await worktreeClean(options.worktreePath));
  if (!validationFailure) {
    await rememberAcceptedAttempt({
      ...(options.stateRoot ? { stateRoot: options.stateRoot } : {}),
      taskId: options.task.id,
      worktreePath: options.worktreePath,
      baseRef: options.baseRef,
      dirtyWorktree,
    });
  }
  return {
    task: options.task,
    accepted: !validationFailure,
    summary: validationFailure ?? options.summary,
    worktreePath: options.worktreePath,
    branch: options.branch,
    logName: options.logName,
    ...(dirtyWorktree ? { dirtyWorktree: true } : {}),
  };
};

const logDowngradedBlockingFindings = async (options: {
  findings: readonly ReviewFinding[];
  language: Language;
  log: RunLogContext;
  logName: string;
}): Promise<void> => {
  const count = options.findings.filter(
    (finding) => finding.degradedFromBlocking,
  ).length;
  if (count === 0) return;
  const finding = count === 1 ? "finding" : "findings";
  const message = localize(
    options.language,
    `Review phase downgraded ${count} blocking ${finding} to advisory because ${count === 1 ? "it lacks" : "they lack"} a non-empty failure scenario.`,
    `Этап ревью понизил ${count} блокирующих замечаний до совещательных, потому что в них не указан непустой сценарий отказа.`,
  );
  await appendRunLog(options.log, options.logName, [message]);
  options.log.output?.log(message);
};

export const attemptWork = async (options: {
  cwd: string;
  worktreesRoot: string;
  baseRef: string;
  task: WorkItem;
  config: LfiConfig;
  gitDirectory: string;
  log: RunLogContext;
  taskTemplate: string;
  promptTemplates?: PromptTemplates;
  language: Language;
  /** Where accepted attempts are persisted; omit to disable resumption. */
  stateRoot?: string;
}): Promise<Attempt> => {
  const key = options.task.id.toLowerCase();
  const logName = options.task.id;
  const executionTier = options.task.executionTier ?? "standard";
  const target = resolveWorkerModel(
    options.config,
    executionTier,
  );
  try {
    const worktree = await ensureTaskWorktree({
      repoRoot: options.cwd,
      worktreesRoot: options.worktreesRoot,
      taskKey: key,
      baseRef: options.baseRef,
      setupCommand: "",
      gitDirectory: options.gitDirectory,
      isolationProvider: options.config.ISOLATION_PROVIDER,
    });
    const identity =
      options.config.ISOLATION_PROVIDER === "none"
        ? {}
        : await resolveGitIdentity(worktree.path);
    return await withIsolationSession(
      () => openIsolationSession({
        provider: options.config.ISOLATION_PROVIDER,
        agent: target.agent,
        worktree: worktree.path,
        gitDirectory: options.gitDirectory,
        homeDirectory: homedir(),
        environment: process.env,
        identity,
      }),
      async (session) => {
        const reusedDirtyWorktree =
          !worktree.created && !(await worktreeClean(worktree.path));
        if (worktree.created && options.config.WORKTREE_SETUP_COMMAND) {
          const setup = await runProjectCommand({
            command: options.config.WORKTREE_SETUP_COMMAND,
            cwd: worktree.path,
            gitDirectory: options.gitDirectory,
            isolationProvider: options.config.ISOLATION_PROVIDER,
            session,
          });
          if (setup.exitCode !== 0) {
            throw new Error(
              `Worktree setup failed:\n${redactSensitiveText(setup.stderr || setup.stdout)}`,
            );
          }
        }
        if (!worktree.created) {
          const resumed = await resumeAcceptedAttempt({
            ...(options.stateRoot ? { stateRoot: options.stateRoot } : {}),
            task: options.task,
            worktreePath: worktree.path,
            branch: worktree.branch,
            clean: !reusedDirtyWorktree,
            language: options.language,
            logName,
          });
          if (resumed) return resumed;
          // Reused worktrees hold a local copy of the base that does not move on
          // its own. Refresh it from origin where that is provably safe; every
          // other case reuses the worktree exactly as it was.
          const refresh = await fastForwardFromOrigin(
            worktree.path,
            options.baseRef,
          );
          if (options.log.output)
            printOriginRefresh(
              options.log.output,
              options.language,
              options.task.id,
              refresh,
            );
          const update = await gitResult(worktree.path, [
            "merge",
            options.baseRef,
            "--no-edit",
          ]);
          if (update.exitCode !== 0) {
            const summary = await mergeWithAgent({
              cwd: worktree.path,
              context: `Update ${options.task.id} from ${options.baseRef}.`,
              config: options.config,
              gitDirectory: options.gitDirectory,
              log: options.log,
              logName: "integration",
              language: options.language,
              ...(options.promptTemplates
                ? { promptTemplate: options.promptTemplates.merge }
                : {}),
            });
            if (reusedDirtyWorktree) {
              const evaluation = evaluateWorkerResult({
                processExitCode: 0,
                status: "completed",
                commitsAhead: await commitsAhead(worktree.path, options.baseRef),
              });
              const validationFailure = evaluation.accepted
                ? await validateAttempt({
                  cwd: worktree.path,
                  config: options.config,
                  gitDirectory: options.gitDirectory,
                  language: options.language,
                  log: options.log,
                  logName,
                  session,
                })
                : undefined;
              const accepted = evaluation.accepted && !validationFailure;
              if (accepted) {
                await rememberAcceptedAttempt({
                  ...(options.stateRoot ? { stateRoot: options.stateRoot } : {}),
                  taskId: options.task.id,
                  worktreePath: worktree.path,
                  baseRef: options.baseRef,
                  dirtyWorktree: !(await worktreeClean(worktree.path)),
                });
              }
              return {
                task: options.task,
                accepted,
                summary: validationFailure ?? (evaluation.accepted
                  ? summary
                  : `${summary}\n${evaluation.reasons.join(", ")}`),
                worktreePath: worktree.path,
                branch: worktree.branch,
                logName: "integration",
              };
            }
          }
        }
        const taskPromptTemplate = options.promptTemplates?.task.content
          ?? options.taskTemplate;
        const agent = await runAgent({
          agent: target.agent,
          cwd: worktree.path,
          prompt: renderWorkerPrompt(
            taskPromptTemplate,
            options.task,
            target.agent,
            options.language,
          ),
          model: target.model,
          reasoning: target.reasoning,
          gitDirectory: options.gitDirectory,
          log: options.log,
          logName,
          idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
          isolationProvider: options.config.ISOLATION_PROVIDER,
          prefix: `${key}:task`,
          language: options.language,
          session,
        });
        if (agent.exitCode === 0 && agent.status === "completed") {
          await commitWorktreeChanges(
            worktree.path,
            `feat(lfi): implement ${options.task.id}`,
          );
        }
        const evaluation = evaluateWorkerResult({
          processExitCode: agent.exitCode,
          status: agent.status,
          commitsAhead: await commitsAhead(worktree.path, options.baseRef),
        });
        if (!evaluation.accepted) {
          const dirtyWorktree = !(await worktreeClean(worktree.path));
          return {
            task: options.task,
            accepted: false,
            summary: `${agent.summary}\n${evaluation.reasons.join(", ")}`,
            worktreePath: worktree.path,
            branch: worktree.branch,
            logName,
            ...(dirtyWorktree ? { dirtyWorktree: true } : {}),
            ...(agent.exitCode !== 0 && target.model && agent.unavailableModel
              ? { unavailableModel: target }
              : {}),
          };
        }

        if (!options.config.REVIEW_ENABLED) {
          return finishAcceptedAttempt({
            task: options.task,
            summary: agent.summary,
            worktreePath: worktree.path,
            branch: worktree.branch,
            cwd: worktree.path,
            config: options.config,
            gitDirectory: options.gitDirectory,
            language: options.language,
            log: options.log,
            logName,
            baseRef: options.baseRef,
            ...(options.stateRoot ? { stateRoot: options.stateRoot } : {}),
            session,
          });
        }

        const reviewer = resolveReviewerModel(options.config, executionTier);
        const reviewLogName = `${logName}-review`;
        const findingsPath = resolve(
          options.log.directory,
          `${key}-review-findings.json`,
        );
        if (pathIsInside(worktree.path, findingsPath)) {
          throw new Error(localize(
            options.language,
            "The review findings file must be outside the worktree.",
            "Файл замечаний ревью должен находиться вне worktree.",
          ));
        }
        await rm(findingsPath, { force: true });
        const review = await runAgent({
          agent: reviewer.agent,
          cwd: worktree.path,
          prompt: reviewPrompt(
            options.baseRef,
            findingsPath,
            reviewer.agent,
            options.language,
            options.promptTemplates?.review.content,
          ),
          model: reviewer.model,
          reasoning: reviewer.reasoning,
          gitDirectory: options.gitDirectory,
          log: options.log,
          logName: reviewLogName,
          idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
          isolationProvider: options.config.ISOLATION_PROVIDER,
          prefix: `${key}:review`,
          language: options.language,
          session,
          writableDirectories: [options.log.directory],
        });
        if (review.exitCode !== 0 || review.status !== "completed") {
          return {
            task: options.task,
            accepted: false,
            summary: localize(
              options.language,
              `Review phase failed: ${review.summary}`,
              `Этап ревью завершился ошибкой: ${review.summary}`,
            ),
            worktreePath: worktree.path,
            branch: worktree.branch,
            logName: reviewLogName,
            ...(review.exitCode !== 0 && reviewer.model && review.unavailableModel
              ? { unavailableModel: reviewer }
              : {}),
          };
        }
        let findings: ReviewFinding[];
        let findingsText: string;
        try {
          findingsText = await readFile(findingsPath, "utf8");
          findings = parseReviewFindings(findingsText);
        } catch {
          return {
            task: options.task,
            accepted: false,
            summary: localize(
              options.language,
              "Review phase failed: the findings file is missing or invalid.",
              "Этап ревью завершился ошибкой: файл замечаний отсутствует или некорректен.",
            ),
            worktreePath: worktree.path,
            branch: worktree.branch,
            logName: reviewLogName,
          };
        }
        await logDowngradedBlockingFindings({
          findings,
          language: options.language,
          log: options.log,
          logName: reviewLogName,
        });
        const blockingFindings = findings.filter(
          (finding) => finding.severity === "blocking",
        );
        if (blockingFindings.length > 0) {
          const targetedFindingsText = JSON.stringify(blockingFindings);
          if (options.config.MAX_REMEDIATION_ROUNDS === 0) {
            return {
              task: options.task,
              accepted: false,
              summary: localize(
                options.language,
                `Review phase found blocking findings: ${blockingFindings.length}.`,
                `Этап ревью выявил блокирующие замечания: ${blockingFindings.length}.`,
              ),
              worktreePath: worktree.path,
              branch: worktree.branch,
              logName: reviewLogName,
            };
          }
          for (
            let round = 1;
            round <= options.config.MAX_REMEDIATION_ROUNDS;
            round += 1
          ) {
            const remediationLogName = `${logName}-remediation`;
            const remediationStart = (await git(
              worktree.path,
              ["rev-parse", "HEAD"],
            )).stdout.trim();
            const remediation = await runAgent({
              agent: target.agent,
              cwd: worktree.path,
              prompt: remediationPrompt(
                targetedFindingsText,
                options.language,
                target.agent,
                options.promptTemplates?.remediation.content,
              ),
              model: target.model,
              reasoning: target.reasoning,
              gitDirectory: options.gitDirectory,
              log: options.log,
              logName: remediationLogName,
              idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
              isolationProvider: options.config.ISOLATION_PROVIDER,
              prefix: `${key}:remediation`,
              language: options.language,
              session,
            });
            if (remediation.exitCode !== 0 || remediation.status !== "completed") {
              return {
                task: options.task,
                accepted: false,
                summary: localize(
                  options.language,
                  `Remediation phase failed: ${remediation.summary}`,
                  `Этап исправления завершился ошибкой: ${remediation.summary}`,
                ),
                worktreePath: worktree.path,
                branch: worktree.branch,
                logName: remediationLogName,
                ...(remediation.exitCode !== 0 && target.model && remediation.unavailableModel
                  ? { unavailableModel: target }
                  : {}),
              };
            }
            const remediationEnd = (await git(
              worktree.path,
              ["rev-parse", "HEAD"],
            )).stdout.trim();
            if (remediationEnd !== remediationStart) {
              return {
                task: options.task,
                accepted: false,
                summary: localize(
                  options.language,
                  "Remediation phase failed: the remediation session created a commit.",
                  "Этап исправления завершился ошибкой: сессия исправления создала commit.",
                ),
                worktreePath: worktree.path,
                branch: worktree.branch,
                logName: remediationLogName,
              };
            }
            await commitWorktreeChanges(
              worktree.path,
              `fix(lfi): remediate ${options.task.id}`,
            );
            const verificationLogName = `${logName}-verification`;
            const verificationVerdictsPath = resolve(
              options.log.directory,
              `${key}-verification-verdicts.json`,
            );
            await rm(verificationVerdictsPath, { force: true });
            const verification = await runAgent({
              agent: reviewer.agent,
              cwd: worktree.path,
              prompt: reReviewPrompt(
                options.baseRef,
                verificationVerdictsPath,
                targetedFindingsText,
                reviewer.agent,
                options.language,
                options.promptTemplates?.["re-review"].content,
              ),
              model: reviewer.model,
              reasoning: reviewer.reasoning,
              gitDirectory: options.gitDirectory,
              log: options.log,
              logName: verificationLogName,
              idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
              isolationProvider: options.config.ISOLATION_PROVIDER,
              prefix: `${key}:verification`,
              language: options.language,
              session,
              writableDirectories: [options.log.directory],
            });
            if (verification.exitCode !== 0 || verification.status !== "completed") {
              return {
                task: options.task,
                accepted: false,
                summary: localize(
                  options.language,
                  `Verification phase failed: ${verification.summary}`,
                  `Этап верификации завершился ошибкой: ${verification.summary}`,
                ),
                worktreePath: worktree.path,
                branch: worktree.branch,
                logName: verificationLogName,
                ...(verification.exitCode !== 0 && reviewer.model && verification.unavailableModel
                  ? { unavailableModel: reviewer }
                  : {}),
              };
            }
            try {
              const verdictsText = await readFile(verificationVerdictsPath, "utf8");
              const verdicts = parseVerificationVerdicts(
                verdictsText,
                blockingFindings.length,
              );
              const unresolvedCount = verdicts.filter(
                (verdict) => verdict.verdict === "unresolved",
              ).length;
              if (unresolvedCount > 0) {
                return {
                  task: options.task,
                  accepted: false,
                  summary: localize(
                    options.language,
                    `Verification phase found unresolved findings: ${unresolvedCount}.`,
                    `Этап верификации выявил неустранённые замечания: ${unresolvedCount}.`,
                  ),
                  worktreePath: worktree.path,
                  branch: worktree.branch,
                  logName: verificationLogName,
                };
              }
            } catch {
              return {
                task: options.task,
                accepted: false,
                summary: localize(
                  options.language,
                  "Verification phase failed: the verdicts file is missing, invalid, or does not match the original findings.",
                  "Этап верификации завершился ошибкой: файл вердиктов отсутствует, некорректен или не соответствует исходным замечаниям.",
                ),
                worktreePath: worktree.path,
                branch: worktree.branch,
                logName: verificationLogName,
              };
            }
            break;
          }
        }
        return finishAcceptedAttempt({
          task: options.task,
          summary: agent.summary,
          worktreePath: worktree.path,
          branch: worktree.branch,
          cwd: worktree.path,
          config: options.config,
          gitDirectory: options.gitDirectory,
          language: options.language,
          log: options.log,
          logName,
          baseRef: options.baseRef,
          ...(options.stateRoot ? { stateRoot: options.stateRoot } : {}),
          session,
        });
      },
    );
  } catch (error) {
    return {
      task: options.task,
      accepted: false,
      summary: error instanceof Error ? error.message : String(error),
      worktreePath: join(options.worktreesRoot, key),
      branch: `lfi/${key}`,
    };
  }
};
