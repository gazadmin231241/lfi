import { access, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  LocalTracker,
  TrackerDocument,
} from "./local-tracker.js";
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

export const reconcileTrackerFilenames = async (
  tracker: LocalTracker,
  active: ReadonlySet<string>,
): Promise<void> => {
  for (const document of tracker.documents) {
    const destination = join(
      dirname(document.path),
      trackerFilename(document, tracker, active),
    );
    if (destination === document.path) continue;
    if (await exists(destination)) {
      throw new Error(
        `${destination}: tracker filename already exists / имя файла трекера уже существует`,
      );
    }
    await rename(document.path, destination);
    document.path = destination;
  }
};
