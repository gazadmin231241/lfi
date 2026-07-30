import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const runHeader = /^--- Run started: ([^;]+); iteration: (\d+) ---$/mu;

export interface RunLogContext {
  directory: string;
  startedAt: string;
  iteration: number;
}

export const redactSensitiveText = (source: string): string => {
  let redacted = source
    .replace(/\bgithub_pat_[a-z0-9_]{10,}\b/giu, "[REDACTED]")
    .replace(/\bgh[pousr]_[a-z0-9]{10,}\b/giu, "[REDACTED]")
    .replace(/\b(?:sk|sess)-[a-z0-9_-]{10,}\b/giu, "[REDACTED]")
    .replace(
      /((?:token|secret|password|passwd|api_key|private_key|credentials?)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/giu,
      "$1[REDACTED]",
    );
  for (const [name, value] of Object.entries(process.env)) {
    if (
      /token|secret|password|passwd|api_key|private_key|credential/iu.test(name) &&
      value &&
      value.length >= 8
    ) {
      redacted = redacted.replaceAll(value, "[REDACTED]");
    }
  }
  return redacted;
};

export const formatRunLogSection = (
  runId: string,
  stage: number,
  content: string,
): string =>
  `\n--- Run started: ${runId}; iteration: ${stage} ---\n${content.trimEnd()}\n`;

export const splitRunLogSections = (source: string): string[] =>
  source.trimStart().split(/(?=^--- Run started: )/gmu);

export const runLogSectionMetadata = (
  section: string,
): { startedAt: string; iteration: number } | undefined => {
  const match = runHeader.exec(section);
  return match?.[1] && match[2]
    ? { startedAt: match[1], iteration: Number(match[2]) }
    : undefined;
};

export const appendRunLog = async (
  context: RunLogContext,
  name: string,
  lines: readonly string[],
): Promise<string> => {
  await mkdir(context.directory, { recursive: true });
  const path = join(context.directory, `${name}.log`);
  await appendFile(
    path,
    redactSensitiveText(
      formatRunLogSection(
        context.startedAt,
        context.iteration,
        lines.join("\n"),
      ),
    ),
  );
  return path;
};

export const writeFailureLog = async (
  context: RunLogContext,
  name: string,
  rawOutput: string,
): Promise<string> => {
  const failuresRoot = join(context.directory, "failures");
  await mkdir(failuresRoot, { recursive: true });
  const timestamp = context.startedAt.replaceAll(":", "-");
  const path = join(
    failuresRoot,
    `${name}--${timestamp}--iteration-${context.iteration}.jsonl.gz`,
  );
  await writeFile(path, gzipSync(redactSensitiveText(rawOutput)));
  return path;
};

export const pruneExpiredRunLogs = async (
  logsRoot: string,
  options: {
    retentionDays: number;
    activeRunName?: string;
    now?: Date;
  },
): Promise<string[]> => {
  if (options.retentionDays === 0) return [];
  const entries = await readdir(logsRoot, { withFileTypes: true }).catch(() => []);
  const cutoff =
    (options.now ?? new Date()).getTime() -
    options.retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".log")) {
      const path = join(logsRoot, entry.name);
      const source = await readFile(path, "utf8");
      const sections = splitRunLogSections(source);
      const retained = sections.filter((section) => {
        const timestamp = runLogSectionMetadata(section)?.startedAt;
        if (!timestamp) return true;
        const startedAt = new Date(timestamp).getTime();
        return Number.isNaN(startedAt) || startedAt >= cutoff;
      });
      if (retained.length === 0) {
        await rm(path, { force: true });
        removed.push(entry.name);
      } else if (retained.length !== sections.length) {
        await writeFile(path, `\n${retained.join("")}`);
      }
      continue;
    }
    if (entry.isDirectory() && entry.name === "failures") {
      for (const failure of await readdir(join(logsRoot, entry.name), {
        withFileTypes: true,
      })) {
        if (!failure.isFile()) continue;
        const relativePath = join(entry.name, failure.name);
        const path = join(logsRoot, relativePath);
        if ((await stat(path)).mtimeMs >= cutoff) continue;
        await rm(path, { force: true });
        removed.push(relativePath);
      }
      continue;
    }
    if (!entry.isDirectory() || entry.name === options.activeRunName) continue;
    const path = join(logsRoot, entry.name);
    const metadata = await stat(path);
    if (metadata.mtimeMs >= cutoff) continue;
    await rm(path, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed.sort();
};
