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
  isReasoningEffort,
  saveConfig,
  type LfiConfig,
  type ReasoningEffort,
  type TaskSource,
} from "./config.js";
import { detectCommands } from "./detect.js";
import { ensureGithubTypeLabels, repoInfo } from "./github.js";
import { localRepoInfo } from "./git.js";
import type { Language } from "./i18n.js";
import { defaultTaskPrompt } from "./prompts.js";
import {
  configureLocalTracker,
  configureTrackerContract,
  LOCAL_IGNORE_BLOCK,
} from "./local-setup.js";

export interface InitOptions {
  cwd: string;
  language: Language;
  model?: string;
  reasoning?: ReasoningEffort;
  retentionDays?: number;
  yes?: boolean;
  advanced?: boolean;
  taskSource?: TaskSource;
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

const askTaskSource = async (language: Language): Promise<TaskSource> => {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await input.question(
    language === "ru"
      ? "Где хранить задачи? [1] Local Markdown  [2] GitHub Issues: "
      : "Where should tasks be stored? [1] Local Markdown  [2] GitHub Issues: ",
  );
  input.close();
  return answer.trim() === "2" ? "github" : "local";
};

const askAdvanced = async (
  config: LfiConfig,
  language: Language,
): Promise<LfiConfig> => {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const label = (english: string, russian: string) =>
    language === "ru" ? russian : english;
  const ask = async (name: string, current: string | number) =>
    (await input.question(`${name} [${current || label("Codex default", "по умолчанию Codex")}] `)).trim() ||
    String(current);
  const codexReasoning = await ask(
    label("Codex reasoning", "Уровень рассуждений Codex"),
    config.CODEX_REASONING_EFFORT,
  );
  const mergerReasoning = await ask(
    label("Merger reasoning", "Уровень рассуждений при слиянии"),
    config.MERGER_REASONING_EFFORT,
  );
  if (!isReasoningEffort(codexReasoning) || !isReasoningEffort(mergerReasoning)) {
    input.close();
    throw new Error(
      label(
        "Unsupported reasoning effort.",
        "Указан неподдерживаемый уровень рассуждений.",
      ),
    );
  }
  const result: LfiConfig = {
    ...config,
    CODEX_MODEL: await ask(label("Codex model", "Модель Codex"), config.CODEX_MODEL),
    CODEX_REASONING_EFFORT: codexReasoning,
    MERGER_MODEL: await ask(
      label("Merger model", "Модель для слияния"),
      config.MERGER_MODEL || config.CODEX_MODEL,
    ),
    MERGER_REASONING_EFFORT: mergerReasoning,
    MAX_PARALLEL: Number(
      await ask(label("Parallel workers", "Параллельных задач"), config.MAX_PARALLEL),
    ),
    MAX_STAGES: Number(
      await ask(label("Maximum stages", "Максимум этапов"), config.MAX_STAGES),
    ),
    IDLE_TIMEOUT_MINUTES: Number(
      await ask(
        label("Idle timeout (minutes)", "Тайм-аут бездействия (минуты)"),
        config.IDLE_TIMEOUT_MINUTES,
      ),
    ),
    BASE_BRANCH: await ask(label("Base branch", "Основная ветка"), config.BASE_BRANCH),
    VALIDATE_COMMAND: await ask(
      label("Validation command", "Команда проверки"),
      config.VALIDATE_COMMAND,
    ),
    WORKTREE_SETUP_COMMAND: await ask(
      label("Worktree setup command", "Команда подготовки worktree"),
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

  const taskSource =
    options.taskSource ??
    (process.stdin.isTTY && !options.yes
      ? await askTaskSource(options.language)
      : "local");
  const [repo, commands] = await Promise.all([
    taskSource === "github"
      ? repoInfo(options.cwd)
      : localRepoInfo(options.cwd),
    detectCommands(options.cwd),
  ]);
  const retentionDays =
    options.retentionDays ??
    (process.stdin.isTTY && !options.yes
      ? await askRetention(options.language)
      : DEFAULT_CONFIG.LOG_RETENTION_DAYS);
  let config: LfiConfig = {
    ...DEFAULT_CONFIG,
    TASK_SOURCE: taskSource,
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
    config = await askAdvanced(config, options.language);
  }

  console.log(
    options.language === "ru"
      ? [
          `Репозиторий: ${repo.nameWithOwner}`,
          `Ветка: ${config.BASE_BRANCH}`,
          `Модель: ${config.CODEX_MODEL || "модель Codex по умолчанию"}`,
          `Уровень рассуждений: ${config.CODEX_REASONING_EFFORT}`,
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
    if (/^n/iu.test(answer.trim())) {
      throw new Error(
        options.language === "ru"
          ? "Инициализация отменена."
          : "Initialization cancelled.",
      );
    }
  }

  if (taskSource === "github") {
    await ensureGithubTypeLabels(options.cwd, repo.nameWithOwner);
  }

  await Promise.all([
    mkdir(join(lfiRoot, "logs"), { recursive: true }),
    mkdir(join(lfiRoot, "state"), { recursive: true }),
    mkdir(join(lfiRoot, "worktrees"), { recursive: true }),
    mkdir(join(lfiRoot, "tasks"), { recursive: true }),
    mkdir(join(lfiRoot, "specs"), { recursive: true }),
  ]);
  await saveConfig(configPath, config);
  await writeFile(
    join(lfiRoot, "task-prompt.md"),
    defaultTaskPrompt(options.language),
    { flag: "wx" },
  );
  const gitignorePath = join(options.cwd, ".gitignore");
  const gitignore = await readFile(gitignorePath, "utf8").catch(() => "");
  const ignoreBlock =
    config.TASK_SOURCE === "local"
      ? LOCAL_IGNORE_BLOCK
      : ".lfi/\n";
  if (config.TASK_SOURCE === "local") {
    await configureLocalTracker(options.cwd, options.language);
  } else {
    await configureTrackerContract(options.cwd, options.language, "github");
    if (!gitignore.includes(ignoreBlock.trim())) {
      await appendFile(
        gitignorePath,
        `${gitignore && !gitignore.endsWith("\n") ? "\n" : ""}${ignoreBlock}`,
      );
    }
  }
  return "created";
};
