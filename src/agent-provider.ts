import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  completionBlockClose,
  completionBlockOpen,
  extractCompletionResult,
} from "./completion-result.js";
import type { ReasoningEffort } from "./config.js";
import { localize, type Language } from "./i18n.js";
import {
  openIsolationSession,
  resolveGitIdentity,
  type IsolationProvider,
  type IsolationSession,
} from "./isolation-provider.js";
import {
  formatRunLogSection,
  redactSensitiveText,
  type RunLogContext,
} from "./logs.js";

export type AgentProvider = "codex" | "claude" | "pi" | "dsh";
export const defaultAgentProvider: AgentProvider = "codex";

// How long an agent may stay quiet after its completion block before LFI ends
// the process itself. Long enough for trailing events, short enough that a
// stuck agent costs seconds instead of the whole idle timeout.
const completionGraceMs = 20_000;

const agentProviders: ReadonlySet<string> = new Set([
  defaultAgentProvider,
  "claude",
  "pi",
  "dsh",
]);

export const isAgentProvider = (value: string): value is AgentProvider =>
  agentProviders.has(value);

export interface AgentProfile {
  paths: readonly string[];
  stateDirectory: string;
  skillsDirectory: string;
}

// Codex honours CODEX_HOME (desktop integrations such as Orca relocate it),
// so the profile must follow it or the sandbox isolates the wrong directory.
const stateDirectoryByAgent: Record<
  AgentProvider,
  (homeDirectory: string, environment: NodeJS.ProcessEnv) => string
> = {
  codex: (homeDirectory, environment) =>
    environment.CODEX_HOME?.trim() || join(homeDirectory, ".codex"),
  claude: (homeDirectory) => join(homeDirectory, ".claude"),
  pi: (homeDirectory) => join(homeDirectory, ".pi", "agent"),
  dsh: (homeDirectory) => join(homeDirectory, ".dsh"),
};

const profilePathsByAgent: Record<AgentProvider, (stateDirectory: string) => readonly string[]> = {
  codex: (stateDirectory) => [
    join(stateDirectory, "config.toml"),
    join(stateDirectory, "hooks"),
    join(stateDirectory, "agents"),
    join(stateDirectory, "AGENTS.md"),
    join(stateDirectory, "auth.json"),
  ],
  claude: (stateDirectory) => [
    join(stateDirectory, "config.json"),
    join(stateDirectory, "agents"),
    join(stateDirectory, "AGENTS.md"),
    join(stateDirectory, "auth.json"),
  ],
  pi: (stateDirectory) => [
    join(stateDirectory, "settings.json"),
    join(stateDirectory, "extensions"),
    join(stateDirectory, "agents"),
    join(stateDirectory, "subagents.json"),
    join(stateDirectory, "AGENTS.md"),
    join(stateDirectory, "auth.json"),
  ],
  dsh: (stateDirectory) => [
    join(stateDirectory, "config.json"),
    join(stateDirectory, "auth.json"),
  ],
};

const sharedSkillsDirectory = (homeDirectory: string): string =>
  join(homeDirectory, ".agents", "skills");

export const resolveAgentProfile = (
  agent: AgentProvider,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): AgentProfile => {
  const stateDirectory = stateDirectoryByAgent[agent](homeDirectory, environment);
  return {
    paths: profilePathsByAgent[agent](stateDirectory),
    stateDirectory,
    skillsDirectory: sharedSkillsDirectory(homeDirectory),
  };
};

export const skillPlaceholder = (skill: string): string => `{{SKILL:${skill}}}`;

export const expandSkillPlaceholders = (
  agent: AgentProvider,
  prompt: string,
): string =>
  prompt.replaceAll(/\{\{SKILL:([A-Za-z0-9][A-Za-z0-9-]*)\}\}/gu, (_placeholder, skill: string) => {
    switch (agent) {
      case "codex":
        return `$${skill}`;
      case "claude":
      case "pi":
      case "dsh":
        return `/skill:${skill}`;
    }
  });

