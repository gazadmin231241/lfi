import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { gitResult } from "./git.js";
import {
  isExecutionTier,
  type ExecutionTier,
} from "./execution-tier.js";
import {
  trackerMarkdownFiles,
  validateTrackerPlacement,
} from "./tracker-layout.js";

export { COMPLETED_TASKS_DIRECTORY } from "./tracker-layout.js";

export type TrackerDocumentType = "task" | "spec";
export type TrackerStatus = "ready" | "completed" | "cancelled";

export interface TrackerDocument {
  id: string;
  number: number;
  type: TrackerDocumentType;
  title: string;
  status: TrackerStatus;
  executionTier?: ExecutionTier;
  spec?: string;
  blockedBy: string[];
  completedAt?: string;
  body: string;
  path: string;
}

export interface LocalTracker {
  root?: string;
  documents: TrackerDocument[];
  tasks: TrackerDocument[];
  specs: TrackerDocument[];
}

const idPattern = /^LFI-(\d+)$/u;

const scalar = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string") return parsed;
  }
  return trimmed;
};

const required = (
  fields: ReadonlyMap<string, string>,
  name: string,
  path: string,
): string => {
  const value = fields.get(name);
  if (!value) {
    throw new Error(`${path}: missing ${name} / отсутствует поле ${name}`);
  }
  return value;
};

export const parseTrackerDocument = (
  source: string,
  path: string,
): TrackerDocument => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source);
  if (!match) {
    throw new Error(
      `${path}: missing YAML frontmatter / отсутствует YAML frontmatter`,
    );
  }
  const fields = new Map<string, string>();
  const blockedBy: string[] = [];
  let list: "blocked_by" | undefined;
  for (const rawLine of match[1]!.split(/\r?\n/u)) {
    const item = /^\s*-\s+(.+)\s*$/u.exec(rawLine);
    if (item && list === "blocked_by") {
      blockedBy.push(scalar(item[1]!));
      continue;
    }
    const entry = /^([a-z_]+):(?:\s*(.*))?$/u.exec(rawLine);
    if (!entry) {
      if (rawLine.trim()) {
        throw new Error(
          `${path}: invalid frontmatter line / некорректная строка frontmatter`,
        );
      }
      continue;
    }
    list = entry[1] === "blocked_by" ? "blocked_by" : undefined;
    if (entry[2]) fields.set(entry[1]!, scalar(entry[2]));
  }
  const id = required(fields, "id", path);
  const idMatch = idPattern.exec(id);
  if (!idMatch) {
    throw new Error(`${path}: invalid LFI id / некорректный LFI ID: ${id}`);
  }
  const type = required(fields, "type", path);
  if (type !== "task" && type !== "spec") {
    throw new Error(
      `${path}: invalid document type / некорректный тип документа: ${type}`,
    );
  }
  const status = required(fields, "status", path);
  if (status !== "ready" && status !== "completed" && status !== "cancelled") {
    throw new Error(
      `${path}: invalid status / некорректный статус: ${status}`,
    );
  }
  const completedAt = fields.get("completed_at");
  const executionTier = fields.get("execution_tier");
  if (executionTier !== undefined && !isExecutionTier(executionTier)) {
    throw new Error(
      `${path}: invalid execution_tier / некорректный execution_tier: ${executionTier}`,
    );
  }
  if (type === "spec" && executionTier !== undefined) {
    throw new Error(
      `${path}: specifications cannot have execution_tier / у спецификаций не может быть execution_tier`,
    );
  }
  if (
    completedAt !== undefined &&
    !Number.isFinite(Date.parse(completedAt))
  ) {
    throw new Error(
      `${path}: invalid completed_at / некорректный completed_at: ${completedAt}`,
    );
  }
  if (status === "completed" && completedAt === undefined) {
    throw new Error(
      `${path}: completed documents require completed_at / для завершённых документов требуется completed_at`,
    );
  }
  return {
    id,
    number: Number(idMatch[1]),
    type,
    title: required(fields, "title", path),
    status,
    ...(executionTier === undefined ? {} : { executionTier }),
    ...(fields.get("spec") ? { spec: fields.get("spec")! } : {}),
    blockedBy,
    ...(completedAt === undefined ? {} : { completedAt }),
    body: match[2]!.replace(/^\r?\n/u, ""),
    path,
  };
};

export const serializeTrackerDocument = (
  document: TrackerDocument,
): string => {
  if (document.status === "completed" && document.completedAt === undefined) {
    throw new Error(
      `${document.path}: completed documents require completed_at / для завершённых документов требуется completed_at`,
    );
  }
  const lines = [
    "---",
    `id: ${document.id}`,
    `type: ${document.type}`,
    `title: ${JSON.stringify(document.title)}`,
    `status: ${document.status}`,
  ];
  if (document.executionTier !== undefined) {
    if (document.type !== "task") {
      throw new Error(
        `${document.path}: specifications cannot have execution_tier / у спецификаций не может быть execution_tier`,
      );
    }
    lines.push(`execution_tier: ${document.executionTier}`);
  }
  if (document.spec) lines.push(`spec: ${document.spec}`);
  lines.push("blocked_by:");
  for (const blocker of document.blockedBy) lines.push(`  - ${blocker}`);
  if (document.completedAt !== undefined) {
    lines.push(`completed_at: ${document.completedAt}`);
  }
  return `${lines.join("\n")}\n---\n\n${document.body}`;
};

