import { readFile, writeFile } from "node:fs/promises";

import {
  defaultAgentProvider,
  isAgentProvider,
  supportsReasoningEffort,
  type AgentProvider,
} from "./agent-provider.js";
import type { ExecutionTier } from "./execution-tier.js";
import type { Language } from "./i18n.js";
import type { IsolationProvider } from "./isolation-provider.js";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export interface AgentModel {
  agent: AgentProvider;
  model: string;
  reasoning: ReasoningEffort;
}

export interface LfiConfig {
  DEFAULT_MODEL: string;
  LIGHT_MODEL: string;
  STANDARD_MODEL: string;
  DEEP_MODEL: string;
  REASONING_EFFORT: ReasoningEffort;
  MERGER_MODEL: string;
  MERGER_REASONING_EFFORT: ReasoningEffort;
  REVIEWER_MODEL: string;
  REVIEWER_REASONING_EFFORT: ReasoningEffort;
  REVIEW_ENABLED: boolean;
  MAX_REMEDIATION_ROUNDS: number;
  VALIDATION_RETRY_COUNT: number;
  VALIDATION_REPAIR_ATTEMPTS: number;
  MAX_PARALLEL: number;
  MAX_STAGES: number;
  LOG_RETENTION_DAYS: number;
  IDLE_TIMEOUT_MINUTES: number;
  BASE_BRANCH: string;
  VALIDATE_COMMAND: string;
  WORKTREE_SETUP_COMMAND: string;
  ISOLATION_PROVIDER: IsolationProvider;
}

export const DEFAULT_CONFIG: LfiConfig = {
  DEFAULT_MODEL: "",
  LIGHT_MODEL: "",
  STANDARD_MODEL: "",
  DEEP_MODEL: "",
  REASONING_EFFORT: "medium",
  MERGER_MODEL: "",
  MERGER_REASONING_EFFORT: "medium",
  REVIEWER_MODEL: "",
  REVIEWER_REASONING_EFFORT: "medium",
  REVIEW_ENABLED: true,
  MAX_REMEDIATION_ROUNDS: 1,
  VALIDATION_RETRY_COUNT: 1,
  VALIDATION_REPAIR_ATTEMPTS: 2,
  MAX_PARALLEL: 3,
  MAX_STAGES: 10,
  LOG_RETENTION_DAYS: 3,
  IDLE_TIMEOUT_MINUTES: 15,
  BASE_BRANCH: "main",
  VALIDATE_COMMAND: "",
  WORKTREE_SETUP_COMMAND: "",
  ISOLATION_PROVIDER: "local",
};

