import { join } from "node:path";

import { loadConfig } from "./config.js";
import {
  listAllOpenIssueNumbers,
  listOpenIssues,
  nativeBlockers,
  repoInfo,
} from "./github.js";
import { selectRunnableIssues, type GithubIssue } from "./issues.js";
import {
  loadLocalTracker,
  runnableLocalTasks,
  type TrackerDocument,
} from "./local-tracker.js";
import { runLfi } from "./run-workflow.js";
import { LFI_TASK_LABEL } from "./tracker-contract.js";

const localIssue = (
  task: TrackerDocument,
  blockedBy: readonly string[] = [],
): GithubIssue => ({
  id: task.id,
  number: task.number,
  title: task.title,
  url: task.path,
  body: task.body,
  labels: [LFI_TASK_LABEL],
  ...(blockedBy.length > 0 ? { blockedBy: [...blockedBy] } : {}),
});

export const dryRun = async (
  cwd: string,
  selectedIds: readonly string[] = [],
): Promise<{ runnable: GithubIssue[]; blocked: GithubIssue[] }> => {
  const config = await loadConfig(join(cwd, ".lfi", "config.env"));
  if (config.TASK_SOURCE === "local") {
    const tracker = await loadLocalTracker(join(cwd, ".lfi"));
    const plan = runnableLocalTasks(tracker, selectedIds);
    return {
      runnable: plan.runnable.map((task) => localIssue(task)),
      blocked: plan.blocked.map((task) =>
        localIssue(
          task,
          task.blockedBy.filter(
            (id) =>
              tracker.tasks.find((candidate) => candidate.id === id)?.status !==
              "completed",
          ),
        ),
      ),
    };
  }
  const repository = await repoInfo(cwd);
  const [issues, allOpen] = await Promise.all([
    listOpenIssues(cwd, LFI_TASK_LABEL),
    listAllOpenIssueNumbers(cwd),
  ]);
  const blockers = await nativeBlockers(
    cwd,
    repository.nameWithOwner,
    issues.map((issue) => issue.number),
  );
  const runnable = selectRunnableIssues(issues, allOpen, {
    nativeBlockers: blockers,
  });
  const selected = new Set(selectedIds);
  const filtered =
    selected.size === 0
      ? runnable
      : runnable.filter((issue) => selected.has(String(issue.number)));
  const runnableNumbers = new Set(filtered.map((issue) => issue.number));
  return {
    runnable: filtered,
    blocked: issues.filter((issue) => !runnableNumbers.has(issue.number)),
  };
};

export { runLfi };
