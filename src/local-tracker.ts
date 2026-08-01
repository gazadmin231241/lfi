import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { gitResult } from "./git.js";
import {
  isExecutionTier,
  type ExecutionTier,
} from "./execution-tier.js";
import {
  trackerMarkdownFiles,
  validateTrackerPlacement,
} from "./tracker-layout.js";

export { TRACKER_ISSUES_DIRECTORY } from "./tracker-layout.js";

export type TrackerDocumentType =
  | "task"
  | "spec"
  | "research"
  | "prototype"
  | "grilling";
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
  body: string;
  path: string;
}

export interface LocalTracker {
  root?: string;
  documents: TrackerDocument[];
  tasks: TrackerDocument[];
  specs: TrackerDocument[];
}

const documentTypes: readonly TrackerDocumentType[] = [
  "task",
  "spec",
  "research",
  "prototype",
  "grilling",
];
const trackerStatusPrefixes = [
  "SPEC",
  "READY",
  "RUNNING",
  "BLOCKED",
  "DONE",
  "CANCELLED",
] as const;
type TrackerStatusPrefix = (typeof trackerStatusPrefixes)[number];
const statusPrefixPattern = trackerStatusPrefixes.join("|");
const filenamePattern = new RegExp(
  `^\\[(${statusPrefixPattern})\\] (LFI-(\\d+)) — ([\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*)\\.md$`,
  "u",
);
const historicalFilenamePattern = new RegExp(
  `\\[(?:${statusPrefixPattern})\\] LFI-(\\d+) —`,
  "gu",
);
const markerPattern = /^(Type|Blocked by|Tier):[ \t]*(.*)$/u;

const statusByPrefix = {
  SPEC: "ready",
  READY: "ready",
  RUNNING: "ready",
  BLOCKED: "ready",
  DONE: "completed",
  CANCELLED: "cancelled",
} as const satisfies Record<TrackerStatusPrefix, TrackerStatus>;

const isTrackerStatusPrefix = (value: string): value is TrackerStatusPrefix =>
  trackerStatusPrefixes.some((prefix) => prefix === value);

const isTrackerDocumentType = (value: string): value is TrackerDocumentType =>
  documentTypes.some((type) => type === value);

const titleFromSlug = (slug: string): string => {
  const title = slug.replaceAll("-", " ");
  return `${title.slice(0, 1).toLocaleUpperCase("en")}${title.slice(1)}`;
};

const filenameFields = (
  path: string,
): { id: string; number: number; title: string; status: TrackerStatus } => {
  const match = filenamePattern.exec(basename(path));
  if (!match) {
    throw new Error(
      `${path}: filename must be [STATUS] LFI-N — informative-slug.md / имя файла должно быть [СТАТУС] LFI-N — информативное-название.md`,
    );
  }
  const prefix = match[1]!;
  if (!isTrackerStatusPrefix(prefix)) {
    throw new Error(`${path}: invalid status prefix / некорректный префикс статуса`);
  }
  return {
    id: match[2]!,
    number: Number(match[3]),
    title: titleFromSlug(match[4]!),
    status: statusByPrefix[prefix],
  };
};

const markerValues = (source: string, path: string): Map<string, string> => {
  const markers = new Map<string, string>();
  for (const line of source.split(/\r?\n/u)) {
    const match = markerPattern.exec(line);
    if (!match) continue;
    if (markers.has(match[1]!)) {
      throw new Error(
        `${path}: duplicate ${match[1]}: marker / повторяющийся маркер ${match[1]}:`,
      );
    }
    markers.set(match[1]!, match[2]!.trim());
  }
  return markers;
};

const contentWithoutMarkers = (source: string): string =>
  source
    .split(/\r?\n/u)
    .filter((line) => !markerPattern.test(line))
    .join("\n")
    .replace(/^\n+/u, "");

const specificationFromBody = (body: string): string | undefined =>
  /^## Specification\s+\[?(LFI-\d+)\b/mu.exec(body)?.[1];

