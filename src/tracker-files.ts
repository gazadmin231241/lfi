import { access, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  loadLocalTracker,
  saveTrackerDocument,
  type LocalTracker,
  type TrackerDocument,
} from "./local-tracker.js";
import { TRACKER_ISSUES_DIRECTORY } from "./tracker-layout.js";
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

const featureDirectories = (tracker: LocalTracker): Map<string, string> =>
  new Map(
    tracker.specs.map((specification) => [
      specification.id,
      dirname(specification.path),
    ]),
  );

export const trackerTargetPath = (
  document: TrackerDocument,
  tracker: LocalTracker,
  active: ReadonlySet<string>,
): string => {
  if (tracker.root === undefined) {
    throw new Error(
      "Tracker root is required for reconciliation / для сверки требуется корень трекера",
    );
  }
  const directories = featureDirectories(tracker);
  const filename = trackerFilename(document, tracker, active);
  if (document.type === "spec") {
    return join(directories.get(document.id)!, filename);
  }
  if (document.spec === undefined) return join(tracker.root, filename);
  const feature = directories.get(document.spec);
  if (feature === undefined) {
    throw new Error(
      `${document.id}: missing spec / отсутствует спецификация ${document.spec}`,
    );
  }
  return join(feature, TRACKER_ISSUES_DIRECTORY, filename);
};

export const reconcileTrackerFilenames = async (
  tracker: LocalTracker,
  active: ReadonlySet<string>,
): Promise<void> => {
  for (const document of tracker.documents) {
    const destination = trackerTargetPath(document, tracker, active);
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

export const loadReconciledLocalTracker = async (
  trackerRoot: string,
  active: ReadonlySet<string> = new Set(),
): Promise<LocalTracker> => {
  const tracker = await loadLocalTracker(trackerRoot, {
    allowPlacementDrift: true,
  });
  await reconcileTrackerFilenames(tracker, active);
  return loadLocalTracker(trackerRoot);
};