export const supportsReasoningEffort = (
  agent: AgentProvider,
  reasoning: ReasoningEffort,
): boolean => {
  switch (agent) {
    case "codex":
      return true;
    case "claude":
    case "pi":
    case "dsh":
      return reasoning !== "ultra";
  }
};

export interface AgentRunResult {
  exitCode: number;
  status: "completed" | "incomplete" | undefined;
  summary: string;
  unavailableModel: boolean;
}

const unavailableModelErrorByAgent: Record<AgentProvider, RegExp> = {
  codex:
    /model_not_found|unsupported model|model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access)/iu,
  claude:
    /model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access)/iu,
  pi:
    /(?:no model found matching|model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access))/iu,
  dsh:
    /model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access)/iu,
};

export const isUnavailableModelError = (
  agent: AgentProvider,
  message: string,
): boolean => unavailableModelErrorByAgent[agent].test(message);

export interface AgentInvocationOptions {
  agent: AgentProvider;
  cwd: string;
  prompt: string;
  model: string;
  reasoning: ReasoningEffort;
  gitDirectory: string;
  writableDirectories?: readonly string[];
}

export interface AgentInvocation {
  command: string;
  args: string[];
  input: string;
}

export const buildAgentInvocation = (
  options: AgentInvocationOptions,
): AgentInvocation => {
  if (options.agent === "pi") {
    return {
      command: "pi",
      args: [
        "--mode",
        "json",
        "--no-session",
        "--model",
        options.model,
        "--thinking",
        options.reasoning,
      ],
      input: options.prompt,
    };
  }
  const args = [
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--add-dir",
    options.gitDirectory,
  ];
  for (const directory of options.writableDirectories ?? []) {
    args.push("--add-dir", directory);
  }
  args.push(
    "-c",
    `model_reasoning_effort="${options.reasoning}"`,
    "-c",
    "sandbox_workspace_write.network_access=true",
    "-C",
    options.cwd,
  );
  if (options.model) args.push("--model", options.model);
  args.push("-");
  return { command: options.agent, args, input: options.prompt };
};

const jsonRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;

const stringField = (record: Record<string, unknown>, field: string): string | undefined => {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
};

const numberField = (record: Record<string, unknown>, field: string): number | undefined => {
  const value = record[field];
  return typeof value === "number" ? value : undefined;
};

interface AgentEventSummary {
  text: string;
  showInTerminal: boolean;
  agentMessage: boolean;
  error: boolean;
}

const progressLine = (text: string, showInTerminal = true): AgentEventSummary => ({
  text,
  showInTerminal,
  agentMessage: false,
  error: false,
});

// Reasoning arrives as free-form prose; the terminal only carries its headline
// so a long chain of thought cannot bury the agent messages around it.
const reasoningHeadline = (reasoning: string): string => {
  const headline = reasoning
    .split("\n")
    .map((line) => line.replaceAll("*", "").replaceAll("#", "").trim())
    .find(Boolean) ?? "";
  return headline.length > 160 ? `${headline.slice(0, 159)}…` : headline;
};

const piContentParts = (
  content: unknown,
  type: string,
  field: string,
): readonly string[] => {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    const record = jsonRecord(part);
    if (!record || record.type !== type) return [];
    const value = stringField(record, field);
    return value ? [value] : [];
  });
};

