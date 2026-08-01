import assert from "node:assert/strict";
import test from "node:test";

import { evaluateWorkerResult } from "../src/worker-result.js";

test("accepts a worker only after structured completion and a clean committed branch", () => {
  assert.equal(
    evaluateWorkerResult({
      processExitCode: 0,
      status: "completed",
      commitsAhead: 2,
      worktreeClean: true,
    }).accepted,
    true,
  );

  for (const candidate of [
    { processExitCode: 1, status: "completed" as const, commitsAhead: 2, worktreeClean: true },
    { processExitCode: 0, status: "incomplete" as const, commitsAhead: 2, worktreeClean: true },
    { processExitCode: 0, status: "completed" as const, commitsAhead: 0, worktreeClean: true },
    { processExitCode: 0, status: "completed" as const, commitsAhead: 2, worktreeClean: false },
  ]) {
    assert.equal(evaluateWorkerResult(candidate).accepted, false);
  }
});
