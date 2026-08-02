import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  runAgent,
} from "./agent-provider.js";
import {
  resolveWorkerModel,
  type LfiConfig,
} from "./config.js";
import {
  commitWorktreeChanges,
  commitsAhead,
  ensureTaskWorktree,
  fastForwardFromOrigin,
  gitResult,
  worktreeClean,
} from "./git.js";
import { localize, type Language } from "./i18n.js";
import type { RunLogContext } from "./logs.js";
import { redactSensitiveText } from "./logs.js";
import { renderWorkerPrompt, reviewPrompt } from "./prompts.js";
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

export const attemptWork = async (options: {
  cwd: string;
  worktreesRoot: string;
  baseRef: string;
  task: WorkItem;
  config: LfiConfig;
  gitDirectory: string;
  log: RunLogContext;
  taskTemplate: string;
  language: Language;
}): Promise<Attempt> => {
  const key = options.task.id.toLowerCase();
  const logName = options.task.id;
  const target = resolveWorkerModel(
    options.config,
    options.task.executionTier ?? "standard",
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
            });
            if (reusedDirtyWorktree) {
              const evaluation = evaluateWorkerResult({
                processExitCode: 0,
                status: "completed",
                commitsAhead: await commitsAhead(worktree.path, options.baseRef),
              });
              return {
                task: options.task,
                accepted: evaluation.accepted,
                summary: evaluation.accepted
                  ? summary
                  : `${summary}\n${evaluation.reasons.join(", ")}`,
                worktreePath: worktree.path,
                branch: worktree.branch,
                logName: "integration",
              };
            }
          }
        }
        const agent = await runAgent({
          agent: target.agent,
          cwd: worktree.path,
          prompt: renderWorkerPrompt(
            options.taskTemplate,
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
          prefix: key,
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
          agent: target.agent,
          cwd: worktree.path,
          prompt: reviewPrompt(
            options.baseRef,
            findingsPath,
            target.agent,
            options.language,
          ),
          model: target.model,
          reasoning: target.reasoning,
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
            ...(review.exitCode !== 0 && target.model && review.unavailableModel
              ? { unavailableModel: target }
              : {}),
          };
        }
        let findings: ReviewFinding[];
        try {
          findings = parseReviewFindings(await readFile(findingsPath, "utf8"));
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
        const blockingFindings = findings.filter(
          (finding) => finding.severity === "blocking",
        );
        if (blockingFindings.length > 0) {
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
        const dirtyWorktree = !(await worktreeClean(worktree.path));
        return {
          task: options.task,
          accepted: true,
          summary: agent.summary,
          worktreePath: worktree.path,
          branch: worktree.branch,
          logName,
          ...(dirtyWorktree ? { dirtyWorktree: true } : {}),
        };
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
