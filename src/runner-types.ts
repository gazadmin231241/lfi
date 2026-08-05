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
  /** The agent left uncommitted changes behind; the worktree is preserved. */
  dirtyWorktree?: boolean;
  /** Implementation and review passed, but validation recovery is exhausted. */
  validationPending?: boolean;
  unavailableModel?: AgentModel;
}
