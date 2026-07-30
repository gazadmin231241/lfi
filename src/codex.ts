import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";

import type { ReasoningEffort } from "./config.js";
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
  compactLogPath: string;
  rawLogPath?: string;
}

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

const eventSummary = (line: string): string | undefined => {
  try {
    const event = JSON.parse(line) as {
      type?: string;
      item?: { type?: string; text?: string; command?: string; status?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      return event.item.text;
    }
    if (event.type === "item.started" && event.item?.type === "command_execution") {
      return `$ ${event.item.command ?? "command"}`;
    }
    if (event.type === "turn.completed") {
      return `turn.completed input=${event.usage?.input_tokens ?? "?"} output=${event.usage?.output_tokens ?? "?"}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const gzipAndRemove = async (path: string): Promise<string> => {
  const target = `${path}.gz`;
  await pipeline(createReadStream(path), createGzip(), createWriteStream(target));
  await rm(path, { force: true });
  return target;
};

export const runCodex = async (options: {
  cwd: string;
  prompt: string;
  model: string;
  reasoning: ReasoningEffort;
  gitDirectory: string;
  logsDirectory: string;
  logName: string;
  idleTimeoutMinutes: number;
  structured?: boolean;
  prefix: string;
}): Promise<CodexRunResult> => {
  await mkdir(options.logsDirectory, { recursive: true });
  const rawPath = join(options.logsDirectory, `${options.logName}.jsonl`);
  const compactPath = join(options.logsDirectory, `${options.logName}.log`);
  const finalPath = join(options.logsDirectory, `${options.logName}.result.json`);
  const schemaPath = join(options.logsDirectory, "worker-output-schema.json");
  if (options.structured !== false) {
    await writeFile(schemaPath, `${JSON.stringify(workerSchema, null, 2)}\n`);
  }
  let lineBuffer = "";
  const compactLines: string[] = [];
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
      for (const line of lines) {
        const summary = eventSummary(line);
        if (!summary) continue;
        console.log(`[${options.prefix}] ${summary}`);
        compactLines.push(summary);
      }
    },
    onStderr: (chunk) => {
      process.stderr.write(`[${options.prefix}] ${chunk}`);
      compactLines.push(chunk);
    },
  });
  const finalSource = await readFile(finalPath, "utf8").catch(() => "");
  const parsed = parseFinal(finalSource);
  await writeFile(rawPath, result.stdout);
  await writeFile(
    compactPath,
    `${compactLines.join("\n")}\n\nexit=${result.exitCode}\nstatus=${parsed.status ?? "missing"}\n${parsed.summary}\n`,
  );
  await rm(finalPath, { force: true });
  const rawLogPath = await gzipAndRemove(rawPath).catch(() => undefined);
  return {
    exitCode: result.exitCode,
    status: parsed.status,
    summary: parsed.summary || result.stderr,
    compactLogPath: compactPath,
    ...(rawLogPath ? { rawLogPath } : {}),
  };
};
