import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  LocalTracker,
  TrackerDocument,
} from "./local-tracker.js";
import { STATUS_PREFIX } from "./tracker-contract.js";

export type TrackerDisplayState =
  | "spec"
  | "ready"
  | "running"
  | "blocked"
  | "done"
  | "cancelled";

export const readActiveTaskIds = async (
  lfiRoot: string,
): Promise<Set<string>> => {
  const source = await readFile(
    join(lfiRoot, "state", "current-run.json"),
    "utf8",
  ).catch(() => "");
  if (!source) return new Set();
  const parsed: unknown = JSON.parse(source);
  if (typeof parsed !== "object" || parsed === null) return new Set();
  const active = Reflect.get(parsed, "activeIssues");
  return new Set(
    Array.isArray(active)
      ? active.filter((item): item is string => typeof item === "string")
      : [],
  );
};

export const trackerDisplayState = (
  document: TrackerDocument,
  tracker: LocalTracker,
  active: ReadonlySet<string>,
): TrackerDisplayState => {
  if (document.status === "completed") return "done";
  if (document.status === "cancelled") return "cancelled";
  if (document.type === "spec") return "spec";
  if (active.has(document.id)) return "running";
  return document.blockedBy.some(
    (id) =>
      tracker.tasks.find((candidate) => candidate.id === id)?.status !==
      "completed",
  )
    ? "blocked"
    : "ready";
};

export const trackerStatusPrefix = (state: TrackerDisplayState): string =>
  state === "cancelled" ? "" : STATUS_PREFIX[state];
