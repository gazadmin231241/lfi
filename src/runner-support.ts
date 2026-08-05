import { writeFile } from "node:fs/promises";

import { runAgent } from "./agent-provider.js";
import {
  resolveIntegrationModel,
  type LfiConfig,
} from "./config.js";
import { commitWorktreeChanges, git, gitResult } from "./git.js";
import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";
import {
  appendRunLog,
  redactSensitiveText,
  type RunLogContext,
} from "./logs.js";
import {
  mergerPrompt,
  type ResolvedPromptTemplate,
} from "./prompts.js";
import { runProjectCommand } from "./project-command.js";
import type { IsolationSession } from "./isolation-provider.js";
import {
  recoverValidation,
  type ValidationDiagnostic,
} from "./validation-recovery.js";

export type { ValidationDiagnostic } from "./validation-recovery.js";

export const checkpointTracker = async (
  cwd: string,
  message: string,
): Promise<boolean> => {
  const paths = [".scratch"];
  const status = await gitResult(cwd, ["status", "--porcelain", "--", ...paths]);
  if (!status.stdout.trim()) return false;
  const changedPaths = paths.filter((path) => status.stdout.includes(`${path}/`));
  await git(cwd, ["add", "--", ...changedPaths]);
  await git(cwd, ["commit", "-m", message, "--", ...changedPaths]);
  return true;
};

/**
 * Runs the configured integration model against one merge or validation
 * problem, requires a clean committed result, and optionally enforces a path
 * allowlist. LFI, not the model, owns the resulting commit.
 */
export const mergeWithAgent = async (options: {
  cwd: string;
  context: string;
  config: LfiConfig;
  gitDirectory: string;
  log: RunLogContext;
  logName: string;
  language: Language;
  allowedPaths?: readonly string[];
  promptTemplate?: ResolvedPromptTemplate;
  commitMessage?: string;
}): Promise<string> => {
  const startingHead = (await git(options.cwd, ["rev-parse", "HEAD"])).stdout.trim();
  const unmerged = (
    await git(options.cwd, [
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=U",
    ])
  ).stdout
    .split("\0")
    .filter(Boolean);
  const fingerprints = new Map(
    await Promise.all(
      unmerged.map(async (path) => {
        const result = await gitResult(options.cwd, [
          "hash-object",
          "--no-filters",
          "--",
          path,
        ]);
        return [path, result.exitCode === 0 ? result.stdout.trim() : undefined] as const;
      }),
    ),
  );
  const result = await runAgent({
    agent: resolveIntegrationModel(options.config).agent,
    cwd: options.cwd,
    prompt: mergerPrompt(
      options.context,
      resolveIntegrationModel(options.config).agent,
      options.language,
      options.allowedPaths,
      options.promptTemplate?.content,
    ),
    model: resolveIntegrationModel(options.config).model,
    reasoning: options.config.MERGER_REASONING_EFFORT,
    gitDirectory: options.gitDirectory,
    log: options.log,
    logName: options.logName,
    idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
    isolationProvider: options.config.ISOLATION_PROVIDER,
    prefix: "merge",
    language: options.language,
  });
  if (result.exitCode === 0 && result.status === "completed") {
    for (const path of unmerged) {
      const current = await gitResult(options.cwd, [
        "hash-object",
        "--no-filters",
        "--",
        path,
      ]);
      const fingerprint =
        current.exitCode === 0 ? current.stdout.trim() : undefined;
      if (fingerprint === fingerprints.get(path)) {
        throw new Error(
          localize(
            options.language,
            `Merger did not resolve ${path}: the conflicted path was unchanged.`,
            `Агент слияния не разрешил ${path}: конфликтующий путь не изменился.`,
          ),
        );
      }
    }
    await commitWorktreeChanges(
      options.cwd,
      options.commitMessage ?? "chore(lfi): resolve integration",
    );
    if (options.allowedPaths) {
      const [tracked, untracked] = await Promise.all([
        git(options.cwd, [
          "diff",
          "--name-only",
          "-z",
          `${startingHead}..HEAD`,
        ]),
        git(options.cwd, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
        ]),
      ]);
      const allowed = new Set(options.allowedPaths);
      const changed = `${tracked.stdout}${untracked.stdout}`
        .split("\0")
        .filter(Boolean);
      const unexpected = changed.filter((path) => !allowed.has(path));
      if (unexpected.length > 0) {
        throw new Error(
          localize(
            options.language,
            `Merger modified paths outside the integrated diff: ${unexpected.join(", ")}`,
            `Агент слияния изменил пути вне объединённого diff: ${unexpected.join(", ")}`,
          ),
        );
      }
    }
  }
  const endingHead = (await git(options.cwd, ["rev-parse", "HEAD"])).stdout.trim();
  const clean =
    (await git(options.cwd, ["status", "--porcelain"])).stdout.trim() === "";
  if (
    result.exitCode !== 0 ||
    result.status !== "completed" ||
    startingHead === endingHead ||
    !clean
  ) {
    throw new Error(
      localize(
        options.language,
        `Merger failed: ${result.summary}`,
        `Агент слияния завершился с ошибкой: ${result.summary}`,
      ),
    );
  }
  return result.summary;
};