const configComments = {
  en: {
    models: "Agent and model routing",
    modelHelp: "Format: <cli>:<model>:<reasoning>, for example codex:gpt-5.6-luna:medium",
    execution: "Execution",
    project: "Project commands",
    isolation: "Isolation",
    descriptions: {
      BASE_BRANCH: "branch where results land",
      VALIDATE_COMMAND: "verifies code before merging",
      WORKTREE_SETUP_COMMAND: "prepares each worktree",
      DEFAULT_MODEL: "model used when a tier is left empty",
      LIGHT_MODEL: "model for light work",
      STANDARD_MODEL: "model for standard work",
      DEEP_MODEL: "model for deep work",
      MERGER_MODEL: "model for integration and conflicts",
      REVIEWER_MODEL: "model for review and verification",
      REVIEW_ENABLED: "runs review, remediation, and verification",
      MAX_REMEDIATION_ROUNDS: "maximum remediation rounds after blocking review findings",
      VALIDATION_RETRY_COUNT: "retries after a failed validation command",
      VALIDATION_REPAIR_ATTEMPTS: "model repair attempts after validation retries fail",
      MAX_PARALLEL: "tasks that may run at once",
      MAX_STAGES: "maximum stages per run",
      LOG_RETENTION_DAYS: "days to keep logs",
      IDLE_TIMEOUT_MINUTES: "silent minutes before an agent is treated as stuck",
      ISOLATION_PROVIDER: "local sandboxes execution; none requires a disposable environment",
    },
  },
  ru: {
    models: "Маршрутизация агентов и моделей",
    modelHelp: "Формат: <cli>:<модель>:<reasoning>, например codex:gpt-5.6-luna:medium",
    execution: "Выполнение",
    project: "Команды проекта",
    isolation: "Изоляция",
    descriptions: {
      BASE_BRANCH: "ветка, в которую попадают результаты",
      VALIDATE_COMMAND: "проверяет код перед слиянием",
      WORKTREE_SETUP_COMMAND: "подготавливает каждое рабочее дерево",
      DEFAULT_MODEL: "модель для уровней с пустым значением",
      LIGHT_MODEL: "модель для лёгкой работы",
      STANDARD_MODEL: "модель для стандартной работы",
      DEEP_MODEL: "модель для сложной работы",
      MERGER_MODEL: "модель для интеграции и конфликтов",
      REVIEWER_MODEL: "модель для ревью и верификации",
      REVIEW_ENABLED: "запускает ревью, исправление и верификацию",
      MAX_REMEDIATION_ROUNDS: "максимум раундов исправления после блокирующих замечаний ревью",
      VALIDATION_RETRY_COUNT: "число повторов после ошибки команды проверки",
      VALIDATION_REPAIR_ATTEMPTS: "число модельных ремонтов после неудачных повторов проверки",
      MAX_PARALLEL: "число одновременно выполняемых задач",
      MAX_STAGES: "максимум этапов за запуск",
      LOG_RETENTION_DAYS: "число дней хранения журналов",
      IDLE_TIMEOUT_MINUTES: "минуты молчания до признания агента зависшим",
      ISOLATION_PROVIDER: "local изолирует выполнение; none требует одноразовой среды",
    },
  },
} as const;

const envLines = (
  config: LfiConfig,
  descriptions: Readonly<Partial<Record<keyof LfiConfig, string>>>,
  keys: readonly (keyof LfiConfig)[],
): string[] => keys.map((key) => `${key}=${String(config[key])} # ${descriptions[key]}`);

const formatAgentModel = (
  value: string,
  fallbackReasoning: ReasoningEffort,
): string => {
  if (!value) return "";
  const target = parseAgentModel(value, fallbackReasoning);
  return `${target.agent}:${target.model}:${target.reasoning}`;
};

export const serializeEnvConfig = (
  config: LfiConfig,
  language: Language = "en",
): string => {
  const comments = configComments[language];
  return [
    `# ${comments.project}`,
    ...envLines(config, comments.descriptions, [
      "BASE_BRANCH",
      "VALIDATE_COMMAND",
      "WORKTREE_SETUP_COMMAND",
    ]),
    "",
    `# ${comments.models}`,
    `# ${comments.modelHelp}`,
    `DEFAULT_MODEL=${formatAgentModel(config.DEFAULT_MODEL, config.REASONING_EFFORT)} # ${comments.descriptions.DEFAULT_MODEL}`,
    `LIGHT_MODEL=${formatAgentModel(config.LIGHT_MODEL, config.REASONING_EFFORT)} # ${comments.descriptions.LIGHT_MODEL}`,
    `STANDARD_MODEL=${formatAgentModel(config.STANDARD_MODEL, config.REASONING_EFFORT)} # ${comments.descriptions.STANDARD_MODEL}`,
    `DEEP_MODEL=${formatAgentModel(config.DEEP_MODEL, config.REASONING_EFFORT)} # ${comments.descriptions.DEEP_MODEL}`,
    `MERGER_MODEL=${formatAgentModel(config.MERGER_MODEL, config.MERGER_REASONING_EFFORT)} # ${comments.descriptions.MERGER_MODEL}`,
    `REVIEWER_MODEL=${formatAgentModel(config.REVIEWER_MODEL, config.REVIEWER_REASONING_EFFORT)} # ${comments.descriptions.REVIEWER_MODEL}`,
    "",
    `# ${comments.execution}`,
    ...envLines(config, comments.descriptions, [
      "MAX_PARALLEL",
      "MAX_STAGES",
      "REVIEW_ENABLED",
      "MAX_REMEDIATION_ROUNDS",
      "VALIDATION_RETRY_COUNT",
      "VALIDATION_REPAIR_ATTEMPTS",
      "LOG_RETENTION_DAYS",
      "IDLE_TIMEOUT_MINUTES",
    ]),
    "",
    `# ${comments.isolation}`,
    ...envLines(config, comments.descriptions, ["ISOLATION_PROVIDER"]),
    "",
  ].join("\n");
};

