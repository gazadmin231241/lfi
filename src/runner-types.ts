import type { GithubIssue } from "./issues.js";

export interface WorkItem extends GithubIssue {
  id: string;
  localPath?: string;
}

export interface Attempt {
  issue: WorkItem;
  accepted: boolean;
  summary: string;
  worktreePath: string;
  branch: string;
  logName?: string;
}
