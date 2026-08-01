import { join } from "node:path";

import {
  runnableLocalTasks,
  type TrackerDocument,
} from "./local-tracker.js";
import { loadReconciledLocalTracker } from "./tracker-files.js";
import type { WorkItem } from "./runner-types.js";
import { readActiveTaskIds } from "./tracker-state.js";

export const trackerDocumentToWorkItem = (
  task: TrackerDocument,
  blockedBy: readonly string[] = [],
): WorkItem => ({
  id: task.id,
  number: task.number,
  title: task.title,
  sourcePath: task.path,
  body: task.body,
  ...(blockedBy.length > 0 ? { blockedBy: [...blockedBy] } : {}),
  ...(task.executionTier === undefined
    ? {}
    : { executionTier: task.executionTier }),
});

export const listWork = async (
  cwd: string,
  completed: ReadonlySet<string>,
  selectedIds: readonly string[],
): Promise<WorkItem[]> => {
  const lfiRoot = join(cwd, ".lfi");
  const tracker = await loadReconciledLocalTracker(
    join(cwd, ".scratch"),
    await readActiveTaskIds(lfiRoot),
  );
  return runnableLocalTasks(tracker, selectedIds).runnable
    .filter((task) => !completed.has(task.id))
    .map((task) => trackerDocumentToWorkItem(task));
};
