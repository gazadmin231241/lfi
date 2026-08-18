import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  DEFAULT_CONFIG,
  isIsolationProvider,
  loadConfig,
  saveConfig,
  serializeEnvConfig,
  updateConfig,
  type LfiConfig,
  type ReasoningEffort,
} from "./config.js";
import { detectCommands } from "./detect.js";
import { repoInfo } from "./github.js";
import type { Language } from "./i18n.js";
import {
  applyBindingsToConfig,
  runModelBindingPicker,
  type ModelBindings,
} from "./model-binding-picker.js";
import {
  defaultMergePrompt,
  defaultRemediationPrompt,
  defaultReReviewPrompt,
  defaultReviewPrompt,
  defaultTaskPrompt,
  legacyDefaultReReviewPrompts,
  legacyDefaultTaskPrompts,
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

const DEFAULT_PRESET_BINDINGS: ModelBindings = {
  DEFAULT: "codex:gpt-5.6-terra:medium",
  light: "codex:gpt-5.6-luna:medium",
  standard: "codex:gpt-5.6-terra:medium",
  deep: "codex:gpt-5.6-sol:medium",
  merger: "",
  reviewer: "",
};

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const stockTaskPrompts: readonly string[] = [
  defaultTaskPrompt("en"),
  defaultTaskPrompt("ru"),
  ...legacyDefaultTaskPrompts,
];

const writeDefaultPromptTemplates = async (
  lfiRoot: string,
  language: Language,
): Promise<boolean> => {
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
  const results = await Promise.all(templates.map(async ([filename, content]) => {
    const path = join(promptsDirectory, filename);
    if (filename === "task.md" && legacyTaskPromptExists && !(await exists(path))) {
      const legacy = await readFile(join(lfiRoot, "task-prompt.md"), "utf8");
      const isStock = stockTaskPrompts.includes(legacy);
      if (!isStock) return false;
    }
    if (await exists(path)) {
      const current = await readFile(path, "utf8");
      const stock = filename === "task.md"
        ? stockTaskPrompts
        : filename === "review.md"
          ? [defaultReviewPrompt("en"), defaultReviewPrompt("ru")]
          : filename === "remediation.md"
            ? [defaultRemediationPrompt("en"), defaultRemediationPrompt("ru")]
            : filename === "re-review.md"
              ? [
                  defaultReReviewPrompt("en"),
                  defaultReReviewPrompt("ru"),
                  ...legacyDefaultReReviewPrompts,
                ]
              : [defaultMergePrompt("en"), defaultMergePrompt("ru")];
      if (!stock.includes(current) || current === content) return false;
      await writeFile(path, content);
      return true;
    }
    try {
      await writeFile(path, content, { flag: "wx" });
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
      return false;
    }
  }));
  return results.some(Boolean);
};

const reconcileConfig = async (configPath: string, language: Language): Promise<boolean> => {
  const source = await readFile(configPath, "utf8");
  const present = new Set(
    source.split(/\r?\n/u)
      .map((line) => /^\s*([A-Z_]+)=/u.exec(line)?.[1])
      .filter((key): key is string => key !== undefined),
  );
  const current = await loadConfig(configPath);
  const missing = serializeEnvConfig(current, language)
    .split("\n")
    .filter((line) => {
      const key = /^([A-Z_]+)=/u.exec(line)?.[1];
      return key !== undefined && !present.has(key);
    });
  if (missing.length === 0) return false;
  const heading = language === "ru"
    ? "# Добавлено повторным `lfi init`"
    : "# Added by repeated `lfi init`";
  await writeFile(configPath, `${source.trimEnd()}\n\n${heading}\n${missing.join("\n")}\n`);
  return true;
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

const askAdvanced = async (
  config: LfiConfig,
  language: Language,
): Promise<LfiConfig> => {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const label = (english: string, russian: string) =>
    language === "ru" ? russian : english;
  const ask = async (name: string, current: string | number) =>
    (await input.question(`${name} [${current || label("not set", "не определена")}] `)).trim() ||
    String(current);

  const baseBranch = await ask(label("Base branch", "Основная ветка"), config.BASE_BRANCH);
  const validateCommand = await ask(
    label("Validation command", "Команда проверки"),
    config.VALIDATE_COMMAND,
  );
  const worktreeSetupCommand = await ask(
    label("Worktree setup command", "Команда подготовки worktree"),
    config.WORKTREE_SETUP_COMMAND,
  );
  const maxParallel = Number(
    await ask(label("Parallel workers", "Параллельных задач"), config.MAX_PARALLEL),
  );
  const maxStages = Number(
    await ask(label("Maximum stages", "Максимум этапов"), config.MAX_STAGES),
  );
  const idleTimeout = Number(
    await ask(
      label("Idle timeout (minutes)", "Тайм-аут бездействия (минуты)"),
      config.IDLE_TIMEOUT_MINUTES,
    ),
  );
  const isolationProvider = await ask(
    label("Isolation provider", "Провайдер изоляции"),
    config.ISOLATION_PROVIDER,
  );

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
    BASE_BRANCH: baseBranch,
    VALIDATE_COMMAND: validateCommand,
    WORKTREE_SETUP_COMMAND: worktreeSetupCommand,
    MAX_PARALLEL: maxParallel,
    MAX_STAGES: maxStages,
    IDLE_TIMEOUT_MINUTES: idleTimeout,
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
    const showPicker = process.stdin.isTTY && !options.yes && options.model === undefined;
    if (showPicker) {
      const existing = await loadConfig(configPath);
      const initialBindings: Partial<ModelBindings> = {
        DEFAULT: existing.DEFAULT_MODEL,
        light: existing.LIGHT_MODEL,
        standard: existing.STANDARD_MODEL,
        deep: existing.DEEP_MODEL,
        merger: existing.MERGER_MODEL,
        reviewer: existing.REVIEWER_MODEL,
      };
      const chosen = await runModelBindingPicker({
        initialBindings,
        language: options.language,
      });
      if (chosen === null) {
        return "exists";
      }
      let config = applyBindingsToConfig(existing, chosen);
      if (options.retentionDays !== undefined) {
        config.LOG_RETENTION_DAYS = options.retentionDays;
      }
      if (options.advanced) {
        config = await askAdvanced(config, options.language);
      }
      await updateConfig(configPath, config, options.language);
      await Promise.all([
        writeDefaultPromptTemplates(lfiRoot, options.language),
      ]);
      await configureLocalTracker(options.cwd, options.language);
      return "exists";
    }

    const reconfigure = options.model !== undefined ||
      options.reasoning !== undefined ||
      options.retentionDays !== undefined ||
      (options.advanced === true && process.stdin.isTTY && !options.yes);
    if (reconfigure) {
      const existing = await loadConfig(configPath);
      let config: LfiConfig = {
        ...existing,
        ...(options.model === undefined
          ? {}
          : {
              DEFAULT_MODEL: options.model,
              LIGHT_MODEL: options.model,
              STANDARD_MODEL: options.model,
              DEEP_MODEL: options.model,
            }),
        ...(options.reasoning === undefined
          ? {}
          : {
              REASONING_EFFORT: options.reasoning,
              MERGER_REASONING_EFFORT: options.reasoning,
              REVIEWER_REASONING_EFFORT: options.reasoning,
            }),
        ...(options.retentionDays === undefined
          ? {}
          : { LOG_RETENTION_DAYS: options.retentionDays }),
      };
      if (options.advanced && process.stdin.isTTY && !options.yes) {
        config = await askAdvanced(config, options.language);
      }
      await updateConfig(configPath, config, options.language);
    }
    await Promise.all([
      writeDefaultPromptTemplates(lfiRoot, options.language),
      reconfigure ? Promise.resolve(false) : reconcileConfig(configPath, options.language),
    ]);
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
  const showPicker =
    process.stdin.isTTY && !options.yes && options.model === undefined;

  let config: LfiConfig;
  if (showPicker) {
    const chosen = await runModelBindingPicker({
      initialBindings: DEFAULT_PRESET_BINDINGS,
      language: options.language,
    });
    if (chosen === null) {
      throw new Error(
        options.language === "ru"
          ? "Инициализация отменена."
          : "Initialization cancelled.",
      );
    }
    config = applyBindingsToConfig(
      {
        ...DEFAULT_CONFIG,
        LOG_RETENTION_DAYS: retentionDays,
        BASE_BRANCH: repo.defaultBranch,
        VALIDATE_COMMAND: commands.validate,
        WORKTREE_SETUP_COMMAND: commands.setup,
      },
      chosen,
    );
    if (options.advanced) {
      config = await askAdvanced(config, options.language);
    }
  } else {
    config = {
      ...DEFAULT_CONFIG,
      DEFAULT_MODEL: options.model ?? DEFAULT_CONFIG.DEFAULT_MODEL,
      LIGHT_MODEL: options.model ?? DEFAULT_CONFIG.LIGHT_MODEL,
      STANDARD_MODEL: options.model ?? DEFAULT_CONFIG.STANDARD_MODEL,
      DEEP_MODEL: options.model ?? DEFAULT_CONFIG.DEEP_MODEL,
      REASONING_EFFORT:
        options.reasoning ?? DEFAULT_CONFIG.REASONING_EFFORT,
      MERGER_REASONING_EFFORT:
        options.reasoning ?? DEFAULT_CONFIG.MERGER_REASONING_EFFORT,
      REVIEWER_REASONING_EFFORT:
        options.reasoning ?? DEFAULT_CONFIG.REVIEWER_REASONING_EFFORT,
      LOG_RETENTION_DAYS: retentionDays,
      BASE_BRANCH: repo.defaultBranch,
      VALIDATE_COMMAND: commands.validate,
      WORKTREE_SETUP_COMMAND: commands.setup,
    };
    if (options.advanced && process.stdin.isTTY && !options.yes) {
      config = await askAdvanced(config, options.language);
    }
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
