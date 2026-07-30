import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  loadLocalTracker,
  type LocalTracker,
  type TrackerDocument,
} from "./local-tracker.js";

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
  options: { all?: boolean; filter?: StatusFilter } = {},
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
    .sort((a, b) => b.number - a.number);
  const visible = options.all
    ? [...activeTasks, ...completed]
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
          ? ` · blocked by ${task.blockedBy
              .filter(
                (id) =>
                  tracker.tasks.find((item) => item.id === id)?.status !==
                  "completed",
              )
              .join(", ")}`
          : "";
      return `${marker[state]} ${task.id} — ${task.title}${blockers}`;
    });
};

export const localStatusLines = async (
  cwd: string,
  options: { all?: boolean; filter?: StatusFilter } = {},
): Promise<string[]> => {
  const lfiRoot = join(cwd, ".lfi");
  return formatLocalStatus(
    await loadLocalTracker(lfiRoot),
    await activeIds(lfiRoot),
    options,
  );
};
