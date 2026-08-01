import { join } from "node:path";

import { mapConcurrent } from "./concurrency.js";
import { loadConfig } from "./config.js";
import {
  executionTierFromLabels,
} from "./execution-tier.js";
import {
  listAllOpenIssueNumbers,
  listOpenIssues,
  nativeBlockers,
  repoInfo,
  setIssueStatus,
} from "./github.js";
import {
  githubTaskState,
  selectRunnableIssues,
} from "./issues.js";
import { runnableLocalTasks } from "./local-tracker.js";
import type { WorkItem } from "./runner-types.js";
import {
  LFI_SPEC_LABEL,
  LFI_TASK_LABEL,
} from "./tracker-contract.js";
import { readActiveTaskIds } from "./tracker-state.js";
import { loadReconciledLocalTracker } from "./tracker-files.js";

export const listWork = async (
  cwd: string,
  completed: ReadonlySet<string>,
  selectedIds: readonly string[],
): Promise<WorkItem[]> => {
  const config = await loadConfig(join(cwd, ".lfi", "config.env"));
  if (config.TASK_SOURCE === "local") {
    const lfiRoot = join(cwd, ".lfi");
    const tracker = await loadReconciledLocalTracker(
      lfiRoot,
      await readActiveTaskIds(lfiRoot),
    );
    const plan = runnableLocalTasks(tracker, selectedIds);
    return plan.runnable
      .filter((task) => !completed.has(task.id))
      .map((task) => ({
        id: task.id,
        number: task.number,
        title: task.title,
        url: task.id,
        body: task.body,
        labels: [LFI_TASK_LABEL],
        ...(task.executionTier === undefined
          ? {}
          : { executionTier: task.executionTier }),
        localPath: task.path,
      }));
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
  const selected = new Set(selectedIds);
  await mapConcurrent(
    issues.filter(
      (issue) =>
        !issue.labels.includes(LFI_SPEC_LABEL) &&
        !completed.has(`#${issue.number}`),
    ),
    3,
    (issue) =>
      setIssueStatus(
        cwd,
        issue.number,
        githubTaskState(issue, allOpen, blockers),
        issue.title,
      ),
  );
  return selectRunnableIssues(issues, allOpen, {
    nativeBlockers: blockers,
  })
    .map((issue): WorkItem => {
      const selection = executionTierFromLabels(issue.labels);
      return {
        ...issue,
        id: `#${issue.number}`,
        ...(selection.status === "resolved"
          ? { executionTier: selection.tier }
          : {}),
        ...(selection.status === "conflict"
          ? { executionTierConflict: selection.labels }
          : {}),
      };
    })
    .filter(
      (issue) =>
        !completed.has(issue.id) &&
        (selected.size === 0 ||
          selected.has(issue.id) ||
          selected.has(String(issue.number))),
    );
};
