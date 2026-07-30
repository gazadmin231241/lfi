import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type TrackerDocumentType = "task" | "spec";
export type TrackerStatus = "ready" | "completed" | "cancelled";

export interface TrackerDocument {
  id: string;
  number: number;
  type: TrackerDocumentType;
  title: string;
  status: TrackerStatus;
  spec?: string;
  blockedBy: string[];
  githubIssue?: number;
  body: string;
  path: string;
}

export interface LocalTracker {
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
  if (!value) throw new Error(`${path}: missing ${name}`);
  return value;
};

export const parseTrackerDocument = (
  source: string,
  path: string,
): TrackerDocument => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source);
  if (!match) throw new Error(`${path}: missing YAML frontmatter`);
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
      if (rawLine.trim()) throw new Error(`${path}: invalid frontmatter line`);
      continue;
    }
    list = entry[1] === "blocked_by" ? "blocked_by" : undefined;
    if (entry[2]) fields.set(entry[1]!, scalar(entry[2]));
  }
  const id = required(fields, "id", path);
  const idMatch = idPattern.exec(id);
  if (!idMatch) throw new Error(`${path}: invalid LFI id ${id}`);
  const type = required(fields, "type", path);
  if (type !== "task" && type !== "spec") {
    throw new Error(`${path}: invalid document type ${type}`);
  }
  const status = required(fields, "status", path);
  if (status !== "ready" && status !== "completed" && status !== "cancelled") {
    throw new Error(`${path}: invalid status ${status}`);
  }
  const github = fields.get("github_issue");
  const githubIssue = github === undefined ? undefined : Number(github);
  if (
    githubIssue !== undefined &&
    (!Number.isSafeInteger(githubIssue) || githubIssue < 1)
  ) {
    throw new Error(`${path}: invalid github_issue ${github}`);
  }
  return {
    id,
    number: Number(idMatch[1]),
    type,
    title: required(fields, "title", path),
    status,
    ...(fields.get("spec") ? { spec: fields.get("spec")! } : {}),
    blockedBy,
    ...(githubIssue === undefined ? {} : { githubIssue }),
    body: match[2]!.replace(/^\r?\n/u, ""),
    path,
  };
};

export const serializeTrackerDocument = (
  document: TrackerDocument,
): string => {
  const lines = [
    "---",
    `id: ${document.id}`,
    `type: ${document.type}`,
    `title: ${JSON.stringify(document.title)}`,
    `status: ${document.status}`,
  ];
  if (document.spec) lines.push(`spec: ${document.spec}`);
  lines.push("blocked_by:");
  for (const blocker of document.blockedBy) lines.push(`  - ${blocker}`);
  if (document.githubIssue !== undefined) {
    lines.push(`github_issue: ${document.githubIssue}`);
  }
  return `${lines.join("\n")}\n---\n\n${document.body}`;
};

const markdownFiles = async (directory: string): Promise<string[]> =>
  (await readdir(directory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(directory, entry.name))
    .sort();

const validateTracker = (documents: readonly TrackerDocument[]): void => {
  const byId = new Map<string, TrackerDocument>();
  for (const document of documents) {
    if (byId.has(document.id)) {
      throw new Error(`Duplicate tracker id: ${document.id}`);
    }
    byId.set(document.id, document);
  }
  for (const document of documents) {
    if (document.spec) {
      const spec = byId.get(document.spec);
      if (!spec || spec.type !== "spec") {
        throw new Error(`${document.id}: missing spec ${document.spec}`);
      }
    }
    for (const blocker of document.blockedBy) {
      const target = byId.get(blocker);
      if (!target || target.type !== "task") {
        throw new Error(`${document.id}: missing blocker ${blocker}`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}`);
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

export const loadLocalTracker = async (lfiRoot: string): Promise<LocalTracker> => {
  const paths = [
    ...(await markdownFiles(join(lfiRoot, "tasks"))),
    ...(await markdownFiles(join(lfiRoot, "specs"))),
  ];
  const documents = await Promise.all(
    paths.map(async (path) =>
      parseTrackerDocument(await readFile(path, "utf8"), path),
    ),
  );
  validateTracker(documents);
  return {
    documents,
    tasks: documents.filter((item) => item.type === "task"),
    specs: documents.filter((item) => item.type === "spec"),
  };
};

export const nextLfiId = (documents: readonly TrackerDocument[]): string =>
  `LFI-${Math.max(0, ...documents.map((document) => document.number)) + 1}`;

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
