import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ReasoningEffort } from "./config.js";
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

const workerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["completed", "incomplete"] },
    summary: { type: "string" },
  },
  required: ["status", "summary"],
};

export type AgentProvider = "codex";
export const defaultAgentProvider: AgentProvider = "codex";

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
  finalPath: string;
  schemaPath: string;
  structured?: boolean;
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
    "-o",
    options.finalPath,
  ];
  if (options.model) args.push("--model", options.model);
  if (options.structured !== false) {
    args.push("--output-schema", options.schemaPath);
  }
  args.push("-");
  return { command: options.agent, args, input: options.prompt };
};

const parseFinal = (
  source: string,
): {
  status: "completed" | "incomplete" | undefined;
  summary: string;
} => {
  try {
    const parsed = JSON.parse(source) as {
      status?: "completed" | "incomplete";
      summary?: string;
    };
    return { status: parsed.status, summary: parsed.summary ?? "" };
  } catch {
    return { status: undefined, summary: source.trim() };
  }
};

const eventSummary = (
  line: string,
): { text: string; showInTerminal: boolean } | undefined => {
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
      };
    }
    if (event.type === "item.started" && event.item?.type === "command_execution") {
      return {
        text: `$ ${event.item.command ?? "command"}`,
        showInTerminal: false,
      };
    }
    if (event.type === "turn.completed") {
      return {
        text: `turn.completed input=${event.usage?.input_tokens ?? "?"} output=${event.usage?.output_tokens ?? "?"}`,
        showInTerminal: false,
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
  structured?: boolean;
  prefix: string;
}): Promise<AgentRunResult> => {
  await mkdir(options.log.directory, { recursive: true });
  const compactPath = join(options.log.directory, `${options.logName}.log`);
  const artifacts = await mkdtemp(join(options.gitDirectory, "lfi-agent-"));
  const finalPath = join(artifacts, "result.json");
  const schemaPath = join(artifacts, "schema.json");
  const sanitizedGitConfig = join(artifacts, "safe-git-config");
  await appendFile(
    compactPath,
    formatRunLogSection(
      options.log.startedAt,
      options.log.iteration,
      "",
    ),
  );
  let logWrites = Promise.resolve();
  const appendDetail = (content: string): void => {
    const redacted = redactSensitiveText(content);
    logWrites = logWrites.then(() => appendFile(compactPath, redacted));
  };
  const recordEvent = (line: string): void => {
    const summary = eventSummary(line);
    if (!summary) return;
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
    if (options.structured !== false) {
      await writeFile(schemaPath, `${JSON.stringify(workerSchema, null, 2)}\n`);
    }
    const agentInvocation = buildAgentInvocation({
      ...options,
      finalPath,
      schemaPath,
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
    const finalSource = await readFile(finalPath, "utf8").catch(() => "");
    const parsed = parseFinal(finalSource);
    const summary = redactSensitiveText(parsed.summary || result.stderr);
    appendDetail(
      `\nexit=${result.exitCode}\nstatus=${parsed.status ?? "missing"}\n${summary}\n`,
    );
    return {
      exitCode: result.exitCode,
      status: parsed.status,
      summary,
      unavailableModel: isUnavailableModelError(options.agent, summary),
    };
  } finally {
    await logWrites;
    await rm(artifacts, { recursive: true, force: true });
  }
};
