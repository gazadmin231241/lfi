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

interface AttemptResult {
  task: WorkItem;
  summary: string;
  worktreePath: string;
  branch: string;
  logName?: string;
  /** The agent left uncommitted changes behind; the worktree is preserved. */
  dirtyWorktree?: boolean;
  unavailableModel?: AgentModel;
}

/** A task attempt with mutually exclusive delivery and recovery outcomes. */
export type Attempt = AttemptResult & (
  | { accepted: true; validationPending?: never }
  | { accepted: false; validationPending: true }
  | { accepted: false; validationPending?: never }
);
