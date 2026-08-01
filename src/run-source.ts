import { join } from "node:path";

import { runnableLocalTasks } from "./local-tracker.js";
import { loadReconciledLocalTracker } from "./tracker-files.js";
import type { WorkItem } from "./runner-types.js";
import { readActiveTaskIds } from "./tracker-state.js";

export const listWork = async (
  cwd: string,
  completed: ReadonlySet<string>,
  selectedIds: readonly string[],
): Promise<WorkItem[]> => {
  const lfiRoot = join(cwd, ".lfi");
  const tracker = await loadReconciledLocalTracker(
    lfiRoot,
    await readActiveTaskIds(lfiRoot),
  );
  return runnableLocalTasks(tracker, selectedIds).runnable
    .filter((task) => !completed.has(task.id))
    .map((task) => ({
      id: task.id,
      number: task.number,
      title: task.title,
      url: task.id,
      body: task.body,
      ...(task.executionTier === undefined
        ? {}
        : { executionTier: task.executionTier }),
      localPath: task.path,
    }));
};
