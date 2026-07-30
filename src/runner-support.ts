import { readFile, writeFile } from "node:fs/promises";

import { runCodex } from "./codex.js";
import type { LfiConfig } from "./config.js";
import { commitWorktreeChanges, git, gitResult } from "./git.js";
import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";
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
  logsDirectory: string;
  logName: string;
  language: Language;
}): Promise<void> => {
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
    logsDirectory: options.logsDirectory,
    logName: options.logName,
    idleTimeoutMinutes: options.config.IDLE_TIMEOUT_MINUTES,
    structured: false,
    prefix: "merge",
  });
  if (result.exitCode === 0) {
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

export const validateIntegration = async (options: {
  cwd: string;
  config: LfiConfig;
  language: Language;
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
          `Integration setup failed:\n${setup.stderr || setup.stdout}`,
          `Подготовка общего worktree завершилась с ошибкой:\n${setup.stderr || setup.stdout}`,
        ),
      );
    }
  }
  let validation = await runShell(options.config.VALIDATE_COMMAND, {
    cwd: options.cwd,
    onStdout: (chunk) => process.stdout.write(`[validate] ${chunk}`),
    onStderr: (chunk) => process.stderr.write(`[validate] ${chunk}`),
  });
  if (validation.exitCode !== 0) {
    await options.repair();
    validation = await runShell(options.config.VALIDATE_COMMAND, {
      cwd: options.cwd,
    });
  }
  if (validation.exitCode !== 0) {
    throw new Error(
      localize(
        options.language,
        `Validation failed:\n${validation.stderr || validation.stdout}`,
        `Проверка завершилась с ошибкой:\n${validation.stderr || validation.stdout}`,
      ),
    );
  }
};
