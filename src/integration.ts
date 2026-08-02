import { resolveIntegrationModel, type LfiConfig } from "./config.js";
import { homedir } from "node:os";
import {
  createIntegrationWorktree,
  git,
  gitResult,
  removeWorktreeAndBranch,
} from "./git.js";
import { withGithubRetry } from "./github-resilience.js";
import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";
import {
  isCompletedLocalTaskPath,
  localCompletionCommitSubject,
} from "./local-run-state.js";
import type { RunLogContext } from "./logs.js";
import type { PromptTemplates } from "./prompts.js";
import type { Attempt } from "./runner-types.js";
import {
  openIsolationSession,
  resolveGitIdentity,
  withIsolationSession,
} from "./isolation-provider.js";
import {
  mergeWithAgent,
  validateIntegration,
  ValidationFailure,
  type ValidationDiagnostic,
} from "./runner-support.js";

const formatValidationDiagnostic = (
  diagnostic: ValidationDiagnostic,
): string =>
  [
    "Combined validation failed while the same command passes on the base revision.",
    "Repair only the regression introduced by the integrated task branches.",
    "",
    `Configured command: ${diagnostic.command}`,
    `Exit code: ${diagnostic.exitCode}`,
    "",
    "stdout:",
    diagnostic.stdout || "(empty)",
    "",
    "stderr:",
    diagnostic.stderr || "(empty)",
  ].join("\n");

const verifyCompletionCheckpoint = async (
  cwd: string,
  attempts: readonly Attempt[],
  language: Language,
): Promise<void> => {
  const ids = attempts.map((attempt) => attempt.task.id);
  const [trackedTasks, subject] = await Promise.all([
    git(cwd, ["ls-files", "-z", "--", ".scratch"]),
    git(cwd, ["log", "-1", "--format=%s"]),
  ]);
  const trackedPaths = trackedTasks.stdout.split("\0").filter(Boolean);
  const missing = ids.filter(
    (id) => !trackedPaths.some((path) => isCompletedLocalTaskPath(path, id)),
  );
  const expectedSubject = localCompletionCommitSubject(ids);
  if (missing.length === 0 && subject.stdout.trim() === expectedSubject) return;
  const affected = missing.length > 0 ? missing : ids;
  throw new Error(
    localize(
      language,
      `Completion checkpoint is missing for ${affected.join(", ")}.`,
      `Отсутствует checkpoint завершения для ${affected.join(", ")}.`,
    ),
  );
};

