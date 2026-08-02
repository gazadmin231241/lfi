import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  resolveIsolationConfiguration,
  sanitizeAgentEnvironment,
  wrapWithIsolation,
  type IsolationProvider,
} from "./isolation-provider.js";
import {
  formatRunLogSection,
  redactSensitiveText,
  type RunLogContext,
} from "./logs.js";
import { runCommand, runCommandLines } from "./process.js";

export type AgentProvider = "codex";
export const defaultAgentProvider: AgentProvider = "codex";

const agentProviders: ReadonlySet<string> = new Set([defaultAgentProvider]);

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
    }
  });

export const supportsReasoningEffort = (
  agent: AgentProvider,
  reasoning: ReasoningEffort,
): boolean => {
  switch (agent) {
    case "codex":
      return true;
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

const eventSummary = (
  line: string,
):
  | { text: string; showInTerminal: boolean; agentMessage: boolean }
  | undefined => {
  try {
    const event = JSON.parse(line) as {
      type?: string;
      item?: { type?: string; text?: string; command?: string; status?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      return {
        text: event.item.text ?? "",
        showInTerminal: true,
        agentMessage: true,
      };
    }
    if (event.type === "item.started" && event.item?.type === "command_execution") {
      return {
        text: `$ ${event.item.command ?? "command"}`,
        showInTerminal: false,
        agentMessage: false,
      };
    }
    if (event.type === "turn.completed") {
      return {
        text: `turn.completed input=${event.usage?.input_tokens ?? "?"} output=${event.usage?.output_tokens ?? "?"}`,
        showInTerminal: false,
        agentMessage: false,
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
  const artifacts = await mkdtemp(join(options.gitDirectory, "lfi-agent-"));
  const sanitizedGitConfig = join(artifacts, "safe-git-config");
  await appendFile(
    compactPath,
    formatRunLogSection(
      options.log.startedAt,
      options.log.iteration,
      "",
    ),
  );
  const agentMessages: string[] = [];
  let logWrites = Promise.resolve();
  const appendDetail = (content: string): void => {
    const redacted = redactSensitiveText(content);
    logWrites = logWrites.then(() => appendFile(compactPath, redacted));
  };
  const recordEvent = (line: string): void => {
    const summary = eventSummary(line);
    if (!summary) return;
    if (summary.agentMessage) agentMessages.push(summary.text);
    const text = redactSensitiveText(summary.text);
    if (summary.showInTerminal) {
      const message = `[${options.prefix}] ${text}`;
      if (options.log.output) options.log.output.log(message);
      else console.log(message);
    }
    appendDetail(`${text}\n`);
  };
  try {
    await writeFile(sanitizedGitConfig, "");
    const agentInvocation = buildAgentInvocation({
      ...options,
    });
    const isolation = await resolveIsolationConfiguration({
      provider: options.isolationProvider,
      worktree: options.cwd,
      gitDirectory: options.gitDirectory,
      homeDirectory: homedir(),
      sanitizedGitConfig,
    });
    const identity =
      options.isolationProvider === "none"
        ? {}
        : await Promise.all([
            runCommand("git", ["config", "--get", "user.name"], {
              cwd: options.cwd,
            }),
            runCommand("git", ["config", "--get", "user.email"], {
              cwd: options.cwd,
            }),
          ]).then(([name, email]) => ({
            ...(name.exitCode === 0 ? { name: name.stdout.trim() } : {}),
            ...(email.exitCode === 0 ? { email: email.stdout.trim() } : {}),
          }));
    const invocation = wrapWithIsolation(
      {
        ...agentInvocation,
        idleTimeoutMs: options.idleTimeoutMinutes * 60_000,
        onStdoutLine: recordEvent,
        onStderrLine: (line) => appendDetail(`${line}\n`),
        environment:
          options.isolationProvider === "none"
            ? process.env
            : sanitizeAgentEnvironment(process.env, identity),
      },
      isolation,
    );
    const result = await runCommandLines(invocation.command, invocation.args, {
      cwd: options.cwd,
      input: invocation.input,
      idleTimeoutMs: invocation.idleTimeoutMs,
      onStdoutLine: invocation.onStdoutLine,
      onStderrLine: invocation.onStderrLine,
      env: invocation.environment,
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
    const detail =
      !parsed.ok && result.stderr
        ? `${parsedSummary}\n${result.stderr}`
        : parsedSummary || result.stderr;
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
    await logWrites;
    await rm(artifacts, { recursive: true, force: true });
  }
};
