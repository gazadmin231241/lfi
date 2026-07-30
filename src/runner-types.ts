import type { GithubIssue } from "./issues.js";
import type { ExecutionTier } from "./execution-tier.js";

export interface WorkItem extends GithubIssue {
  id: string;
  executionTier?: ExecutionTier;
  executionTierConflict?: string[];
  localPath?: string;
}

export interface Attempt {
  issue: WorkItem;
  accepted: boolean;
  summary: string;
  worktreePath: string;
  branch: string;
  logName?: string;
  unavailableModel?: string;
}