export const parseTrackerDocument = (
  source: string,
  path: string,
): TrackerDocument => {
  const identity = filenameFields(path);
  const markers = markerValues(source, path);
  const type = markers.get("Type");
  if (!type) {
    throw new Error(`${path}: missing Type: / отсутствует Type:`);
  }
  if (!isTrackerDocumentType(type)) {
    throw new Error(
      `${path}: invalid Type: / некорректный Type:: ${type}`,
    );
  }
  const tier = markers.get("Tier");
  if (tier !== undefined && !isExecutionTier(tier)) {
    throw new Error(`${path}: invalid Tier: / некорректный Tier:: ${tier}`);
  }
  if (type !== "task" && tier !== undefined) {
    throw new Error(
      `${path}: only tasks can have Tier: / только задачи могут иметь Tier:`,
    );
  }
  const blockedByMarker = markers.get("Blocked by") ?? "";
  if (
    blockedByMarker !== "" &&
    blockedByMarker !== "None" &&
    !/^LFI-\d+(?:\s*,\s*LFI-\d+)*$/u.test(blockedByMarker)
  ) {
    throw new Error(
      `${path}: invalid Blocked by: / некорректный Blocked by:: ${blockedByMarker}`,
    );
  }
  const blockedBy = [...blockedByMarker.matchAll(/\bLFI-(\d+)\b/gu)].map(
    (match) => `LFI-${match[1]}`,
  );
  const body = contentWithoutMarkers(source);
  const spec = specificationFromBody(body);
  return {
    ...identity,
    type,
    ...(tier === undefined ? {} : { executionTier: tier }),
    ...(spec === undefined ? {} : { spec }),
    blockedBy,
    body,
    path,
  };
};

export const serializeTrackerDocument = (
  document: TrackerDocument,
): string => {
  if (
    document.executionTier !== undefined &&
    document.type !== "task"
  ) {
    throw new Error(
      `${document.path}: only tasks can have Tier: / только задачи могут иметь Tier:`,
    );
  }
  const markers = [
    `Type: ${document.type}`,
    `Blocked by: ${document.blockedBy.length > 0 ? document.blockedBy.join(", ") : "None"}`,
  ];
  if (document.executionTier !== undefined) {
    markers.push(`Tier: ${document.executionTier}`);
  }
  const body = contentWithoutMarkers(document.body);
  return `${markers.join("\n")}\n${body ? `\n${body}` : ""}`;
};

const inferSpecificationFromPlacement = (
  documents: readonly TrackerDocument[],
): void => {
  const specificationsByDirectory = new Map(
    documents
      .filter((document) => document.type === "spec")
      .map((document) => [dirname(document.path), document.id]),
  );
  for (const document of documents) {
    if (document.type === "spec" || document.spec !== undefined) continue;
    const specification = specificationsByDirectory.get(dirname(dirname(document.path)));
    if (specification !== undefined) document.spec = specification;
  }
};

const validateTracker = (
  trackerRoot: string,
  documents: readonly TrackerDocument[],
  allowPlacementDrift: boolean,
): void => {
  const byId = new Map<string, TrackerDocument>();
  for (const document of documents) {
    if (byId.has(document.id)) {
      throw new Error(
        `Duplicate tracker id / повторяющийся ID трекера: ${document.id}`,
      );
    }
    byId.set(document.id, document);
  }

  if (!allowPlacementDrift) validateTrackerPlacement(trackerRoot, documents);
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
      throw new Error(`Dependency cycle / цикл зависимостей обнаружен у ${id}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const blocker of byId.get(id)?.blockedBy ?? []) visit(blocker);
    visiting.delete(id);
    visited.add(id);
  };
  for (const document of documents) visit(document.id);
};

export const loadLocalTracker = async (
  trackerRoot: string,
  options: { allowPlacementDrift?: boolean } = {},
): Promise<LocalTracker> => {
  const paths = await trackerMarkdownFiles(trackerRoot, true);
  const documents = await Promise.all(
    paths.map(async (path) => parseTrackerDocument(await readFile(path, "utf8"), path)),
  );
  inferSpecificationFromPlacement(documents);
  validateTracker(trackerRoot, documents, options.allowPlacementDrift ?? false);
  return {
    root: trackerRoot,
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
    "-c",
    "core.quotepath=false",
    "log",
    "--all",
    "-p",
    "--format=",
    "--",
    ".scratch",
  ]);
  const historicalNumbers = history.exitCode === 0
    ? [
        ...history.stdout.matchAll(/^[ +\-]?id:\s*LFI-(\d+)\s*$/gmu),
        ...history.stdout.matchAll(historicalFilenamePattern),
      ].map((match) => Number(match[1]))
    : [];
  return `LFI-${Math.max(0, ...historicalNumbers, ...documents.map((document) => document.number)) + 1}`;
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
    (task) => task.status === "ready" && (selected.size === 0 || selected.has(task.id)),
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
