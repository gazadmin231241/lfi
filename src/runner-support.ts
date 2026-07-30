import { readFile, writeFile } from "node:fs/promises";

import { runCodex } from "./codex.js";
import type { LfiConfig } from "./config.js";
import { commitWorktreeChanges, git, gitResult } from "./git.js";
import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";
import {
  appendRunLog,
  redactSensitiveText,
  type RunLogContext,
} from "./logs.js";
import { runShell } from "./process.js";

export interface PendingClosure {
  number: number;
  sha: string;
}

export const readPendingClosures = async (
  path: string,
): Promise<PendingClosure[]> => {
  const source = await readFile(path, "utf8").catch(() => "[]");
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is PendingClosure => {
    if (typeof item !== "object" || item === null) return false;
    return (
      typeof Reflect.get(item, "number") === "number" &&
      typeof Reflect.get(item, "sha") === "string"
    );
  });
};

export const writePendingClosures = (
  path: string,
  pending: readonly PendingClosure[],
): Promise<void> =>
  writeFile(path, `${JSON.stringify(pending, null, 2)}\n`);

export const checkpointTracker = async (
  cwd: string,
  message: string,
): Promise<boolean> => {
  const paths = [".lfi/tasks", ".lfi/specs"];
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
  const result = await runCodex({
    cwd: options.cwd,
    prompt: `Resolve the current integration problem in this worktree.

Use $resolving-merge-conflicts when a merge is in progress. Preserve both
intents, run validation, and never abort the merge, deploy, use SSH, force-push,
or touch production. Do not run git add or git commit; the LFI host commits a
successful resolution because the Codex sandbox protects Git metadata.

Context:
${options.context}
`,
    model: options.config.MERGER_MODEL || options.config.CODEX_MODEL,
    reasoning: options.config.MERGER_REASONING_EFFORT,
    gitDirectory: options.gitDirectory,
    log: options.log,
    logName: options.logName,
    idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
    structured: false,
    prefix: "merge",
  });
  if (result.exitCode === 0) {
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
  if (result.exitCode !== 0 || !clean) {
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

export const validateIntegration = async (options: {
  cwd: string;
  config: LfiConfig;
  language: Language;
  log: RunLogContext;
  repair: () => Promise<void>;
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
  if (validation.exitCode !== 0) {
    await options.repair();
    validation = await runShell(options.config.VALIDATE_COMMAND, {
      cwd: options.cwd,
    });
    await logValidation();
  }
  if (validation.exitCode !== 0) {
    throw new ValidationFailure(
      localize(
        options.language,
        `Validation failed:\n${redactSensitiveText(validation.stderr || validation.stdout)}`,
        `Проверка завершилась с ошибкой:\n${redactSensitiveText(validation.stderr || validation.stdout)}`,
      ),
      redactSensitiveText(options.config.VALIDATE_COMMAND),
    );
  }
};
