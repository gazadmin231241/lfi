export interface WorkerResultInput {
  processExitCode: number;
  status: "completed" | "incomplete" | undefined;
  commitsAhead: number;
  worktreeClean: boolean;
}

export interface WorkerEvaluation {
  accepted: boolean;
  reasons: string[];
}

export const evaluateWorkerResult = (
  result: WorkerResultInput,
): WorkerEvaluation => {
  const reasons: string[] = [];
  if (result.processExitCode !== 0) reasons.push("codex_failed");
  if (result.status !== "completed") reasons.push("not_completed");
  if (result.commitsAhead < 1) reasons.push("no_commits");
  if (!result.worktreeClean) reasons.push("dirty_worktree");
  return { accepted: reasons.length === 0, reasons };
};