export const integrateAttempts = async (options: {
  cwd: string;
  worktreesRoot: string;
  baseRef: string;
  baseBranch: string;
  runId: string;
  log: RunLogContext;
  attempts: Attempt[];
  config: LfiConfig;
  gitDirectory: string;
  language: Language;
  promptTemplates?: PromptTemplates;
  onValidationStarted?: () => void;
  beforeDelivery: (cwd: string) => Promise<void>;
  beforeHostUpdate?: () => Promise<void>;
}): Promise<{
  sha: string;
  preserveIntegration: boolean;
  delivered: true;
  push: "pushed" | "deferred";
  pushNote?: string;
}> => {
  const integrationAgent = resolveIntegrationModel(options.config).agent;
  const integration = await createIntegrationWorktree({
    repoRoot: options.cwd,
    worktreesRoot: options.worktreesRoot,
    baseRef: options.baseRef,
    runId: `${options.runId}-${options.log.iteration}`,
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
          context: `Merge ${attempt.branch} for ${attempt.task.id}.\n${attempt.task.body}`,
          config: options.config,
          gitDirectory: options.gitDirectory,
          log: options.log,
          logName: "integration",
          language: options.language,
          ...(options.promptTemplates
            ? { promptTemplate: options.promptTemplates.merge }
            : {}),
        });
      }
    }
    options.onValidationStarted?.();
    const integratedPaths = (
      await git(integration.path, [
        "diff",
        "--name-only",
        "-z",
        `${options.baseRef}..HEAD`,
      ])
    ).stdout
      .split("\0")
      .filter(Boolean);
    const identity =
      options.config.ISOLATION_PROVIDER === "none"
        ? {}
        : await resolveGitIdentity(integration.path);
    await withIsolationSession(
      () =>
        openIsolationSession({
          provider: options.config.ISOLATION_PROVIDER,
          agent: integrationAgent,
          worktree: integration.path,
          gitDirectory: options.gitDirectory,
          homeDirectory: homedir(),
          environment: process.env,
          identity,
        }),
      async (session) =>
        validateIntegration({
          cwd: integration.path,
          config: options.config,
          gitDirectory: options.gitDirectory,
          language: options.language,
          log: options.log,
          phase: "combined",
          session,
          repair: async (diagnostic) => {
            const baseline = await createIntegrationWorktree({
              repoRoot: options.cwd,
              worktreesRoot: options.worktreesRoot,
              baseRef: options.baseRef,
              runId: `${options.runId}-${options.log.iteration}-baseline`,
            });
            try {
              const baselineIdentity =
                options.config.ISOLATION_PROVIDER === "none"
                  ? {}
                  : await resolveGitIdentity(baseline.path);
              await withIsolationSession(
                () =>
                  openIsolationSession({
                    provider: options.config.ISOLATION_PROVIDER,
                    agent: integrationAgent,
                    worktree: baseline.path,
                    gitDirectory: options.gitDirectory,
                    homeDirectory: homedir(),
                    environment: process.env,
                    identity: baselineIdentity,
                  }),
                async (baselineSession) =>
                  validateIntegration({
                    cwd: baseline.path,
                    config: options.config,
                    gitDirectory: options.gitDirectory,
                    language: options.language,
                    log: options.log,
                    phase: "baseline",
                    session: baselineSession,
                    repair: async () => undefined,
                  }),
              );
            } finally {
              await removeWorktreeAndBranch({
                repoRoot: options.cwd,
                path: baseline.path,
                branch: baseline.branch,
              }).catch(() => undefined);
            }
            await mergeWithAgent({
              cwd: integration.path,
              context: formatValidationDiagnostic(diagnostic),
              config: options.config,
              gitDirectory: options.gitDirectory,
              log: options.log,
              logName: "integration",
              language: options.language,
              allowedPaths: integratedPaths,
              ...(options.promptTemplates
                ? { promptTemplate: options.promptTemplates.merge }
                : {}),
            });
          },
        }),
    );
    await options.beforeDelivery(integration.path);
    await verifyCompletionCheckpoint(
      integration.path,
      options.attempts,
      options.language,
    );
    await options.beforeHostUpdate?.();
    const hostUpdate = await gitResult(options.cwd, [
      "merge",
      integration.branch,
      "--ff-only",
    ]);
    if (hostUpdate.exitCode !== 0) {
      preserveIntegration = true;
      throw new Error(
        localize(
          options.language,
          `Could not fast-forward local ${options.baseBranch} to the validated result, so nothing was delivered. Reconcile or relocate the divergent local commits, then retry: git merge --ff-only ${integration.branch}. The integration branch was preserved at ${integration.path}.`,
          `Не удалось обновить локальную ${options.baseBranch} до проверенного результата fast-forward, работа не доставлена. Согласуйте или перенесите расходящиеся локальные коммиты, затем повторите: git merge --ff-only ${integration.branch}. Интеграционная ветка сохранена в ${integration.path}.`,
        ),
      );
    }
    const sha = (await git(options.cwd, ["rev-parse", "HEAD"])).stdout.trim();
    let push: "pushed" | "deferred" = "pushed";
    let pushNote: string | undefined;
    try {
      await withGithubRetry(
        () => git(options.cwd, ["push", "origin", options.baseBranch]),
        { attempts: 2 },
      );
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error))
        .trim()
        .split("\n")[0];
      push = "deferred";
      pushNote = localize(
        options.language,
        `Delivered locally; push to origin/${options.baseBranch} failed and will be retried at the start of the next run. ${reason}`,
        `Доставлено локально; push в origin/${options.baseBranch} не удался и будет повторён в начале следующего прогона. ${reason}`,
      );
    }
    return {
      sha,
      preserveIntegration,
      delivered: true,
      push,
      ...(pushNote === undefined ? {} : { pushNote }),
    };
  } catch (error) {
    if (preserveIntegration) throw error;
    preserveIntegration = true;
    const reason = error instanceof Error ? error.message : String(error);
    const preservation = localize(
      options.language,
      `Preserved integration branch ${integration.branch} at ${integration.path}.`,
      `Интеграционная ветка ${integration.branch} сохранена в ${integration.path}.`,
    );
    if (error instanceof ValidationFailure) {
      throw new ValidationFailure(`${reason}\n${preservation}`, error.command);
    }
    throw new Error(`${reason}\n${preservation}`);
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
