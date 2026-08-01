import { join } from "node:path";

import {
  type LocalTracker,
} from "./local-tracker.js";
import { configureLocalTrackerStorage } from "./local-setup.js";
import { localize, type Language } from "./i18n.js";
import {
  readActiveTaskIds,
  trackerDisplayState,
  trackerStatusPrefix,
} from "./tracker-state.js";
import { loadReconciledLocalTracker } from "./tracker-files.js";

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
    .sort((a, b) => b.number - a.number);
  const cancelled = tracker.tasks.filter(
    (task) => states.get(task.id) === "cancelled",
  );
  const visibleTasks = options.all
    ? [...activeTasks, ...completed, ...cancelled]
    : [...activeTasks, ...completed.slice(0, 10)];
  const specificationIds = new Set(
    tracker.specs.map((specification) => specification.id),
  );
  const isVisible = (document: LocalTracker["documents"][number]): boolean => {
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
    };
  const formatDocument = (task: LocalTracker["documents"][number]): string => {
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
    };
  const featureLines = tracker.specs.flatMap((specification) => {
    const documents = [
      specification,
      ...visibleTasks.filter((task) => task.spec === specification.id),
    ].filter(isVisible);
    if (documents.length === 0) return [];
    const heading = localize(
      options.language ?? "en",
      `Feature: ${specification.id} — ${specification.title}`,
      `Функция: ${specification.id} — ${specification.title}`,
    );
    return [heading, ...documents.map(formatDocument)];
  });
  const standaloneTasks = visibleTasks.filter(
    (task) =>
      (task.spec === undefined ||
        !specificationIds.has(task.spec)) &&
      isVisible(task),
  );
  if (standaloneTasks.length === 0) return featureLines;
  return [
    ...featureLines,
    localize(options.language ?? "en", "Standalone tasks", "Задачи без спецификации"),
    ...standaloneTasks.map(formatDocument),
  ];
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
  await configureLocalTrackerStorage(cwd);
  const active = await readActiveTaskIds(lfiRoot);
  const tracker = await loadReconciledLocalTracker(join(cwd, ".scratch"), active);
  return formatLocalStatus(tracker, active, options);
};
