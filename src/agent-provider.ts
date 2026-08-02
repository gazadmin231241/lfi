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

export type AgentProvider = "codex" | "pi";
export const defaultAgentProvider: AgentProvider = "codex";

const agentProviders: ReadonlySet<string> = new Set([defaultAgentProvider, "pi"]);

export const isAgentProvider = (value: string): value is AgentProvider =>
  agentProviders.has(value);

export const skillPlaceholder = (skill: string): string => `{{SKILL:${skill}}}`;

export const expandSkillPlaceholders = (
  agent: AgentProvider,
  prompt: string,
): string =>
  prompt.replaceAll(/\{\{SKILL:([A-Za-z0-9][A-Za-z0-9-]*)\}\}/gu, (_placeholder, skill: string) => {
    switch (agent) {
      case "codex":
        return `$${skill}`;
      case "pi":
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
      case "pi":
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
  pi:
    /(?:no model found matching|model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access))/iu,
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
    "-c",
    `model_reasoning_effort="${options.reasoning}"`,
    "-c",
    "sandbox_workspace_write.network_access=true",
    "-C",
    options.cwd,
  ];
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

const piMessageText = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      return [part.text];
    }
    return [];
  }).join("\n");
};

const eventSummary = (
  agent: AgentProvider,
  line: string,
):
  | {
      text: string;
      showInTerminal: boolean;
      agentMessage: boolean;
      error: boolean;
    }
  | undefined => {
  try {
    const event = jsonRecord(JSON.parse(line));
    if (!event) return undefined;
    const type = stringField(event, "type");
    if (agent === "pi") {
      if (type === "tool_execution_start") {
        const args = jsonRecord(event.args);
        const command = args ? stringField(args, "command") : undefined;
        return {
          text: `$ ${command ?? stringField(event, "toolName") ?? "tool"}`,
          showInTerminal: false,
          agentMessage: false,
          error: false,
        };
      }
      const message = jsonRecord(event.message);
      if (type === "message_end" && message && stringField(message, "role") === "assistant") {
        const errorMessage = stringField(message, "errorMessage");
        const text = [
          piMessageText(message.content),
          errorMessage ?? "",
        ].filter(Boolean).join("\n");
        if (!text) return undefined;
        return {
          text,
          showInTerminal: !errorMessage,
          agentMessage: true,
          error: Boolean(errorMessage),
        };
      }
      return undefined;
    }
    const item = jsonRecord(event.item);
    if (type === "item.completed" && item && stringField(item, "type") === "agent_message") {
      return {
        text: stringField(item, "text") ?? "",
        showInTerminal: true,
        agentMessage: true,
        error: false,
      };
    }
    if (type === "item.started" && item && stringField(item, "type") === "command_execution") {
      return {
        text: `$ ${stringField(item, "command") ?? "command"}`,
        showInTerminal: false,
        agentMessage: false,
        error: false,
      };
    }
    if (type === "turn.completed") {
      const usage = jsonRecord(event.usage);
      return {
        text: `turn.completed input=${usage ? numberField(usage, "input_tokens") ?? "?" : "?"} output=${usage ? numberField(usage, "output_tokens") ?? "?" : "?"}`,
        showInTerminal: false,
        agentMessage: false,
        error: false,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
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
  const recordEvent = (line: string): void => {
    const summary = eventSummary(options.agent, line);
    if (!summary) return;
    if (summary.agentMessage) agentMessages.push(summary.text);
    if (summary.error) agentErrors.push(summary.text);
    const text = redactSensitiveText(summary.text);
    if (summary.showInTerminal) {
      const message = `[${options.prefix}] ${text}`;
      if (options.log.output) options.log.output.log(message);
      else console.log(message);
    }
    appendDetail(`${text}\n`);
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
      worktree: options.cwd,
      gitDirectory: options.gitDirectory,
      homeDirectory: homedir(),
      environment: process.env,
      identity,
    });
    if (!options.session) ownedSession = session;
    const result = await session.run({
        ...agentInvocation,
        idleTimeoutMs: options.idleTimeoutMinutes * 60_000,
        onStdoutLine: recordEvent,
        onStderrLine: (line) => appendDetail(`${line}\n`),
        environment: process.env,
      });
    const parsed = extractCompletionResult(agentMessages.join("\n"));
    const status = parsed.ok ? parsed.status : undefined;
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
      `\nexit=${result.exitCode}\nstatus=${status ?? "missing"}\n${summary}\n`,
    );
    return {
      exitCode: result.exitCode,
      status,
      summary,
      unavailableModel: isUnavailableModelError(
        options.agent,
        `${agentMessages.join("\n")}\n${result.stderr}`,
      ),
    };
  } finally {
    try {
      await logWrites;
    } finally {
      await ownedSession?.close();
    }
  }
};
