import { readFile, writeFile } from "node:fs/promises";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type TaskSource = "local" | "github";

export interface LfiConfig {
  TASK_SOURCE: TaskSource;
  GITHUB_REPO: string;
  CODEX_MODEL: string;
  CODEX_REASONING_EFFORT: ReasoningEffort;
  MERGER_MODEL: string;
  MERGER_REASONING_EFFORT: ReasoningEffort;
  MAX_PARALLEL: number;
  MAX_STAGES: number;
  LOG_RETENTION_DAYS: number;
  IDLE_TIMEOUT_MINUTES: number;
  BASE_BRANCH: string;
  ISSUE_LABEL: string;
  EXCLUDE_LABELS: string;
  VALIDATE_COMMAND: string;
  WORKTREE_SETUP_COMMAND: string;
}

export const DEFAULT_CONFIG: LfiConfig = {
  TASK_SOURCE: "local",
  GITHUB_REPO: "",
  CODEX_MODEL: "",
  CODEX_REASONING_EFFORT: "medium",
  MERGER_MODEL: "",
  MERGER_REASONING_EFFORT: "medium",
  MAX_PARALLEL: 3,
  MAX_STAGES: 10,
  LOG_RETENTION_DAYS: 3,
  IDLE_TIMEOUT_MINUTES: 15,
  BASE_BRANCH: "main",
  ISSUE_LABEL: "ready-for-agent",
  EXCLUDE_LABELS: "blocked,needs-info,ready-for-human",
  VALIDATE_COMMAND: "",
  WORKTREE_SETUP_COMMAND: "",
};

export const serializeEnvConfig = (config: LfiConfig): string =>
  `${Object.entries(config)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n")}\n`;

export const parseEnvConfig = (source: string): LfiConfig => {
  const result: LfiConfig = { ...DEFAULT_CONFIG, TASK_SOURCE: "github" };
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    switch (key) {
      case "CODEX_MODEL":
      case "MERGER_MODEL":
      case "GITHUB_REPO":
      case "BASE_BRANCH":
      case "ISSUE_LABEL":
      case "EXCLUDE_LABELS":
      case "VALIDATE_COMMAND":
      case "WORKTREE_SETUP_COMMAND":
        result[key] = value;
        break;
      case "TASK_SOURCE":
        if (value === "local" || value === "github") result.TASK_SOURCE = value;
        else {
          throw new Error(
            `TASK_SOURCE must be local or github / должен быть local или github: ${value}`,
          );
        }
        break;
      case "CODEX_REASONING_EFFORT":
      case "MERGER_REASONING_EFFORT":
        if (isReasoningEffort(value)) result[key] = value;
        else {
          throw new Error(
            `${key} has an unsupported value / содержит неподдерживаемое значение: ${value}`,
          );
        }
        break;
      case "MAX_PARALLEL":
      case "MAX_STAGES":
      case "LOG_RETENTION_DAYS":
      case "IDLE_TIMEOUT_MINUTES":
        result[key] = Number(value);
        break;
      default:
        break;
    }
  }
  return result;
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

export const validateConfig = (config: LfiConfig): LfiConfig => {
  for (const key of ["MAX_PARALLEL", "MAX_STAGES"] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
      throw new Error(
        `${key} must be a positive integer / должен быть положительным целым числом.`,
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
    !reasoningEfforts.has(config.CODEX_REASONING_EFFORT) ||
    !reasoningEfforts.has(config.MERGER_REASONING_EFFORT)
  ) {
    throw new Error(
      "Reasoning effort must be low, medium, high, xhigh, max, or ultra / уровень рассуждений должен быть одним из перечисленных значений.",
    );
  }
  return config;
};

export const loadConfig = async (path: string): Promise<LfiConfig> =>
  validateConfig(parseEnvConfig(await readFile(path, "utf8")));

export const saveConfig = async (path: string, config: LfiConfig): Promise<void> =>
  writeFile(path, serializeEnvConfig(validateConfig(config)), { flag: "wx" });

export const updateConfig = async (
  path: string,
  config: LfiConfig,
): Promise<void> =>
  writeFile(path, serializeEnvConfig(validateConfig(config)));
