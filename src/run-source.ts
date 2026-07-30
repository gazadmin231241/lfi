import { join } from "node:path";

import { loadConfig } from "./config.js";
import {
  listAllOpenIssueNumbers,
  listOpenIssues,
  nativeBlockers,
  repoInfo,
} from "./github.js";
import { selectRunnableIssues } from "./issues.js";
import { loadLocalTracker, runnableLocalTasks } from "./local-tracker.js";
import type { WorkItem } from "./runner-types.js";

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
        labels: ["ready-for-agent"],
        localPath: task.path,
      }));
  }
  const repository = await repoInfo(cwd);
  const [issues, allOpen] = await Promise.all([
    listOpenIssues(cwd, config.ISSUE_LABEL),
    listAllOpenIssueNumbers(cwd),
  ]);
  const blockers = await nativeBlockers(
    cwd,
    repository.nameWithOwner,
    issues.map((issue) => issue.number),
  );
  const selected = new Set(selectedIds);
  return selectRunnableIssues(issues, allOpen, {
    includeLabel: config.ISSUE_LABEL,
    excludeLabels: config.EXCLUDE_LABELS.split(",").map((label) => label.trim()),
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
