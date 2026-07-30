import { join } from "node:path";

import {
  loadLocalTracker,
  saveTrackerDocument,
} from "./local-tracker.js";
import type { Attempt } from "./runner-types.js";
import { checkpointTracker } from "./runner-support.js";
import { reconcileTrackerFilenames } from "./tracker-files.js";

export const recordLocalCompletion = async (
  cwd: string,
  attempts: readonly Attempt[],
): Promise<void> => {
  const tracker = await loadLocalTracker(join(cwd, ".lfi"));
  const completed = new Set(attempts.map((attempt) => attempt.issue.id));
  const completedAt = new Date().toISOString();
  for (const task of tracker.tasks) {
    if (completed.has(task.id)) {
      await saveTrackerDocument({
        ...task,
        status: "completed",
        completedAt,
      });
    }
  }
  await reconcileTrackerFilenames(
    await loadLocalTracker(join(cwd, ".lfi")),
    new Set(),
  );
  await checkpointTracker(
    cwd,
    `chore(lfi): complete ${[...completed].join(", ")}`,
  );
};