const validateTracker = (
  lfiRoot: string,
  documents: readonly TrackerDocument[],
  allowPlacementDrift: boolean,
): void => {
  const byId = new Map<string, TrackerDocument>();
  for (const document of documents) {
    const filename = basename(document.path);
    const legacy = new RegExp(
      `^${document.id}-([\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*)\\.md$`,
      "u",
    ).exec(filename);
    const canonical =
      /^\[(?:SPEC|READY|RUNNING|BLOCKED|DONE|CANCELLED)\] (LFI-\d+) — ([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)\.md$/u.exec(
        filename,
      );
    const validFilename =
      legacy !== null ||
      (canonical !== null && canonical[1] === document.id);
    if (!validFilename) {
      throw new Error(
        `${document.path}: filename must be [STATUS] ${document.id} — informative-slug.md / имя файла должно быть [СТАТУС] ${document.id} — информативное-название.md`,
      );
    }
    if (byId.has(document.id)) {
      throw new Error(
        `Duplicate tracker id / повторяющийся ID трекера: ${document.id}`,
      );
    }
    byId.set(document.id, document);
  }

  if (!allowPlacementDrift) validateTrackerPlacement(lfiRoot, documents);
  for (const document of documents) {
    if (document.spec) {
      const spec = byId.get(document.spec);
      if (!spec || spec.type !== "spec") {
        throw new Error(
          `${document.id}: missing spec / отсутствует спецификация ${document.spec}`,
        );
      }
    }
    for (const blocker of document.blockedBy) {
      const target = byId.get(blocker);
      if (!target || target.type !== "task") {
        throw new Error(
          `${document.id}: missing blocker / отсутствует блокирующая задача ${blocker}`,
        );
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new Error(
        `Dependency cycle / цикл зависимостей обнаружен у ${id}`,
      );
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const blocker of byId.get(id)?.blockedBy ?? []) visit(blocker);
    visiting.delete(id);
    visited.add(id);
  };
  for (const document of documents.filter((item) => item.type === "task")) {
    visit(document.id);
  }
};

export const loadLocalTracker = async (
  lfiRoot: string,
  options: { allowPlacementDrift?: boolean } = {},
): Promise<LocalTracker> => {
  const paths = [
    ...(await trackerMarkdownFiles(join(lfiRoot, "tasks"), true)),
    ...(await trackerMarkdownFiles(join(lfiRoot, "specs"))),
  ];
  const documents = await Promise.all(
    paths.map(async (path) => ({ path, source: await readFile(path, "utf8") })),
  ).then((files) =>
    files
      .filter(({ source }) =>
        /^---\r?\n[\s\S]*?^type:\s*(?:task|spec)\s*$/mu.test(source),
      )
      .map(({ path, source }) => parseTrackerDocument(source, path)),
  );
  validateTracker(lfiRoot, documents, options.allowPlacementDrift ?? false);
  return {
    root: lfiRoot,
    documents,
    tasks: documents.filter((item) => item.type === "task"),
    specs: documents.filter((item) => item.type === "spec"),
  };
};

export const nextLfiId = (documents: readonly TrackerDocument[]): string =>
  `LFI-${Math.max(0, ...documents.map((document) => document.number)) + 1}`;

export const nextRepositoryLfiId = async (
  cwd: string,
  documents: readonly TrackerDocument[],
): Promise<string> => {
  const history = await gitResult(cwd, [
    "log",
    "--all",
    "-p",
    "--format=",
    "--",
    ".lfi/tasks",
    ".lfi/specs",
  ]);
  const historicalNumbers =
    history.exitCode === 0
      ? [...history.stdout.matchAll(/^[ +\-]?id:\s*LFI-(\d+)\s*$/gmu)].map(
          (match) => Number(match[1]),
        )
      : [];
  return `LFI-${
    Math.max(
      0,
      ...historicalNumbers,
      ...documents.map((document) => document.number),
    ) + 1
  }`;
};

export const saveTrackerDocument = async (
  document: TrackerDocument,
): Promise<void> => {
  await writeFile(document.path, serializeTrackerDocument(document));
};

export const runnableLocalTasks = (
  tracker: LocalTracker,
  selectedIds: readonly string[] = [],
): { runnable: TrackerDocument[]; blocked: TrackerDocument[] } => {
  const completed = new Set(
    tracker.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.id),
  );
  const selected = new Set(selectedIds);
  const candidates = tracker.tasks.filter(
    (task) =>
      task.status === "ready" &&
      (selected.size === 0 || selected.has(task.id)),
  );
  const runnable = candidates.filter((task) =>
    task.blockedBy.every((id) => completed.has(id)),
  );
  const runnableIds = new Set(runnable.map((task) => task.id));
  return {
    runnable,
    blocked: candidates.filter((task) => !runnableIds.has(task.id)),
  };
};
