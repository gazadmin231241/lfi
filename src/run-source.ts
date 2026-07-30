import { join } from "node:path";

import { mapConcurrent } from "./concurrency.js";
import { loadConfig } from "./config.js";
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
import { loadLocalTracker, runnableLocalTasks } from "./local-tracker.js";
import type { WorkItem } from "./runner-types.js";
import {
  LFI_SPEC_LABEL,
  LFI_TASK_LABEL,
} from "./tracker-contract.js";

export const listWork = async (
  cwd: string,
  completed: ReadonlySet<string>,
  selectedIds: readonly string[],
): Promise<WorkItem[]> => {
  const config = await loadConfig(join(cwd, ".lfi", "config.env"));
  if (config.TASK_SOURCE === "local") {
    const plan = runnableLocalTasks(
      await loadLocalTracker(join(cwd, ".lfi")),
      selectedIds,
    );
    return plan.runnable
      .filter((task) => !completed.has(task.id))
      .map((task) => ({
        id: task.id,
        number: task.number,
        title: task.title,
        url: task.path,
        body: task.body,
        labels: [LFI_TASK_LABEL],
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
    .map((issue): WorkItem => ({ ...issue, id: `#${issue.number}` }))
    .filter(
      (issue) =>
        !completed.has(issue.id) &&
        (selected.size === 0 ||
          selected.has(issue.id) ||
          selected.has(String(issue.number))),
    );
};
