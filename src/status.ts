import { join } from "node:path";

import {
  loadLocalTracker,
  type LocalTracker,
} from "./local-tracker.js";
import { localize, type Language } from "./i18n.js";
import {
  readActiveTaskIds,
  trackerDisplayState,
  trackerStatusPrefix,
} from "./tracker-state.js";

export type StatusFilter = "ready" | "blocked" | "completed";

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
    tracker.tasks.map((task) => [
      task.id,
      trackerDisplayState(task, tracker, active),
    ]),
  );
  const activeTasks = tracker.tasks.filter((task) => {
    const state = states.get(task.id);
    return state !== "done" && state !== "cancelled";
  });
  const completed = tracker.tasks
    .filter((task) => states.get(task.id) === "done")
    .sort(
      (a, b) =>
        Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? "") ||
        b.number - a.number,
    );
  const cancelled = tracker.tasks.filter(
    (task) => states.get(task.id) === "cancelled",
  );
  const visibleTasks = options.all
    ? [...activeTasks, ...completed, ...cancelled]
    : [...activeTasks, ...completed.slice(0, 10)];
  const visible = [...tracker.specs, ...visibleTasks];
  return visible
    .filter((document) => {
      const state =
        document.type === "spec"
          ? trackerDisplayState(document, tracker, active)
          : states.get(document.id);
      return (
        !options.filter ||
        (options.filter === "completed" && state === "done") ||
        state === options.filter ||
        (options.filter === "ready" && state === "running")
      );
    })
    .map((task) => {
      const state = trackerDisplayState(task, tracker, active);
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
      const marker = trackerStatusPrefix(state);
      const prefix = marker ? `${marker} ` : "";
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
    await readActiveTaskIds(lfiRoot),
    options,
  );
};
