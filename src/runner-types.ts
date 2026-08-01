import type { ExecutionTier } from "./execution-tier.js";

export interface WorkItem {
  id: string;
  number: number;
  title: string;
  url: string;
  body: string;
  blockedBy?: string[];
  executionTier?: ExecutionTier;
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
