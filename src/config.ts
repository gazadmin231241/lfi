import { readFile, writeFile } from "node:fs/promises";

import {
  defaultAgentProvider,
  isAgentProvider,
  supportsReasoningEffort,
  type AgentProvider,
} from "./agent-provider.js";
import type { ExecutionTier } from "./execution-tier.js";
import type { IsolationProvider } from "./isolation-provider.js";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export interface AgentModel {
  agent: AgentProvider;
  model: string;
}

export interface LfiConfig {
  DEFAULT_MODEL: string;
  LIGHT_MODEL: string;
  STANDARD_MODEL: string;
  DEEP_MODEL: string;
  REASONING_EFFORT: ReasoningEffort;
  MERGER_MODEL: string;
  MERGER_REASONING_EFFORT: ReasoningEffort;
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
  MAX_PARALLEL: 3,
  MAX_STAGES: 10,
  LOG_RETENTION_DAYS: 3,
  IDLE_TIMEOUT_MINUTES: 15,
  BASE_BRANCH: "main",
  VALIDATE_COMMAND: "",
  WORKTREE_SETUP_COMMAND: "",
  ISOLATION_PROVIDER: "local",
};

export const serializeEnvConfig = (config: LfiConfig): string =>
  `${Object.entries(config)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n")}\n`;

export const parseEnvConfig = (source: string): LfiConfig => {
  const result: LfiConfig = { ...DEFAULT_CONFIG };
  const canonicalKeys = new Set<string>();
  const aliases: Partial<Record<"CODEX_MODEL" | "CODEX_REASONING_EFFORT", string>> = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    const separator = rawLine.indexOf("=");
    if (separator < 0) continue;
    const key = rawLine.slice(0, separator).trim();
    const value = rawLine.slice(separator + 1);
    switch (key) {
      case "DEFAULT_MODEL":
      case "LIGHT_MODEL":
      case "STANDARD_MODEL":
      case "DEEP_MODEL":
      case "MERGER_MODEL":
      case "BASE_BRANCH":
      case "VALIDATE_COMMAND":
      case "WORKTREE_SETUP_COMMAND":
        result[key] = value;
        canonicalKeys.add(key);
        break;
      case "REASONING_EFFORT":
      case "MERGER_REASONING_EFFORT":
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

export const parseAgentModel = (value: string): AgentModel => {
  const separator = value.indexOf(":");
  const agent = separator < 0 ? defaultAgentProvider : value.slice(0, separator);
  if (!isAgentProvider(agent)) {
    throw new Error(
      `Unknown agent in model value ${value} / Неизвестный агент в значении модели ${value}.`,
    );
  }
  return {
    agent,
    model: separator < 0 ? value : value.slice(separator + 1),
  };
};

export const agentModelKey = ({ agent, model }: AgentModel): string =>
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
  return parseAgentModel(modelByTier[tier] || config.DEFAULT_MODEL);
};

export const resolveIntegrationModel = (config: LfiConfig): AgentModel =>
  parseAgentModel(
    config.MERGER_MODEL || config.STANDARD_MODEL || config.DEFAULT_MODEL,
  );

export const configuredAgents = (config: LfiConfig): ReadonlySet<AgentProvider> =>
  new Set([
    resolveWorkerModel(config, "light").agent,
    resolveWorkerModel(config, "standard").agent,
    resolveWorkerModel(config, "deep").agent,
    resolveIntegrationModel(config).agent,
  ]);

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
    !reasoningEfforts.has(config.REASONING_EFFORT) ||
    !reasoningEfforts.has(config.MERGER_REASONING_EFFORT)
  ) {
    throw new Error(
      "Reasoning effort must be low, medium, high, xhigh, max, or ultra / уровень рассуждений должен быть одним из перечисленных значений.",
    );
  }
  const workerAgents = new Set(
    (["light", "standard", "deep"] as const).map(
      (tier) => resolveWorkerModel(config, tier).agent,
    ),
  );
  for (const agent of workerAgents) {
    if (!supportsReasoningEffort(agent, config.REASONING_EFFORT)) {
      throw new Error(
        `Agent ${agent} cannot honour REASONING_EFFORT=${config.REASONING_EFFORT} / Агент ${agent} не поддерживает REASONING_EFFORT=${config.REASONING_EFFORT}.`,
      );
    }
  }
  const mergerAgent = resolveIntegrationModel(config).agent;
  if (!supportsReasoningEffort(mergerAgent, config.MERGER_REASONING_EFFORT)) {
    throw new Error(
      `Agent ${mergerAgent} cannot honour MERGER_REASONING_EFFORT=${config.MERGER_REASONING_EFFORT} / Агент ${mergerAgent} не поддерживает MERGER_REASONING_EFFORT=${config.MERGER_REASONING_EFFORT}.`,
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

export const saveConfig = async (path: string, config: LfiConfig): Promise<void> =>
  writeFile(path, serializeEnvConfig(validateConfig(config)), { flag: "wx" });

export const updateConfig = async (
  path: string,
  config: LfiConfig,
): Promise<void> =>
  writeFile(path, serializeEnvConfig(validateConfig(config)));
