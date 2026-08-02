/**
 * Uncommitted changes are deliberately not part of this input: only committed
 * work can reach integration, so leftover changes in the worktree are a
 * warning to the operator, not grounds to reject commits the agent did make.
 */
export interface WorkerResultInput {
  processExitCode: number;
  status: "completed" | "incomplete" | undefined;
  commitsAhead: number;
}

export interface WorkerEvaluation {
  accepted: boolean;
  reasons: string[];
}

export const evaluateWorkerResult = (
  result: WorkerResultInput,
): WorkerEvaluation => {
  const reasons: string[] = [];
  if (result.processExitCode !== 0) reasons.push("agent_failed");
  if (result.status !== "completed") reasons.push("not_completed");
  if (result.commitsAhead < 1) reasons.push("no_commits");
  return { accepted: reasons.length === 0, reasons };
};
