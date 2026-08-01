import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { TrackerDocument } from "./local-tracker.js";

export const COMPLETED_TASKS_DIRECTORY = "completed";

export const trackerMarkdownFiles = async (
  directory: string,
  recursive = false,
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const nested = recursive
    ? await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => trackerMarkdownFiles(join(directory, entry.name), true)),
      )
    : [];
  return [
    ...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(directory, entry.name)),
    ...nested.flat(),
  ].sort();
};

const pathParts = (root: string, path: string): string[] =>
  relative(root, path).split(sep);

export const validateTrackerPlacement = (
  lfiRoot: string,
  documents: readonly TrackerDocument[],
): void => {
  const legacySpecs = new Set(
    documents
      .filter((document) => {
        const parts = pathParts(lfiRoot, document.path);
        return document.type === "spec" &&
          parts.length === 2 && parts[0] === "specs";
      })
      .map((document) => document.id),
  );
  const features = new Map<
    string,
    { specs: TrackerDocument[]; tasks: TrackerDocument[] }
  >();
  for (const document of documents) {
    const parts = pathParts(lfiRoot, document.path);
    const legacySpec = document.type === "spec" &&
      parts.length === 2 && parts[0] === "specs";
    const legacyCompletedTask = document.type === "task" &&
      parts.length === 3 && parts[0] === "tasks" &&
      parts[1] === COMPLETED_TASKS_DIRECTORY;
    const rootTask = document.type === "task" &&
      parts.length === 2 && parts[0] === "tasks";
    const legacyRootTask = rootTask && document.spec !== undefined &&
      legacySpecs.has(document.spec);
    const standaloneTask = rootTask && document.spec === undefined;
    const featureSpec = document.type === "spec" &&
      parts.length === 3 && parts[0] === "tasks" &&
      parts[1] !== COMPLETED_TASKS_DIRECTORY;
    const featureTask = document.type === "task" &&
      parts.length === 4 && parts[0] === "tasks" &&
      parts[1] !== COMPLETED_TASKS_DIRECTORY && parts[2] === "tasks";
    if (
      !legacySpec && !legacyCompletedTask && !legacyRootTask &&
      !standaloneTask && !featureSpec && !featureTask
    ) {
      throw new Error(
        `${document.path}: invalid tracker document placement / неверное расположение документа трекера`,
      );
    }
    if (featureSpec || featureTask) {
      const feature = parts[1]!;
      const group = features.get(feature) ?? { specs: [], tasks: [] };
      (featureSpec ? group.specs : group.tasks).push(document);
      features.set(feature, group);
    }
  }
  for (const [feature, group] of features) {
    if (group.specs.length !== 1) {
      throw new Error(
        `${join(lfiRoot, "tasks", feature)}: feature directory must contain exactly one specification / каталог функции должен содержать ровно одну спецификацию`,
      );
    }
    const specification = group.specs[0]!;
    for (const task of group.tasks) {
      if (task.spec !== specification.id) {
        throw new Error(
          `${task.path}: task must reference ${specification.id} / задача должна ссылаться на ${specification.id}`,
        );
      }
    }
  }
};
