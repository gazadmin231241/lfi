import { join } from "node:path";

import {
  loadLocalTracker,
  saveTrackerDocument,
} from "./local-tracker.js";
import { configureLocalTrackerStorage } from "./local-setup.js";
import type { Attempt } from "./runner-types.js";
import { checkpointTracker } from "./runner-support.js";
import { reconcileTrackerFilenames } from "./tracker-files.js";

const completeChecklist = (body: string): string =>
  body.replace(
    /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[ \t]\]/gmu,
    "$1[x]",
  );

export const recordLocalCompletion = async (
  cwd: string,
  attempts: readonly Attempt[],
): Promise<void> => {
  await configureLocalTrackerStorage(cwd);
  const tracker = await loadLocalTracker(join(cwd, ".lfi"));
  const completed = new Set(attempts.map((attempt) => attempt.issue.id));
  const completedAt = new Date().toISOString();
  for (const task of tracker.tasks) {
    if (completed.has(task.id)) {
      await saveTrackerDocument({
        ...task,
        status: "completed",
        completedAt,
        body: completeChecklist(task.body),
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
