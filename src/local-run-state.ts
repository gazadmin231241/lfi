import { join } from "node:path";

import {
  saveTrackerDocument,
} from "./local-tracker.js";
import { configureLocalTrackerStorage } from "./local-setup.js";
import type { Attempt } from "./runner-types.js";
import { checkpointTracker } from "./runner-support.js";
import {
  loadReconciledLocalTracker,
  reconcileTrackerFilenames,
} from "./tracker-files.js";

const completeChecklist = (body: string): string =>
  body.replace(
    /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[ \t]\]/gmu,
    "$1[x]",
  );

export const localCompletionCommitSubject = (
  taskIds: readonly string[],
): string => `chore(lfi): complete ${taskIds.join(", ")}`;

export const isCompletedLocalTaskPath = (
  path: string,
  taskId: string,
): boolean => path.includes(`/[DONE] ${taskId} — `);

export const recordLocalCompletion = async (
  cwd: string,
  attempts: readonly Attempt[],
): Promise<void> => {
  await configureLocalTrackerStorage(cwd);
  const tracker = await loadReconciledLocalTracker(join(cwd, ".lfi"));
  const completed = new Set(attempts.map((attempt) => attempt.task.id));
  for (const task of tracker.tasks) {
    if (completed.has(task.id)) {
      task.status = "completed";
      task.body = completeChecklist(task.body);
      await saveTrackerDocument(task);
    }
  }
  await reconcileTrackerFilenames(tracker, new Set());
  await checkpointTracker(
    cwd,
    localCompletionCommitSubject([...completed]),
  );
};
