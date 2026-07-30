import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Language } from "./i18n.js";
import { runLogSectionMetadata, splitRunLogSections } from "./logs.js";

export interface LogRun {
  startedAt: string;
  tasks: string[];
  status: "running" | "completed" | "failed" | "no_tasks";
  iterations: number;
}

const readObject = async (
  path: string,
): Promise<Record<string, unknown> | undefined> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : undefined;
  } catch {
    return undefined;
  }
};

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const unresolvedIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const id = Reflect.get(item, "id");
        return typeof id === "string" ? [id] : [];
      })
    : [];

const historyEntry = (
  value: Record<string, unknown>,
): LogRun | undefined => {
  const startedAt = value.startedAt;
  if (typeof startedAt !== "string") return undefined;
  const completed = strings(value.completed);
  const unresolved = unresolvedIds(value.unresolved);
  const iterations =
    typeof value.iterations === "number" ? value.iterations : 0;
  return {
    startedAt,
    tasks: [...new Set([...completed, ...unresolved])],
    status:
      unresolved.length > 0
        ? "failed"
        : completed.length > 0
          ? "completed"
          : "no_tasks",
    iterations,
  };
};

const legacyStartedAt = (name: string): string | undefined => {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}(?:\.\d+)?)Z$/u.exec(name);
  if (!match) return undefined;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const legacyRun = async (
  logsRoot: string,
  directory: string,
): Promise<LogRun | undefined> => {
  const startedAt = legacyStartedAt(directory);
  if (!startedAt) return undefined;
  const files = await readdir(join(logsRoot, directory)).catch(() => []);
  const workers = files.flatMap((file) => {
    const match = /^(lfi-\d+|issue-(\d+))-(\d+)\.log$/iu.exec(file);
    if (!match) return [];
    return [
      {
        task: match[2] ? `#${match[2]}` : (match[1] ?? "").toUpperCase(),
        iteration: Number(match[3]),
      },
    ];
  });
  const summary = await readObject(join(logsRoot, directory, "summary.json"));
  const completed = strings(summary?.completed);
  const unresolved = unresolvedIds(summary?.unresolved);
  const summaryTasks = [...new Set([...completed, ...unresolved])];
  return {
    startedAt,
    tasks:
      summaryTasks.length > 0
        ? summaryTasks
        : [...new Set(workers.map((worker) => worker.task))],
    status: summary
      ? unresolved.length > 0
        ? "failed"
        : completed.length > 0
          ? "completed"
          : "no_tasks"
      : "failed",
    iterations: Math.max(0, ...workers.map((worker) => worker.iteration)),
  };
};

export const listLogRuns = async (lfiRoot: string): Promise<LogRun[]> => {
  const stateRoot = join(lfiRoot, "state");
  const historyRoot = join(stateRoot, "history");
  const runs: LogRun[] = [];
  const current = await readObject(join(stateRoot, "current-run.json"));
  if (
    (current?.status === "running" ||
      current?.status === "failed" ||
      current?.status === "interrupted") &&
    typeof current.startedAt === "string" &&
    (typeof current.stage === "number" || current.status !== "running")
  ) {
    runs.push({
      startedAt: current.startedAt,
      tasks: [
        ...new Set([
          ...strings(current.completed),
          ...strings(current.activeIssues),
        ]),
      ],
      status: current.status === "running" ? "running" : "failed",
      iterations: typeof current.stage === "number" ? current.stage : 0,
    });
  }
  const historyFiles = await readdir(historyRoot).catch(() => []);
  for (const file of historyFiles) {
    const value = await readObject(join(historyRoot, file));
    const entry = value ? historyEntry(value) : undefined;
    if (entry) runs.push(entry);
  }
  const logsRoot = join(lfiRoot, "logs");
  const logEntries = await readdir(logsRoot, { withFileTypes: true }).catch(
    () => [],
  );
  for (const directory of logEntries.filter((entry) => entry.isDirectory())) {
    const legacy = await legacyRun(logsRoot, directory.name);
    if (
      legacy &&
      !runs.some((run) => run.startedAt === legacy.startedAt)
    ) {
      runs.push(legacy);
    }
  }
  return runs.sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
};

export const formatLogRuns = (
  runs: readonly LogRun[],
  language: Language,
  timeZone?: string,
): string => {
  const text =
    language === "ru"
      ? {
          headers: ["Время", "Задачи", "Результат", "Итерации"],
          statuses: {
            running: "выполняется",
            completed: "завершено",
            failed: "ошибка",
            no_tasks: "нет задач",
          },
        }
      : {
          headers: ["Time", "Tasks", "Result", "Iterations"],
          statuses: {
            running: "running",
            completed: "completed",
            failed: "failed",
            no_tasks: "no tasks",
          },
        };
  const dateFormat = new Intl.DateTimeFormat(
    language === "ru" ? "ru-RU" : "en-GB",
    {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    },
  );
  const rows = runs.map((run) => [
    dateFormat.format(new Date(run.startedAt)),
    run.tasks.join(", ") || "—",
    text.statuses[run.status],
    String(run.iterations),
  ]);
  const allRows = [text.headers, ...rows];
  const widths = text.headers.map((_, index) =>
    Math.max(...allRows.map((row) => row[index]?.length ?? 0)),
  );
  return allRows
    .map((row) =>
      row
        .map((cell, index) =>
          index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0),
        )
        .join("  "),
    )
    .join("\n");
};

export const formatTaskLogSection = (
  content: string,
  language: Language,
): string => {
  const metadata = runLogSectionMetadata(content);
  if (language !== "ru" || !metadata) return content;
  const lineBreak = content.indexOf("\n");
  const body = lineBreak >= 0 ? content.slice(lineBreak) : "";
  return `--- Запуск начат: ${metadata.startedAt}; итерация: ${metadata.iteration} ---${body}`;
};

const logCandidates = (identifier: string): string[] => {
  if (/^\d+$/u.test(identifier)) {
    return [`LFI-${identifier}.log`, `issue-${identifier}.log`];
  }
  if (/^LFI-\d+$/iu.test(identifier)) {
    return [`${identifier.toUpperCase()}.log`];
  }
  return [`${identifier}.log`];
};

const legacyPrefixes = (identifier: string): string[] => {
  if (/^\d+$/u.test(identifier)) return [`lfi-${identifier}`, `issue-${identifier}`];
  return [identifier.toLowerCase()];
};

export const readLatestTaskLog = async (
  logsRoot: string,
  identifier: string,
): Promise<{ path: string; content: string } | undefined> => {
  for (const candidate of logCandidates(identifier)) {
    const path = join(logsRoot, candidate);
    const source = await readFile(path, "utf8").catch(() => undefined);
    if (source === undefined) continue;
    const sections = splitRunLogSections(source);
    const latest = sections.at(-1);
    if (latest) return { path, content: `${latest.trimEnd()}\n` };
  }
  const directories = (
    await readdir(logsRoot, { withFileTypes: true }).catch(() => [])
  )
    .filter((entry) => entry.isDirectory() && legacyStartedAt(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const directory of directories) {
    const files = await readdir(join(logsRoot, directory)).catch(() => []);
    const prefixes = legacyPrefixes(identifier);
    const matches = files
      .filter((file) => {
        const match = /^(.+)-\d+\.log$/iu.exec(file);
        return match?.[1]
          ? prefixes.includes(match[1].toLowerCase())
          : false;
      })
      .sort()
      .reverse();
    const file = matches[0];
    if (!file) continue;
    const path = join(logsRoot, directory, file);
    return { path, content: await readFile(path, "utf8") };
  }
  return undefined;
};