const piEventSummaries = (
  event: Record<string, unknown>,
  type: string | undefined,
): readonly AgentEventSummary[] => {
  if (type === "tool_execution_start") {
    const args = jsonRecord(event.args);
    const command = args ? stringField(args, "command") : undefined;
    // File tools fire dozens of times per step and say nothing a reader can
    // act on, so only shell commands reach the terminal; the log keeps all.
    return [progressLine(
      `$ ${command ?? stringField(event, "toolName") ?? "tool"}`,
      Boolean(command),
    )];
  }
  const message = jsonRecord(event.message);
  if (type !== "message_end" || !message) return [];
  if (stringField(message, "role") !== "assistant") return [];
  const summaries = piContentParts(message.content, "thinking", "thinking")
    .map(reasoningHeadline)
    .filter(Boolean)
    .map((headline) => progressLine(headline));
  const errorMessage = stringField(message, "errorMessage");
  const text = [
    piContentParts(message.content, "text", "text").join("\n"),
    errorMessage ?? "",
  ].filter(Boolean).join("\n");
  if (!text) return summaries;
  return [
    ...summaries,
    {
      text,
      showInTerminal: !errorMessage,
      agentMessage: true,
      error: Boolean(errorMessage),
    },
  ];
};

const codexEventSummaries = (
  event: Record<string, unknown>,
  type: string | undefined,
): readonly AgentEventSummary[] => {
  const item = jsonRecord(event.item);
  if (type === "item.completed" && item && stringField(item, "type") === "agent_message") {
    return [{
      text: stringField(item, "text") ?? "",
      showInTerminal: true,
      agentMessage: true,
      error: false,
    }];
  }
  if (type === "item.completed" && item && stringField(item, "type") === "reasoning") {
    const headline = reasoningHeadline(stringField(item, "text") ?? "");
    return headline ? [progressLine(headline)] : [];
  }
  if (type === "item.started" && item && stringField(item, "type") === "command_execution") {
    return [progressLine(`$ ${stringField(item, "command") ?? "command"}`)];
  }
  if (type === "turn.completed") {
    const usage = jsonRecord(event.usage);
    return [progressLine(
      `turn.completed input=${usage ? numberField(usage, "input_tokens") ?? "?" : "?"} output=${usage ? numberField(usage, "output_tokens") ?? "?" : "?"}`,
      false,
    )];
  }
  return [];
};

const eventSummaries = (
  agent: AgentProvider,
  line: string,
): readonly AgentEventSummary[] => {
  try {
    const event = jsonRecord(JSON.parse(line));
    if (!event) return [];
    const type = stringField(event, "type");
    return agent === "pi"
      ? piEventSummaries(event, type)
      : codexEventSummaries(event, type);
  } catch {
    return [];
  }
};

