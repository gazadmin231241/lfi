import { access, mkdir, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type {
  LocalTracker,
  TrackerDocument,
} from "./local-tracker.js";
import {
  COMPLETED_TASKS_DIRECTORY,
  saveTrackerDocument,
} from "./local-tracker.js";
import { withLocalRelationships } from "./local-relationships.js";
import {
  trackerDisplayState,
  trackerStatusPrefix,
} from "./tracker-state.js";

export const trackerTitleSlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80) || "document";

export const trackerFilename = (
  document: TrackerDocument,
  tracker: LocalTracker,
  active: ReadonlySet<string>,
): string => {
  const state = trackerDisplayState(document, tracker, active);
  const prefix =
    state === "cancelled" ? "[CANCELLED]" : trackerStatusPrefix(state);
  return `${prefix} ${document.id} — ${trackerTitleSlug(document.title)}.md`;
};

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const trackerDirectory = (document: TrackerDocument): string => {
  const current = dirname(document.path);
  if (document.type !== "task") return current;
  const tasksRoot =
    basename(current) === COMPLETED_TASKS_DIRECTORY
      ? dirname(current)
      : current;
  return document.status === "completed"
    ? join(tasksRoot, COMPLETED_TASKS_DIRECTORY)
    : tasksRoot;
};

export const reconcileTrackerFilenames = async (
  tracker: LocalTracker,
  active: ReadonlySet<string>,
): Promise<void> => {
  for (const document of tracker.documents) {
    const destination = join(
      trackerDirectory(document),
      trackerFilename(document, tracker, active),
    );
    if (destination === document.path) continue;
    if (await exists(destination)) {
      throw new Error(
        `${destination}: tracker filename already exists / имя файла трекера уже существует`,
      );
    }
    await mkdir(dirname(destination), { recursive: true });
    await rename(document.path, destination);
    document.path = destination;
  }
  for (const document of tracker.documents) {
    const body = withLocalRelationships(document, tracker);
    if (body === document.body) continue;
    document.body = body;
    await saveTrackerDocument(document);
  }
};
