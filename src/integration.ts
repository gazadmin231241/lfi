import type { LfiConfig } from "./config.js";
import {
  createIntegrationWorktree,
  git,
  gitResult,
  removeWorktreeAndBranch,
} from "./git.js";
import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";
import type { RunLogContext } from "./logs.js";
import type { Attempt } from "./runner-types.js";
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
  onValidationStarted?: () => void;
  beforeDelivery?: (cwd: string) => Promise<void>;
  beforeHostUpdate?: () => Promise<void>;
}): Promise<{ sha: string; preserveIntegration: boolean }> => {
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
    await validateIntegration({
      cwd: integration.path,
      config: options.config,
      language: options.language,
      log: options.log,
      phase: "combined",
      repair: async (diagnostic) => {
        const baseline = await createIntegrationWorktree({
          repoRoot: options.cwd,
          worktreesRoot: options.worktreesRoot,
          baseRef: options.baseRef,
          runId: `${options.runId}-${options.log.iteration}-baseline`,
        });
        try {
          await validateIntegration({
            cwd: baseline.path,
            config: options.config,
            language: options.language,
            log: options.log,
            phase: "baseline",
            repair: async () => undefined,
          });
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
        });
      },
    });
    await options.beforeDelivery?.(integration.path);
    await git(integration.path, [
      "push",
      "origin",
      `HEAD:${options.baseBranch}`,
    ]);
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
          `Could not fast-forward the current branch to the validated result. The work was delivered to origin/${options.baseBranch}, and ${integration.branch} was preserved at ${integration.path}. Reconcile or relocate the divergent local commits, then retry: git merge --ff-only ${integration.branch}`,
          `Не удалось обновить текущую ветку до проверенного результата без создания merge-коммита. Работа доставлена в origin/${options.baseBranch}, а ${integration.branch} сохранена в ${integration.path}. Согласуйте или перенесите расходящиеся локальные коммиты, затем повторите: git merge --ff-only ${integration.branch}`,
        ),
      );
    }
    return {
      sha: (await git(integration.path, ["rev-parse", "HEAD"])).stdout.trim(),
      preserveIntegration,
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