export const parseEnvConfig = (source: string): LfiConfig => {
  const result: LfiConfig = { ...DEFAULT_CONFIG };
  const canonicalKeys = new Set<string>();
  const aliases: Partial<Record<"CODEX_MODEL" | "CODEX_REASONING_EFFORT", string>> = {};
  let serializedWorkerReasoning: ReasoningEffort | undefined;
  let serializedMergerReasoning: ReasoningEffort | undefined;
  let serializedReviewerReasoning: ReasoningEffort | undefined;
  for (const rawLine of source.split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    const separator = rawLine.indexOf("=");
    if (separator < 0) continue;
    const key = rawLine.slice(0, separator).trim();
    const value = rawLine.slice(separator + 1).replace(/\s+#.*$/u, "").trimEnd();
    switch (key) {
      case "DEFAULT_MODEL":
      case "LIGHT_MODEL":
      case "STANDARD_MODEL":
      case "DEEP_MODEL":
      case "MERGER_MODEL":
      case "REVIEWER_MODEL": {
        const reasoningSeparator = value.lastIndexOf(":");
        const possibleReasoning = reasoningSeparator < 0
          ? ""
          : value.slice(reasoningSeparator + 1);
        if (isReasoningEffort(possibleReasoning)) {
          result[key] = value;
          if (key === "MERGER_MODEL") serializedMergerReasoning = possibleReasoning;
          else if (key === "REVIEWER_MODEL") serializedReviewerReasoning = possibleReasoning;
          else serializedWorkerReasoning = possibleReasoning;
        } else result[key] = value;
        canonicalKeys.add(key);
        break;
      }
      case "BASE_BRANCH":
      case "VALIDATE_COMMAND":
      case "WORKTREE_SETUP_COMMAND":
        result[key] = value;
        canonicalKeys.add(key);
        break;
      case "REVIEW_ENABLED":
        if (value === "true") result.REVIEW_ENABLED = true;
        else if (value === "false") result.REVIEW_ENABLED = false;
        else {
          throw new Error(
            `REVIEW_ENABLED must be true or false / должен иметь значение true или false: ${value}`,
          );
        }
        break;
      case "REASONING_EFFORT":
      case "MERGER_REASONING_EFFORT":
      case "REVIEWER_REASONING_EFFORT":
        if (isReasoningEffort(value)) result[key] = value;
        else {
          throw new Error(
            `${key} has an unsupported value / содержит неподдерживаемое значение: ${value}`,
          );
        }
        canonicalKeys.add(key);
        break;
      case "ISOLATION_PROVIDER":
        if (isIsolationProvider(value)) result[key] = value;
        else {
          throw new Error(
            `${key} must be local or none / должен иметь значение local или none: ${value}`,
          );
        }
        break;
      case "CODEX_MODEL":
      case "CODEX_REASONING_EFFORT":
        aliases[key] = value;
        break;
      case "MAX_PARALLEL":
      case "MAX_STAGES":
      case "MAX_REMEDIATION_ROUNDS":
      case "VALIDATION_RETRY_COUNT":
      case "VALIDATION_REPAIR_ATTEMPTS":
      case "LOG_RETENTION_DAYS":
      case "IDLE_TIMEOUT_MINUTES":
        result[key] = Number(value);
        break;
      default:
        break;
    }
  }
  if (!canonicalKeys.has("DEFAULT_MODEL") && aliases.CODEX_MODEL !== undefined) {
    result.DEFAULT_MODEL = aliases.CODEX_MODEL;
  }
  if (!canonicalKeys.has("REASONING_EFFORT") && aliases.CODEX_REASONING_EFFORT !== undefined) {
    if (!isReasoningEffort(aliases.CODEX_REASONING_EFFORT)) {
      throw new Error(
        `CODEX_REASONING_EFFORT has an unsupported value / содержит неподдерживаемое значение: ${aliases.CODEX_REASONING_EFFORT}`,
      );
    }
    result.REASONING_EFFORT = aliases.CODEX_REASONING_EFFORT;
  }
  if (!canonicalKeys.has("REASONING_EFFORT") && serializedWorkerReasoning !== undefined) {
    result.REASONING_EFFORT = serializedWorkerReasoning;
  }
  if (!canonicalKeys.has("MERGER_REASONING_EFFORT") && serializedMergerReasoning !== undefined) {
    result.MERGER_REASONING_EFFORT = serializedMergerReasoning;
  }
  if (!canonicalKeys.has("REVIEWER_REASONING_EFFORT") && serializedReviewerReasoning !== undefined) {
    result.REVIEWER_REASONING_EFFORT = serializedReviewerReasoning;
  }
  return validateConfig(result);
};

const reasoningEfforts = new Set<ReasoningEffort>([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

export const isReasoningEffort = (value: string): value is ReasoningEffort =>
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh" ||
  value === "max" ||
  value === "ultra";

export const parseAgentModel = (
  value: string,
  fallbackReasoning: ReasoningEffort = "medium",
): AgentModel => {
  const separator = value.indexOf(":");
  const agent = separator < 0 ? defaultAgentProvider : value.slice(0, separator);
  if (!isAgentProvider(agent)) {
    throw new Error(
      `Unknown agent in model value ${value} / Неизвестный агент в значении модели ${value}.`,
    );
  }
  const rawModel = separator < 0 ? value : value.slice(separator + 1);
  const reasoningSeparator = separator < 0 ? -1 : rawModel.lastIndexOf(":");
  const possibleReasoning = reasoningSeparator < 0
    ? ""
    : rawModel.slice(reasoningSeparator + 1);
  const reasoning = isReasoningEffort(possibleReasoning)
    ? possibleReasoning
    : fallbackReasoning;
  return {
    agent,
    model: isReasoningEffort(possibleReasoning)
      ? rawModel.slice(0, reasoningSeparator)
      : rawModel,
    reasoning,
  };
};

export const agentModelKey = ({ agent, model }: Pick<AgentModel, "agent" | "model">): string =>
  `${agent}\0${model}`;

export const isIsolationProvider = (
  value: string,
): value is IsolationProvider => value === "local" || value === "none";

export const resolveWorkerModel = (
  config: LfiConfig,
  tier: ExecutionTier,
): AgentModel => {
  const modelByTier: Record<ExecutionTier, string> = {
    light: config.LIGHT_MODEL,
    standard: config.STANDARD_MODEL,
    deep: config.DEEP_MODEL,
  };
  return parseAgentModel(
    modelByTier[tier] || config.DEFAULT_MODEL,
    config.REASONING_EFFORT,
  );
};

export const resolveIntegrationModel = (config: LfiConfig): AgentModel =>
  parseAgentModel(
    config.MERGER_MODEL || config.STANDARD_MODEL || config.DEFAULT_MODEL,
    config.MERGER_REASONING_EFFORT,
  );

export const resolveReviewerModel = (
  config: LfiConfig,
  fallbackTier: ExecutionTier = "standard",
): AgentModel => {
  if (config.REVIEWER_MODEL) {
    return parseAgentModel(config.REVIEWER_MODEL, config.REVIEWER_REASONING_EFFORT);
  }
  return resolveWorkerModel(config, fallbackTier);
};

export const configuredAgents = (config: LfiConfig): ReadonlySet<AgentProvider> =>
  new Set([
    resolveWorkerModel(config, "light").agent,
    resolveWorkerModel(config, "standard").agent,
    resolveWorkerModel(config, "deep").agent,
    resolveIntegrationModel(config).agent,
    resolveReviewerModel(config).agent,
  ]);

export const validateConfig = (config: LfiConfig): LfiConfig => {
  for (const key of ["MAX_PARALLEL", "MAX_STAGES"] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
      throw new Error(
        `${key} must be a positive integer / должен быть положительным целым числом.`,
      );
    }
  }
  if (typeof config.REVIEW_ENABLED !== "boolean") {
    throw new Error(
      "REVIEW_ENABLED must be true or false / должен иметь значение true или false.",
    );
  }
  if (
    !Number.isSafeInteger(config.MAX_REMEDIATION_ROUNDS) ||
    config.MAX_REMEDIATION_ROUNDS < 0
  ) {
    throw new Error(
      "MAX_REMEDIATION_ROUNDS must be zero or greater / должен быть не меньше нуля.",
    );
  }
  for (
    const key of [
      "VALIDATION_RETRY_COUNT",
      "VALIDATION_REPAIR_ATTEMPTS",
    ] as const
  ) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 0) {
      throw new Error(
        `${key} must be zero or greater / должен быть не меньше нуля.`,
      );
    }
  }
  if (
    !Number.isFinite(config.LOG_RETENTION_DAYS) ||
    config.LOG_RETENTION_DAYS < 0
  ) {
    throw new Error(
      "LOG_RETENTION_DAYS must be zero or greater / должен быть не меньше нуля.",
    );
  }
  if (
    !Number.isFinite(config.IDLE_TIMEOUT_MINUTES) ||
    config.IDLE_TIMEOUT_MINUTES <= 0
  ) {
    throw new Error(
      "IDLE_TIMEOUT_MINUTES must be greater than zero / должен быть больше нуля.",
    );
  }
  if (
    !reasoningEfforts.has(config.REASONING_EFFORT) ||
    !reasoningEfforts.has(config.MERGER_REASONING_EFFORT)
    || !reasoningEfforts.has(config.REVIEWER_REASONING_EFFORT)
  ) {
    throw new Error(
      "Reasoning effort must be low, medium, high, xhigh, max, or ultra / уровень рассуждений должен быть одним из перечисленных значений.",
    );
  }
  for (const tier of ["light", "standard", "deep"] as const) {
    const target = resolveWorkerModel(config, tier);
    if (!supportsReasoningEffort(target.agent, target.reasoning)) {
      throw new Error(
        `Agent ${target.agent} cannot honour reasoning=${target.reasoning} for ${tier} / Агент ${target.agent} не поддерживает reasoning=${target.reasoning} для ${tier}.`,
      );
    }
  }
  const merger = resolveIntegrationModel(config);
  if (!supportsReasoningEffort(merger.agent, merger.reasoning)) {
    throw new Error(
      `Agent ${merger.agent} cannot honour reasoning=${merger.reasoning} for merger / Агент ${merger.agent} не поддерживает reasoning=${merger.reasoning} для merger.`,
    );
  }
  const reviewer = resolveReviewerModel(config);
  if (!supportsReasoningEffort(reviewer.agent, reviewer.reasoning)) {
    throw new Error(
      `Agent ${reviewer.agent} cannot honour reasoning=${reviewer.reasoning} for reviewer / Агент ${reviewer.agent} не поддерживает reasoning=${reviewer.reasoning} для reviewer.`,
    );
  }
  if (!isIsolationProvider(config.ISOLATION_PROVIDER)) {
    throw new Error(
      "ISOLATION_PROVIDER must be local or none / должен иметь значение local или none.",
    );
  }
  return config;
};

export const loadConfig = async (path: string): Promise<LfiConfig> =>
  validateConfig(parseEnvConfig(await readFile(path, "utf8")));

export const saveConfig = async (
  path: string,
  config: LfiConfig,
  language: Language = "en",
): Promise<void> =>
  writeFile(path, serializeEnvConfig(validateConfig(config), language), { flag: "wx" });

export const updateConfig = async (
  path: string,
  config: LfiConfig,
  language: Language = "en",
): Promise<void> =>
  writeFile(path, serializeEnvConfig(validateConfig(config), language));
