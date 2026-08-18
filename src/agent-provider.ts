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

export type AgentProvider = "codex" | "pi" | "claude" | "dsh";
export const defaultAgentProvider: AgentProvider = "codex";

/**
 * The DeepSeek Harness profile LFI boots. It is created by `lfi init`, carries
 * the shipped headless bundle plus LFI's own event-stream bundle, and is never
 * one of the harness's own auto-initialized profiles.
 */
export const dshProfileName = "lfi";

// How long an agent may stay quiet after its completion block before LFI ends
// the process itself. Long enough for trailing events, short enough that a
// stuck agent costs seconds instead of the whole idle timeout.
const completionGraceMs = 20_000;

const agentProviders: ReadonlySet<string> = new Set([
  defaultAgentProvider,
  "pi",
  "claude",
  "dsh",
]);

export const isAgentProvider = (value: string): value is AgentProvider =>
  agentProviders.has(value);

export interface AgentProfile {
  paths: readonly string[];
  stateDirectory: string;
  /** Paths the sandbox must keep writable, such as the agent's own state. */
  writablePaths: readonly string[];
  skillsDirectory: string;
}

// Codex honours CODEX_HOME and Claude Code honours CLAUDE_CONFIG_DIR (desktop
// integrations such as Orca relocate them), so the profile must follow them or
// the sandbox isolates the wrong directory.
const stateDirectoryByAgent: Record<
  AgentProvider,
  (homeDirectory: string, environment: NodeJS.ProcessEnv) => string
> = {
  codex: (homeDirectory, environment) =>
    environment.CODEX_HOME?.trim() || join(homeDirectory, ".codex"),
  pi: (homeDirectory) => join(homeDirectory, ".pi", "agent"),
  claude: (homeDirectory, environment) =>
    environment.CLAUDE_CONFIG_DIR?.trim() || join(homeDirectory, ".claude"),
  dsh: (homeDirectory, environment) =>
    environment.DSH_HOME?.trim() || join(homeDirectory, ".dsh"),
};

const profilePathsByAgent: Record<AgentProvider, (stateDirectory: string) => readonly string[]> = {
  codex: (stateDirectory) => [
    join(stateDirectory, "config.toml"),
    join(stateDirectory, "hooks"),
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
  claude: (stateDirectory) => [
    join(stateDirectory, "settings.json"),
    join(stateDirectory, ".credentials.json"),
    join(stateDirectory, "agents"),
    join(stateDirectory, "skills"),
    join(stateDirectory, "plugins"),
    join(stateDirectory, "CLAUDE.md"),
  ],
  dsh: (stateDirectory) => [
    join(stateDirectory, "profiles"),
    join(stateDirectory, "settings.yaml"),
    join(stateDirectory, "cordis.patch.yml"),
    join(stateDirectory, ".credentials.yaml"),
    join(stateDirectory, ".env"),
  ],
};

// Claude Code keeps its account and project state in ~/.claude.json, one level
// above its state directory, so the sandbox has to keep that file writable too
// or the agent starts unauthenticated.
const writablePathsByAgent: Record<
  AgentProvider,
  (stateDirectory: string, homeDirectory: string) => readonly string[]
> = {
  codex: (stateDirectory) => [stateDirectory],
  pi: (stateDirectory) => [stateDirectory],
  claude: (stateDirectory, homeDirectory) => [
    stateDirectory,
    join(homeDirectory, ".claude.json"),
  ],
  // The harness heals its profile symlink farm and appends its session log on
  // every launch, so its whole home stays writable.
  dsh: (stateDirectory) => [stateDirectory],
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
    writablePaths: writablePathsByAgent[agent](stateDirectory, homeDirectory),
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
      case "pi":
        return `/skill:${skill}`;
      case "claude":
        return `/${skill}`;
      // The harness publishes its skills as a `skill` tool taking a name, with
      // no user-facing sigil a headless prompt could carry.
      case "dsh":
        return `the "${skill}" skill`;
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
      // Claude Code's --effort stops at max; it has no ultra level.
      case "claude":
        return reasoning !== "ultra";
      case "dsh":
        return reasoning !== "ultra";
  }
};

