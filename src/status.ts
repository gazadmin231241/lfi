import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  loadLocalTracker,
  type LocalTracker,
  type TrackerDocument,
} from "./local-tracker.js";
import { localize, type Language } from "./i18n.js";

export type StatusFilter = "ready" | "blocked" | "completed";

const activeIds = async (lfiRoot: string): Promise<Set<string>> => {
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

const taskState = (
  task: TrackerDocument,
  tracker: LocalTracker,
  active: ReadonlySet<string>,
): StatusFilter | "in-progress" | "cancelled" => {
  if (task.status === "completed") return "completed";
  if (task.status === "cancelled") return "cancelled";
  if (active.has(task.id)) return "in-progress";
  return task.blockedBy.some(
    (id) =>
      tracker.tasks.find((candidate) => candidate.id === id)?.status !==
      "completed",
  )
    ? "blocked"
    : "ready";
};

export const formatLocalStatus = (
  tracker: LocalTracker,
  active: ReadonlySet<string>,
  options: {
    all?: boolean;
    filter?: StatusFilter;
    language?: Language;
  } = {},
): string[] => {
  const states = new Map(
    tracker.tasks.map((task) => [task.id, taskState(task, tracker, active)]),
  );
  const activeTasks = tracker.tasks.filter((task) => {
    const state = states.get(task.id);
    return state !== "completed" && state !== "cancelled";
  });
  const completed = tracker.tasks
    .filter((task) => states.get(task.id) === "completed")
    .sort(
      (a, b) =>
        Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? "") ||
        b.number - a.number,
    );
  const cancelled = tracker.tasks.filter(
    (task) => states.get(task.id) === "cancelled",
  );
  const visible = options.all
    ? [...activeTasks, ...completed, ...cancelled]
    : [...activeTasks, ...completed.slice(0, 10)];
  const marker = {
    ready: "🟢",
    "in-progress": "🔵",
    blocked: "⛔",
    completed: "✅",
    cancelled: "",
  } as const;
  return visible
    .filter((task) => {
      const state = states.get(task.id);
      return (
        !options.filter ||
        state === options.filter ||
        (options.filter === "ready" && state === "in-progress")
      );
    })
    .map((task) => {
      const state = states.get(task.id)!;
      const blockers =
        state === "blocked"
          ? ` · ${localize(
              options.language ?? "en",
              "blocked by",
              "заблокирована задачами",
            )} ${task.blockedBy
              .filter(
                (id) =>
                  tracker.tasks.find((item) => item.id === id)?.status !==
                  "completed",
              )
              .join(", ")}`
          : "";
      const cancelledSuffix =
        state === "cancelled"
          ? localize(
              options.language ?? "en",
              " · cancelled",
              " · отменена",
            )
          : "";
      const prefix = marker[state] ? `${marker[state]} ` : "";
      return `${prefix}${task.id} — ${task.title}${blockers}${cancelledSuffix}`;
    });
};

export const localStatusLines = async (
  cwd: string,
  options: {
    all?: boolean;
    filter?: StatusFilter;
    language?: Language;
  } = {},
): Promise<string[]> => {
  const lfiRoot = join(cwd, ".lfi");
  return formatLocalStatus(
    await loadLocalTracker(lfiRoot),
    await activeIds(lfiRoot),
    options,
  );
};
