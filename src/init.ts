import {
  access,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  DEFAULT_CONFIG,
  isIsolationProvider,
  isReasoningEffort,
  saveConfig,
  type LfiConfig,
  type ReasoningEffort,
} from "./config.js";
import { detectCommands } from "./detect.js";
import { repoInfo } from "./github.js";
import type { Language } from "./i18n.js";
import {
  defaultMergePrompt,
  defaultRemediationPrompt,
  defaultReReviewPrompt,
  defaultReviewPrompt,
  defaultTaskPrompt,
} from "./prompts.js";
import { configureLocalTracker } from "./local-setup.js";
import { scaffoldWorkerDockerfile } from "./worker-image.js";

export interface InitOptions {
  cwd: string;
  language: Language;
  model?: string;
  reasoning?: ReasoningEffort;
  retentionDays?: number;
  yes?: boolean;
  advanced?: boolean;
}

const OPENAI_56_PRESET = {
  LIGHT_MODEL: "codex:gpt-5.6-luna:medium",
  STANDARD_MODEL: "codex:gpt-5.6-terra:medium",
  DEEP_MODEL: "codex:gpt-5.6-sol:medium",
} as const;

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const writeDefaultPromptTemplates = async (
  lfiRoot: string,
  language: Language,
): Promise<void> => {
  const promptsDirectory = join(lfiRoot, "prompts");
  await mkdir(promptsDirectory, { recursive: true });
  const templates = [
    ["task.md", defaultTaskPrompt(language)],
    ["review.md", defaultReviewPrompt(language)],
    ["remediation.md", defaultRemediationPrompt(language)],
    ["re-review.md", defaultReReviewPrompt(language)],
    ["merge.md", defaultMergePrompt(language)],
  ] as const;
  const legacyTaskPromptExists = await exists(join(lfiRoot, "task-prompt.md"));
  await Promise.all(templates.map(async ([filename, content]) => {
    if (filename === "task.md" && legacyTaskPromptExists) return;
    try {
      await writeFile(join(promptsDirectory, filename), content, { flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
    }
  }));
};

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

const askRecommendedModelPreset = async (
  language: Language,
): Promise<boolean> => {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await input.question(
    language === "ru"
      ? "Использовать рекомендуемый набор моделей Luna/Terra/Sol? [Y/n] "
      : "Use the recommended Luna/Terra/Sol model preset? [Y/n] ",
  );
  input.close();
  return !/^n/iu.test(answer.trim());
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
    config.REASONING_EFFORT,
  );
  const mergerReasoning = await ask(
    label("Merger reasoning", "Уровень рассуждений при слиянии"),
    config.MERGER_REASONING_EFFORT,
  );
  const reviewerReasoning = await ask(
    label("Reviewer reasoning", "Уровень рассуждений при ревью"),
    config.REVIEWER_REASONING_EFFORT,
  );
  const isolationProvider = await ask(
    label("Isolation provider", "Провайдер изоляции"),
    config.ISOLATION_PROVIDER,
  );
  if (
    !isReasoningEffort(codexReasoning) ||
    !isReasoningEffort(mergerReasoning) ||
    !isReasoningEffort(reviewerReasoning)
  ) {
    input.close();
    throw new Error(
      label(
        "Unsupported reasoning effort.",
        "Указан неподдерживаемый уровень рассуждений.",
      ),
    );
  }
  if (!isIsolationProvider(isolationProvider)) {
    input.close();
    throw new Error(
      label(
        "Isolation provider must be local or none.",
        "Провайдер изоляции должен иметь значение local или none.",
      ),
    );
  }
  const result: LfiConfig = {
    ...config,
    DEFAULT_MODEL: await ask(
      label("Fallback model", "Резервная модель"),
      config.DEFAULT_MODEL,
    ),
    LIGHT_MODEL: await ask(
      label("Model for light tier mapping", "Модель для маршрутизации light"),
      config.LIGHT_MODEL,
    ),
    STANDARD_MODEL: await ask(
      label("Model for standard tier mapping", "Модель для маршрутизации standard"),
      config.STANDARD_MODEL,
    ),
    DEEP_MODEL: await ask(
      label("Model for deep tier mapping", "Модель для маршрутизации deep"),
      config.DEEP_MODEL,
    ),
    REASONING_EFFORT: codexReasoning,
    MERGER_MODEL: await ask(
      label("Merger model", "Модель для слияния"),
      config.MERGER_MODEL,
    ),
    MERGER_REASONING_EFFORT: mergerReasoning,
    REVIEWER_MODEL: await ask(
      label("Reviewer model", "Модель для ревью"),
      config.REVIEWER_MODEL,
    ),
    REVIEWER_REASONING_EFFORT: reviewerReasoning,
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
    ISOLATION_PROVIDER: isolationProvider,
  };
  input.close();
  return result;
};

export const initializeProject = async (
  options: InitOptions,
): Promise<"created" | "exists"> => {
  const lfiRoot = join(options.cwd, ".lfi");
  const configPath = join(lfiRoot, "config.env");
  if (await exists(configPath)) {
    await writeDefaultPromptTemplates(lfiRoot, options.language);
    await configureLocalTracker(options.cwd, options.language);
    return "exists";
  }

  const [repo, commands] = await Promise.all([
    repoInfo(options.cwd),
    detectCommands(options.cwd),
  ]);
  const retentionDays =
    options.retentionDays ??
    (process.stdin.isTTY && !options.yes
      ? await askRetention(options.language)
      : DEFAULT_CONFIG.LOG_RETENTION_DAYS);
  const useRecommendedPreset =
    options.model === undefined &&
    process.stdin.isTTY &&
    !options.yes &&
    (await askRecommendedModelPreset(options.language));
  let config: LfiConfig = {
    ...DEFAULT_CONFIG,
    DEFAULT_MODEL: options.model ?? DEFAULT_CONFIG.DEFAULT_MODEL,
    LIGHT_MODEL:
      options.model ??
      (useRecommendedPreset
        ? OPENAI_56_PRESET.LIGHT_MODEL
        : DEFAULT_CONFIG.LIGHT_MODEL),
    STANDARD_MODEL:
      options.model ??
      (useRecommendedPreset
        ? OPENAI_56_PRESET.STANDARD_MODEL
        : DEFAULT_CONFIG.STANDARD_MODEL),
    DEEP_MODEL:
      options.model ??
      (useRecommendedPreset
        ? OPENAI_56_PRESET.DEEP_MODEL
        : DEFAULT_CONFIG.DEEP_MODEL),
    REASONING_EFFORT:
      options.reasoning ?? DEFAULT_CONFIG.REASONING_EFFORT,
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
          `Модель: ${config.DEFAULT_MODEL || "модель Codex по умолчанию"}`,
          `Маршрутизация: light=${config.LIGHT_MODEL || "fallback"}, standard=${config.STANDARD_MODEL || "fallback"}, deep=${config.DEEP_MODEL || "fallback"}`,
          `Уровень рассуждений: ${config.REASONING_EFFORT}`,
          `Параллельно: ${config.MAX_PARALLEL}`,
          `Этапов: ${config.MAX_STAGES}`,
          `Проверка: ${config.VALIDATE_COMMAND || "не определена"}`,
          `Логи: ${config.LOG_RETENTION_DAYS} дн.`,
        ].join("\n")
      : [
          `Repository: ${repo.nameWithOwner}`,
          `Branch: ${config.BASE_BRANCH}`,
          `Model: ${config.DEFAULT_MODEL || "default Codex model"}`,
          `Routing: light=${config.LIGHT_MODEL || "fallback"}, standard=${config.STANDARD_MODEL || "fallback"}, deep=${config.DEEP_MODEL || "fallback"}`,
          `Reasoning: ${config.REASONING_EFFORT}`,
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

  await Promise.all([
    mkdir(join(lfiRoot, "logs"), { recursive: true }),
    mkdir(join(lfiRoot, "state"), { recursive: true }),
    mkdir(join(lfiRoot, "worktrees"), { recursive: true }),
  ]);
  await saveConfig(configPath, config, options.language);
  await scaffoldWorkerDockerfile(options.cwd);
  await writeDefaultPromptTemplates(lfiRoot, options.language);
  await configureLocalTracker(options.cwd, options.language);
  return "created";
};