/**
 * LFI's six reasoning levels onto the DeepSeek adapter's four. Its `off`
 * disables thinking entirely and no LFI level asks for that, so the mapping
 * stays inside `low | high | max` and keeps the scale monotonic; `ultra` has no
 * equivalent and is rejected before a run starts.
 */
const dshReasoningByEffort: Record<Exclude<ReasoningEffort, "ultra">, string> = {
  low: "low",
  medium: "low",
  high: "high",
  xhigh: "max",
  max: "max",
};

export const dshReasoningEffort = (reasoning: ReasoningEffort): string =>
  reasoning === "ultra" ? "max" : dshReasoningByEffort[reasoning];

/** The harness route LFI selects when a model names none of its own. */
export const defaultDshProvider = "deepseek-official";

export interface DshModelSelection {
  provider: string;
  model?: string;
}

/**
 * Split a configured dsh model into the harness provider route and the model id
 * the route serves. The harness selects a model as a `{provider, model}` pair,
 * and its own model ids carry no slash, so a leading `route/` segment is the
 * unambiguous way to address a route other than the native DeepSeek API — for
 * example `opencode-go/deepseek-v4-pro`, which bills through an OpenCode Zen
 * subscription instead of a DeepSeek key. Everything after the first slash is
 * the model id, passed through verbatim.
 */
export const dshModelSelection = (model?: string): DshModelSelection => {
  const trimmed = model?.trim();
  if (!trimmed) return { provider: defaultDshProvider };
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return { provider: defaultDshProvider, model: trimmed };
  }
  return {
    provider: trimmed.slice(0, separator),
    model: trimmed.slice(separator + 1),
  };
};

export interface AgentRunResult {
  exitCode: number;
  status: "completed" | "incomplete" | undefined;
  summary: string;
  unavailableModel: boolean;
  unsupportedReasoning: boolean;
}

const unavailableModelErrorByAgent: Record<AgentProvider, RegExp> = {
  codex:
    /model_not_found|unsupported model|model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access)/iu,
  pi:
    /(?:no model found matching|model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access))/iu,
  claude:
    /(?:invalid model name|unknown model|model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access))/iu,
  // The harness passes an unlisted model id straight through, so an unavailable
  // one only surfaces as the provider's own rejected request.
  dsh:
    /(?:model not exist|invalid model|model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access))/iu,
};

export const isUnavailableModelError = (
  agent: AgentProvider,
  message: string,
): boolean => unavailableModelErrorByAgent[agent].test(message);

/**
 * A reasoning level the selected route and model do not offer. Only the harness
 * can report this: codex, pi and claude take the level as a command-line flag
 * their own argument parsing accepts or rejects, so one they cannot serve never
 * reaches a provider. dsh instead selects a `{provider, model}` pair whose
 * offered efforts are a catalog fact of that route, and refuses before any
 * network request. LFI surfaces that refusal as the configuration error it is
 * rather than asking for some neighbouring level the model does offer.
 */
const unsupportedReasoningError =
  /UNSUPPORTED_REASONING_EFFORT|does not support reasoning effort/iu;

export const isUnsupportedReasoningError = (
  agent: AgentProvider,
  message: string,
): boolean => agent === "dsh" && unsupportedReasoningError.test(message);

export interface AgentInvocationOptions {
  agent: AgentProvider;
  cwd: string;
  prompt: string;
  model: string;
  reasoning: ReasoningEffort;
  gitDirectory: string;
  writableDirectories?: readonly string[];
  /** Tool names withheld from the agent, such as tools registered by extensions. */
  excludedTools?: readonly string[];
}

export interface AgentInvocation {
  command: string;
  args: string[];
  input: string;
  /** Variables this invocation adds to the sanitized agent environment. */
  environment?: Readonly<Record<string, string>>;
}