export const runAgent = async (options: {
  agent: AgentProvider;
  cwd: string;
  prompt: string;
  model: string;
  reasoning: ReasoningEffort;
  gitDirectory: string;
  log: RunLogContext;
  logName: string;
  idleTimeoutMinutes: number;
  isolationProvider: IsolationProvider;
  prefix: string;
  language: Language;
  session?: IsolationSession;
  writableDirectories?: readonly string[];
  completionGraceMs?: number;
}): Promise<AgentRunResult> => {
  if (
    !options.prompt.includes(completionBlockOpen) ||
    !options.prompt.includes(completionBlockClose)
  ) {
    throw new Error(localize(
      options.language,
      `The prompt must instruct the agent to emit an LFI completion block using ${completionBlockOpen} and ${completionBlockClose}.`,
      `Prompt должен требовать от агента блок завершения LFI с тегами ${completionBlockOpen} и ${completionBlockClose}.`,
    ));
  }
  await mkdir(options.log.directory, { recursive: true });
  const compactPath = join(options.log.directory, `${options.logName}.log`);
  await appendFile(
    compactPath,
    formatRunLogSection(
      options.log.startedAt,
      options.log.iteration,
      "",
    ),
  );
  const agentMessages: string[] = [];
  const agentErrors: string[] = [];
  let logWrites = Promise.resolve();
  const appendDetail = (content: string): void => {
    const redacted = redactSensitiveText(content);
    logWrites = logWrites.then(() => appendFile(compactPath, redacted));
  };
  // Some agents keep their process alive after their final answer, which would
  // otherwise cost the run an idle timeout and discard the finished work. Once
  // the completion block has arrived, a quiet grace period ends the process.
  const completionGrace = new AbortController();
  let completionTimer: NodeJS.Timeout | undefined;
  let closedAfterCompletion = false;
  const armCompletionGrace = (): void => {
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = setTimeout(() => {
      closedAfterCompletion = true;
      completionGrace.abort();
    }, options.completionGraceMs ?? completionGraceMs);
    completionTimer.unref();
  };
  const recordEvent = (line: string): void => {
    for (const summary of eventSummaries(options.agent, line)) {
      if (summary.agentMessage) agentMessages.push(summary.text);
      if (summary.error) agentErrors.push(summary.text);
      const text = redactSensitiveText(summary.text);
      if (summary.showInTerminal) {
        options.log.onAgentOutput?.();
        const message = `[${options.prefix}] ${text}`;
        if (options.log.output) options.log.output.log(message);
        else console.log(message);
      }
      appendDetail(`${text}\n`);
      if (summary.agentMessage && extractCompletionResult(summary.text).ok) {
        armCompletionGrace();
      }
    }
  };
  let ownedSession: IsolationSession | undefined;
  try {
    const agentInvocation = buildAgentInvocation({
      ...options,
    });
    const identity =
      options.session || options.isolationProvider === "none"
        ? {}
        : await resolveGitIdentity(options.cwd);
    const session = options.session ?? await openIsolationSession({
      provider: options.isolationProvider,
      agent: options.agent,
      worktree: options.cwd,
      gitDirectory: options.gitDirectory,
      homeDirectory: homedir(),
      environment: process.env,
      identity,
    });
    if (!options.session) ownedSession = session;
    const result = await session.run({
        ...agentInvocation,
        ...(options.writableDirectories
          ? { writableDirectories: options.writableDirectories }
          : {}),
        idleTimeoutMs: options.idleTimeoutMinutes * 60_000,
        // The event stream is consumed line by line; a run's worth of streamed
        // JSON deltas must not also be held in memory.
        captureStdout: false,
        signal: completionGrace.signal,
        onStdoutLine: recordEvent,
        onStderrLine: (line) => appendDetail(`${line}\n`),
        environment: process.env,
      });
    const parsed = extractCompletionResult(agentMessages.join("\n"));
    const status = parsed.ok ? parsed.status : undefined;
    // Ending a lingering agent is a normal finish, not a failed run.
    const exitCode = closedAfterCompletion && parsed.ok ? 0 : result.exitCode;
    const parsedSummary = parsed.ok
      ? parsed.summary
      : localize(
          options.language,
          parsed.summary,
          parsed.failure === "missing_block"
            ? "В выводе агента отсутствует блок завершения LFI."
            : parsed.failure === "malformed_json"
              ? "Последний блок завершения LFI не содержит допустимый JSON."
              : 'Последний блок завершения LFI должен содержать только строковые поля "status" ("completed" или "incomplete") и "summary".',
        );
    const detail = parsed.ok
      ? [parsedSummary, agentErrors.join("\n"), result.stderr]
        .filter(Boolean)
        .join("\n")
      : [parsedSummary, agentMessages.join("\n"), result.stderr]
        .filter(Boolean)
        .join("\n");
    const summary = redactSensitiveText(detail);
    appendDetail(
      `\nexit=${exitCode}${closedAfterCompletion ? " (closed after completion)" : ""}\nstatus=${status ?? "missing"}\n${summary}\n`,
    );
    return {
      exitCode,
      status,
      summary,
      unavailableModel: isUnavailableModelError(
        options.agent,
        `${agentMessages.join("\n")}\n${result.stderr}`,
      ),
    };
  } finally {
    if (completionTimer) clearTimeout(completionTimer);
    try {
      await logWrites;
    } finally {
      await ownedSession?.close();
    }
  }
};