/** A red repository gate with redacted diagnostics safe for repair prompts. */
export class ValidationFailure extends Error {
  readonly command: string;
  readonly diagnostic: ValidationDiagnostic;

  constructor(
    message: string,
    command: string,
    diagnostic: ValidationDiagnostic,
  ) {
    super(message);
    this.name = "ValidationFailure";
    this.command = command;
    this.diagnostic = diagnostic;
  }
}

/**
 * Runs the configured repository gate with bounded command retries and, for a
 * combined worktree, bounded model repair callbacks. Every repair is observed
 * through a fresh full validation; a red baseline never invokes repair here.
 */
export const validateIntegration = async (options: {
  cwd: string;
  config: LfiConfig;
  gitDirectory: string;
  language: Language;
  log: RunLogContext;
  phase: "baseline" | "combined";
  repair: (
    diagnostic: ValidationDiagnostic,
    repairAttempt: number,
  ) => Promise<void>;
  diagnose?: (diagnostic: ValidationDiagnostic) => Promise<void>;
  session?: IsolationSession;
}): Promise<void> => {
  if (options.config.WORKTREE_SETUP_COMMAND) {
    const setup = await runProjectCommand({
      command: options.config.WORKTREE_SETUP_COMMAND,
      cwd: options.cwd,
      gitDirectory: options.gitDirectory,
      isolationProvider: options.config.ISOLATION_PROVIDER,
      ...(options.session ? { session: options.session } : {}),
    });
    if (setup.exitCode !== 0) {
      throw new Error(
        localize(
          options.language,
          `Integration setup failed:\n${redactSensitiveText(setup.stderr || setup.stdout)}`,
          `Подготовка общего worktree завершилась с ошибкой:\n${redactSensitiveText(setup.stderr || setup.stdout)}`,
        ),
      );
    }
  }
  let validationRun = 0;
  const runValidation = async () => {
    validationRun += 1;
    const validation = await runProjectCommand({
      command: options.config.VALIDATE_COMMAND,
      cwd: options.cwd,
      gitDirectory: options.gitDirectory,
      isolationProvider: options.config.ISOLATION_PROVIDER,
      ...(options.session ? { session: options.session } : {}),
    });
    await appendRunLog(
      options.log,
      "integration",
      [
        `phase=${options.phase}; validation-run=${validationRun}`,
        `$ ${options.config.VALIDATE_COMMAND}`,
        validation.stdout,
        validation.stderr,
        `exit=${validation.exitCode}`,
      ].filter(Boolean),
    );
    return validation;
  };
  const diagnostic = await recoverValidation({
    command: options.config.VALIDATE_COMMAND,
    retryCount: options.config.VALIDATION_RETRY_COUNT,
    repairAttempts: options.phase === "combined"
      ? options.config.VALIDATION_REPAIR_ATTEMPTS
      : 0,
    run: runValidation,
    ...(options.phase === "combined" && options.diagnose
      ? { diagnose: options.diagnose }
      : {}),
    ...(options.phase === "combined" ? { repair: options.repair } : {}),
  });
  if (diagnostic) {
    throw new ValidationFailure(
      localize(
        options.language,
        options.phase === "baseline"
          ? `Baseline validation failed; combined repair was skipped:\n${diagnostic.stderr || diagnostic.stdout}`
          : `Validation failed:\n${diagnostic.stderr || diagnostic.stdout}`,
        options.phase === "baseline"
          ? `Проверка базовой ревизии завершилась с ошибкой; исправление объединённых изменений не запускалось:\n${diagnostic.stderr || diagnostic.stdout}`
          : `Проверка завершилась с ошибкой:\n${diagnostic.stderr || diagnostic.stdout}`,
      ),
      diagnostic.command,
      diagnostic,
    );
  }
};