export const buildAgentInvocation = (
  options: AgentInvocationOptions,
): AgentInvocation => {
  if (options.agent === "pi") {
    const args = [
      "--mode",
      "json",
      "--no-session",
      "--model",
      options.model,
      "--thinking",
      options.reasoning,
    ];
    // Codex has no equivalent flag, so a denylist only reaches pi.
    if (options.excludedTools?.length) {
      args.push("--exclude-tools", options.excludedTools.join(","));
    }
    return { command: "pi", args, input: options.prompt };
  }
  if (options.agent === "claude") {
    // Claude Code has no working-directory flag; the process cwd decides the
    // workspace, and every other directory has to be declared with --add-dir.
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      // stream-json refuses to emit anything without it.
      "--verbose",
      "--no-session-persistence",
      "--dangerously-skip-permissions",
      "--add-dir",
      options.gitDirectory,
    ];
    for (const directory of options.writableDirectories ?? []) {
      args.push("--add-dir", directory);
    }
    args.push("--effort", options.reasoning);
    if (options.excludedTools?.length) {
      args.push("--disallowed-tools", options.excludedTools.join(","));
    }
    if (options.model) args.push("--model", options.model);
    return { command: "claude", args, input: options.prompt };
  }
  if (options.agent === "dsh") {
    // The harness has no flags for model, effort, or a tool denylist: every one
    // of them is a row in the composed plugin tree. LFI's bundle patch reads
    // them from the environment so the layer itself can stay static, and the
    // prompt is the profile app's positional argument rather than stdin.
    const selection = dshModelSelection(options.model);
    return {
      command: "dsh",
      args: ["--profile", dshProfileName, options.prompt],
      input: "",
      environment: {
        LFI_DSH_REASONING: dshReasoningEffort(options.reasoning),
        LFI_DSH_PROVIDER: selection.provider,
        ...(selection.model ? { LFI_DSH_MODEL: selection.model } : {}),
        ...(options.excludedTools?.length
          ? { LFI_DSH_DENIED_TOOLS: options.excludedTools.join(",") }
          : {}),
        // The harness confines writes to one workspace root and has no
        // equivalent of --add-dir, so LFI's own sandbox is the boundary and the
        // agent is left unconfined inside it.
        DSH_PERMISSION_MODE: "danger-full-access",
      },
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

const claudeEventSummaries = (
  event: Record<string, unknown>,
  type: string | undefined,
): readonly AgentEventSummary[] => {
  if (type === "assistant") {
    const message = jsonRecord(event.message);
    if (!message || !Array.isArray(message.content)) return [];
    return message.content.flatMap((part): readonly AgentEventSummary[] => {
      const record = jsonRecord(part);
      if (!record) return [];
      if (record.type === "thinking") {
        const headline = reasoningHeadline(stringField(record, "thinking") ?? "");
        return headline ? [progressLine(headline)] : [];
      }
      if (record.type === "tool_use") {
        const input = jsonRecord(record.input);
        const command = input ? stringField(input, "command") : undefined;
        // File tools fire dozens of times per step and say nothing a reader can
        // act on, so only shell commands reach the terminal; the log keeps all.
        return [progressLine(
          `$ ${command ?? stringField(record, "name") ?? "tool"}`,
          Boolean(command),
        )];
      }
      if (record.type === "text") {
        const text = stringField(record, "text") ?? "";
        return text
          ? [{ text, showInTerminal: true, agentMessage: true, error: false }]
          : [];
      }
      return [];
    });
  }
  if (type !== "result") return [];
  const usage = jsonRecord(event.usage);
  const summaries: AgentEventSummary[] = [progressLine(
    `result input=${usage ? numberField(usage, "input_tokens") ?? "?" : "?"} output=${usage ? numberField(usage, "output_tokens") ?? "?" : "?"}`,
    false,
  )];
  // A failed turn carries its reason here rather than in an assistant message,
  // so the summary would otherwise lose the only explanation of the failure.
  const failure = event.is_error === true ? stringField(event, "result") : undefined;
  if (failure) {
    summaries.push({
      text: failure,
      showInTerminal: false,
      // Counted as an agent message so the reason survives into the summary
      // even when the run ends without a completion block.
      agentMessage: true,
      error: true,
    });
  }
  return summaries;
};

// The harness streams its durable session log through LFI's own dsh-lfi-stream
// bundle, so the shapes here are the session event types rather than a CLI's
// output format. The runner's trailing plain-text line is not JSON and is
// dropped by the parser above.
const dshEventSummaries = (
  event: Record<string, unknown>,
  type: string | undefined,
): readonly AgentEventSummary[] => {
  const data = jsonRecord(event.data);
  if (!data) return [];
  if (type === "assistant/message") {
    const message = jsonRecord(data.message);
    const usage = jsonRecord(data.usage);
    const summaries: AgentEventSummary[] = Array.isArray(message?.content)
      ? message.content.flatMap((part): readonly AgentEventSummary[] => {
          const record = jsonRecord(part);
          if (!record) return [];
          if (record.type === "reasoning") {
            const headline = reasoningHeadline(stringField(record, "text") ?? "");
            return headline ? [progressLine(headline)] : [];
          }
          if (record.type === "text") {
            const text = stringField(record, "text") ?? "";
            return text
              ? [{ text, showInTerminal: true, agentMessage: true, error: false }]
              : [];
          }
          return [];
        })
      : [];
    if (usage) {
      summaries.push(progressLine(
        `usage input=${numberField(usage, "inputTokens") ?? "?"} output=${numberField(usage, "outputTokens") ?? "?"}`,
        false,
      ));
    }
    return summaries;
  }
  if (type === "tool/call") {
    const name = stringField(data, "name") ?? "tool";
    const parsed = ((): Record<string, unknown> | undefined => {
      try {
        return jsonRecord(JSON.parse(stringField(data, "arguments") ?? ""));
      } catch {
        return undefined;
      }
    })();
    const command = parsed ? stringField(parsed, "command") : undefined;
    // File tools fire dozens of times per step and say nothing a reader can
    // act on, so only shell commands reach the terminal; the log keeps all.
    return [progressLine(`$ ${command ?? name}`, Boolean(command))];
  }
  if (type !== "turn/end") return [];
  const reason = jsonRecord(data.reason);
  const kind = reason ? stringField(reason, "kind") : undefined;
  if (kind === undefined || kind === "completed") return [];
  const error = reason ? jsonRecord(reason.error) : undefined;
  const detail = error
    ? `${stringField(error, "code") ?? "UNKNOWN"}: ${stringField(error, "message") ?? ""}`
    : "";
  return [{
    text: [`turn ended: ${kind}`, detail].filter(Boolean).join(" "),
    showInTerminal: false,
    // Counted as an agent message so the reason survives into the summary even
    // when the run ends without a completion block.
    agentMessage: true,
    error: true,
  }];
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

const eventSummariesByAgent: Record<
  AgentProvider,
  (event: Record<string, unknown>, type: string | undefined) => readonly AgentEventSummary[]
> = {
  codex: codexEventSummaries,
  pi: piEventSummaries,
  claude: claudeEventSummaries,
  dsh: dshEventSummaries,
};

const eventSummaries = (
  agent: AgentProvider,
  line: string,
): readonly AgentEventSummary[] => {
  try {
    const event = jsonRecord(JSON.parse(line));
    if (!event) return [];
    return eventSummariesByAgent[agent](event, stringField(event, "type"));
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
  excludedTools?: readonly string[];
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
        ...(agentInvocation.environment
          ? { agentEnvironment: agentInvocation.environment }
          : {}),
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
      unsupportedReasoning: isUnsupportedReasoningError(
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
