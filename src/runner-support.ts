import { writeFile } from "node:fs/promises";

import { defaultAgentProvider, runAgent } from "./agent-provider.js";
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
import { runShell } from "./process.js";
import { mergerPrompt } from "./prompts.js";

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

export const mergeWithAgent = async (options: {
  cwd: string;
  context: string;
  config: LfiConfig;
  gitDirectory: string;
  log: RunLogContext;
  logName: string;
  language: Language;
  allowedPaths?: readonly string[];
}): Promise<void> => {
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
    agent: defaultAgentProvider,
    cwd: options.cwd,
    prompt: mergerPrompt(
      options.context,
      options.language,
      options.allowedPaths,
    ),
    model: resolveIntegrationModel(options.config),
    reasoning: options.config.MERGER_REASONING_EFFORT,
    gitDirectory: options.gitDirectory,
    log: options.log,
    logName: options.logName,
    idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
    prefix: "merge",
    language: options.language,
  });
  if (result.exitCode === 0 && result.status === "completed") {
    if (options.allowedPaths) {
      const [tracked, untracked] = await Promise.all([
        git(options.cwd, ["diff", "--name-only", "-z", "HEAD"]),
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
    if (unmerged.length > 0) await git(options.cwd, ["add", "--all"]);
    await commitWorktreeChanges(
      options.cwd,
      "chore(lfi): resolve integration",
    );
  }
  const clean =
    (await git(options.cwd, ["status", "--porcelain"])).stdout.trim() === "";
  if (result.exitCode !== 0 || result.status !== "completed" || !clean) {
    throw new Error(
      localize(
        options.language,
        `Merger failed: ${result.summary}`,
        `Агент слияния завершился с ошибкой: ${result.summary}`,
      ),
    );
  }
};

export class ValidationFailure extends Error {
  readonly command: string;

  constructor(message: string, command: string) {
    super(message);
    this.name = "ValidationFailure";
    this.command = command;
  }
}

export interface ValidationDiagnostic {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export const validateIntegration = async (options: {
  cwd: string;
  config: LfiConfig;
  language: Language;
  log: RunLogContext;
  phase: "baseline" | "combined";
  repair: (diagnostic: ValidationDiagnostic) => Promise<void>;
}): Promise<void> => {
  if (options.config.WORKTREE_SETUP_COMMAND) {
    const setup = await runShell(options.config.WORKTREE_SETUP_COMMAND, {
      cwd: options.cwd,
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
  let validation = await runShell(options.config.VALIDATE_COMMAND, {
    cwd: options.cwd,
  });
  const logValidation = () =>
    appendRunLog(
      options.log,
      "integration",
      [
        `$ ${options.config.VALIDATE_COMMAND}`,
        validation.stdout,
        validation.stderr,
        `exit=${validation.exitCode}`,
      ].filter(Boolean),
    );
  await logValidation();
  if (validation.exitCode !== 0 && options.phase === "combined") {
    await options.repair({
      command: redactSensitiveText(options.config.VALIDATE_COMMAND),
      exitCode: validation.exitCode,
      stdout: redactSensitiveText(validation.stdout),
      stderr: redactSensitiveText(validation.stderr),
    });
    validation = await runShell(options.config.VALIDATE_COMMAND, {
      cwd: options.cwd,
    });
    await logValidation();
  }
  if (validation.exitCode !== 0) {
    throw new ValidationFailure(
      localize(
        options.language,
        options.phase === "baseline"
          ? `Baseline validation failed; combined repair was skipped:\n${redactSensitiveText(validation.stderr || validation.stdout)}`
          : `Validation failed:\n${redactSensitiveText(validation.stderr || validation.stdout)}`,
        options.phase === "baseline"
          ? `Проверка базовой ревизии завершилась с ошибкой; исправление объединённых изменений не запускалось:\n${redactSensitiveText(validation.stderr || validation.stdout)}`
          : `Проверка завершилась с ошибкой:\n${redactSensitiveText(validation.stderr || validation.stdout)}`,
      ),
      redactSensitiveText(options.config.VALIDATE_COMMAND),
    );
  }
};
