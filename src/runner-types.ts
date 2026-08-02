import type { ExecutionTier } from "./execution-tier.js";
import type { AgentModel } from "./config.js";

export interface WorkItem {
  id: string;
  number: number;
  title: string;
  sourcePath: string;
  body: string;
  blockedBy?: string[];
  executionTier?: ExecutionTier;
}

export interface Attempt {
  task: WorkItem;
  accepted: boolean;
  summary: string;
  worktreePath: string;
  branch: string;
  logName?: string;
  unavailableModel?: AgentModel;
}
