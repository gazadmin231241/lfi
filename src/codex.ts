import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ReasoningEffort } from "./config.js";
import {
  formatRunLogSection,
  redactSensitiveText,
  type RunLogContext,
} from "./logs.js";
import { runCommand } from "./process.js";

const workerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["completed", "incomplete"] },
    summary: { type: "string" },
  },
  required: ["status", "summary"],
};

export interface CodexRunResult {
  exitCode: number;
  status: "completed" | "incomplete" | undefined;
  summary: string;
}

export const isUnavailableModelError = (message: string): boolean =>
  /model_not_found|unsupported model|model\b[^\n]*(?:not (?:available|found|supported)|does not exist|do not have access)/iu.test(
    message,
  );

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

export const runCodex = async (options: {
  cwd: string;
  prompt: string;
  model: string;
  reasoning: ReasoningEffort;
  gitDirectory: string;
  log: RunLogContext;
  logName: string;
  idleTimeoutMinutes: number;
  structured?: boolean;
  prefix: string;
}): Promise<CodexRunResult> => {
  await mkdir(options.log.directory, { recursive: true });
  const compactPath = join(options.log.directory, `${options.logName}.log`);
  const artifacts = await mkdtemp(join(tmpdir(), "lfi-codex-"));
  const finalPath = join(artifacts, "result.json");
  const schemaPath = join(artifacts, "schema.json");
  await appendFile(
    compactPath,
    formatRunLogSection(
      options.log.startedAt,
      options.log.iteration,
      "",
    ),
  );
  let lineBuffer = "";
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
    if (options.structured !== false) {
      await writeFile(schemaPath, `${JSON.stringify(workerSchema, null, 2)}\n`);
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
      "-o",
      finalPath,
    ];
    if (options.model) args.push("--model", options.model);
    if (options.structured !== false) {
      args.push("--output-schema", schemaPath);
    }
    args.push("-");
    const result = await runCommand("codex", args, {
      cwd: options.cwd,
      input: options.prompt,
      idleTimeoutMs: options.idleTimeoutMinutes * 60_000,
      onStdout: (chunk) => {
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) recordEvent(line);
      },
      onStderr: (chunk) => {
        appendDetail(chunk);
      },
    });
    if (lineBuffer) recordEvent(lineBuffer);
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
    };
  } finally {
    await logWrites;
    await rm(artifacts, { recursive: true, force: true });
  }
};
