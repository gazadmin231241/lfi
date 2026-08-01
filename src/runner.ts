import { join } from "node:path";

import {
  runnableLocalTasks,
  type TrackerDocument,
} from "./local-tracker.js";
import { runLfi } from "./run-workflow.js";
import type { WorkItem } from "./runner-types.js";
import { loadReconciledLocalTracker } from "./tracker-files.js";

const localWorkItem = (
  task: TrackerDocument,
  blockedBy: readonly string[] = [],
): WorkItem => ({
  id: task.id,
  number: task.number,
  title: task.title,
  url: task.path,
  body: task.body,
  ...(blockedBy.length > 0 ? { blockedBy: [...blockedBy] } : {}),
});

export const dryRun = async (
  cwd: string,
  selectedIds: readonly string[] = [],
): Promise<{ runnable: WorkItem[]; blocked: WorkItem[] }> => {
  const tracker = await loadReconciledLocalTracker(join(cwd, ".lfi"));
  const plan = runnableLocalTasks(tracker, selectedIds);
  return {
    runnable: plan.runnable.map((task) => localWorkItem(task)),
    blocked: plan.blocked.map((task) =>
      localWorkItem(
        task,
        task.blockedBy.filter(
          (id) =>
            tracker.tasks.find((candidate) => candidate.id === id)?.status !==
            "completed",
        ),
      ),
    ),
  };
};

export { runLfi };
