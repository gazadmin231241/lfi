import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import type { TrackerDocument } from "./local-tracker.js";

export const TRACKER_ISSUES_DIRECTORY = "issues";

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
  trackerRoot: string,
  documents: readonly TrackerDocument[],
): void => {
  const features = new Map<
    string,
    { specs: TrackerDocument[]; tasks: TrackerDocument[] }
  >();
  for (const document of documents) {
    const parts = pathParts(trackerRoot, document.path);
    const standaloneTask = document.type !== "spec" && parts.length === 1;
    const featureSpec = document.type === "spec" && parts.length === 2;
    const featureTask = document.type !== "spec" &&
      parts.length === 3 && parts[1] === TRACKER_ISSUES_DIRECTORY;
    if (
      !standaloneTask && !featureSpec && !featureTask
    ) {
      throw new Error(
        `${document.path}: invalid tracker document placement / неверное расположение документа трекера`,
      );
    }
    if (featureSpec || featureTask) {
      const feature = parts[0]!;
      const group = features.get(feature) ?? { specs: [], tasks: [] };
      (featureSpec ? group.specs : group.tasks).push(document);
      features.set(feature, group);
    }
  }
  for (const [feature, group] of features) {
    if (group.specs.length !== 1) {
      throw new Error(
        `${join(trackerRoot, feature)}: feature directory must contain exactly one specification / каталог функции должен содержать ровно одну спецификацию`,
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
