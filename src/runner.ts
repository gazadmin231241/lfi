import { join } from "node:path";

import { runnableLocalTasks } from "./local-tracker.js";
import { runLfi } from "./run-workflow.js";
import type { WorkItem } from "./runner-types.js";
import { trackerDocumentToWorkItem } from "./run-source.js";
import { loadReconciledLocalTracker } from "./tracker-files.js";

export const dryRun = async (
  cwd: string,
  selectedIds: readonly string[] = [],
): Promise<{ runnable: WorkItem[]; blocked: WorkItem[] }> => {
  const tracker = await loadReconciledLocalTracker(join(cwd, ".lfi"));
  const plan = runnableLocalTasks(tracker, selectedIds);
  return {
    runnable: plan.runnable.map((task) => trackerDocumentToWorkItem(task)),
    blocked: plan.blocked.map((task) =>
      trackerDocumentToWorkItem(
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
