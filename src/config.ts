import { readFile, writeFile } from "node:fs/promises";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface LfiConfig {
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

const numericKeys = new Set<keyof LfiConfig>([
  "MAX_PARALLEL",
  "MAX_STAGES",
  "LOG_RETENTION_DAYS",
  "IDLE_TIMEOUT_MINUTES",
]);

export const serializeEnvConfig = (config: LfiConfig): string =>
  `${Object.entries(config)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n")}\n`;

export const parseEnvConfig = (source: string): LfiConfig => {
  const result: Record<string, string | number> = { ...DEFAULT_CONFIG };
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator) as keyof LfiConfig;
    if (!(key in DEFAULT_CONFIG)) continue;
    const value = line.slice(separator + 1);
    result[key] = numericKeys.has(key) ? Number(value) : value;
  }
  return result as unknown as LfiConfig;
};

export const loadConfig = async (path: string): Promise<LfiConfig> =>
  parseEnvConfig(await readFile(path, "utf8"));

export const saveConfig = async (path: string, config: LfiConfig): Promise<void> =>
  writeFile(path, serializeEnvConfig(config), { flag: "wx" });
