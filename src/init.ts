import {
  access,
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  DEFAULT_CONFIG,
  saveConfig,
  type LfiConfig,
  type ReasoningEffort,
} from "./config.js";
import { detectCommands } from "./detect.js";
import { repoInfo } from "./github.js";
import type { Language } from "./i18n.js";
import { defaultTaskPrompt } from "./prompts.js";

export interface InitOptions {
  cwd: string;
  language: Language;
  model?: string;
  reasoning?: ReasoningEffort;
  retentionDays?: number;
  yes?: boolean;
  advanced?: boolean;
}

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const askRetention = async (language: Language): Promise<number> => {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await input.question(
    language === "ru"
      ? "Сколько дней хранить логи? [3] "
      : "How many days should logs be retained? [3] ",
  );
  input.close();
  const value = Number(answer.trim() || "3");
  return Number.isFinite(value) && value >= 0 ? value : 3;
};

const askAdvanced = async (config: LfiConfig): Promise<LfiConfig> => {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label: string, current: string | number) =>
    (await input.question(`${label} [${current || "Codex default"}] `)).trim() ||
    String(current);
  const result: LfiConfig = {
    ...config,
    CODEX_MODEL: await ask("Codex model", config.CODEX_MODEL),
    CODEX_REASONING_EFFORT: (await ask(
      "Codex reasoning",
      config.CODEX_REASONING_EFFORT,
    )) as ReasoningEffort,
    MERGER_MODEL: await ask(
      "Merger model",
      config.MERGER_MODEL || config.CODEX_MODEL,
    ),
    MERGER_REASONING_EFFORT: (await ask(
      "Merger reasoning",
      config.MERGER_REASONING_EFFORT,
    )) as ReasoningEffort,
    MAX_PARALLEL: Number(await ask("Parallel workers", config.MAX_PARALLEL)),
    MAX_STAGES: Number(await ask("Maximum stages", config.MAX_STAGES)),
    IDLE_TIMEOUT_MINUTES: Number(
      await ask("Idle timeout (minutes)", config.IDLE_TIMEOUT_MINUTES),
    ),
    BASE_BRANCH: await ask("Base branch", config.BASE_BRANCH),
    ISSUE_LABEL: await ask("Ready issue label", config.ISSUE_LABEL),
    EXCLUDE_LABELS: await ask("Excluded labels", config.EXCLUDE_LABELS),
    VALIDATE_COMMAND: await ask("Validation command", config.VALIDATE_COMMAND),
    WORKTREE_SETUP_COMMAND: await ask(
      "Worktree setup command",
      config.WORKTREE_SETUP_COMMAND,
    ),
  };
  input.close();
  return result;
};

export const initializeProject = async (
  options: InitOptions,
): Promise<"created" | "exists"> => {
  const lfiRoot = join(options.cwd, ".lfi");
  const configPath = join(lfiRoot, "config.env");
  if (await exists(configPath)) return "exists";

  const [repo, commands] = await Promise.all([
    repoInfo(options.cwd),
    detectCommands(options.cwd),
  ]);
  const retentionDays =
    options.retentionDays ??
    (process.stdin.isTTY && !options.yes
      ? await askRetention(options.language)
      : DEFAULT_CONFIG.LOG_RETENTION_DAYS);
  let config: LfiConfig = {
    ...DEFAULT_CONFIG,
    CODEX_MODEL: options.model ?? DEFAULT_CONFIG.CODEX_MODEL,
    CODEX_REASONING_EFFORT:
      options.reasoning ?? DEFAULT_CONFIG.CODEX_REASONING_EFFORT,
    MERGER_REASONING_EFFORT:
      options.reasoning ?? DEFAULT_CONFIG.MERGER_REASONING_EFFORT,
    LOG_RETENTION_DAYS: retentionDays,
    BASE_BRANCH: repo.defaultBranch,
    VALIDATE_COMMAND: commands.validate,
    WORKTREE_SETUP_COMMAND: commands.setup,
  };
  if (options.advanced && process.stdin.isTTY && !options.yes) {
    config = await askAdvanced(config);
  }

  console.log(
    options.language === "ru"
      ? [
          `Репозиторий: ${repo.nameWithOwner}`,
          `Ветка: ${config.BASE_BRANCH}`,
          `Модель: ${config.CODEX_MODEL || "default Codex model"}`,
          `Reasoning: ${config.CODEX_REASONING_EFFORT}`,
          `Параллельно: ${config.MAX_PARALLEL}`,
          `Этапов: ${config.MAX_STAGES}`,
          `Проверка: ${config.VALIDATE_COMMAND || "не определена"}`,
          `Логи: ${config.LOG_RETENTION_DAYS} дн.`,
        ].join("\n")
      : [
          `Repository: ${repo.nameWithOwner}`,
          `Branch: ${config.BASE_BRANCH}`,
          `Model: ${config.CODEX_MODEL || "default Codex model"}`,
          `Reasoning: ${config.CODEX_REASONING_EFFORT}`,
          `Parallel workers: ${config.MAX_PARALLEL}`,
          `Stages: ${config.MAX_STAGES}`,
          `Validation: ${config.VALIDATE_COMMAND || "not detected"}`,
          `Logs: ${config.LOG_RETENTION_DAYS} day(s)`,
        ].join("\n"),
  );

  if (!options.yes && process.stdin.isTTY) {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await input.question(
      options.language === "ru"
        ? "\nСоздать конфигурацию? [Y/n] "
        : "\nCreate configuration? [Y/n] ",
    );
    input.close();
    if (/^n/iu.test(answer.trim())) throw new Error("Initialization cancelled.");
  }

  await Promise.all([
    mkdir(join(lfiRoot, "logs"), { recursive: true }),
    mkdir(join(lfiRoot, "state"), { recursive: true }),
    mkdir(join(lfiRoot, "worktrees"), { recursive: true }),
  ]);
  await saveConfig(configPath, config);
  await writeFile(
    join(lfiRoot, "task-prompt.md"),
    defaultTaskPrompt(options.language),
    { flag: "wx" },
  );
  const gitignorePath = join(options.cwd, ".gitignore");
  const gitignore = await readFile(gitignorePath, "utf8").catch(() => "");
  if (!gitignore.split(/\r?\n/u).includes(".lfi/")) {
    await appendFile(
      gitignorePath,
      `${gitignore && !gitignore.endsWith("\n") ? "\n" : ""}.lfi/\n`,
    );
  }
  return "created";
};
