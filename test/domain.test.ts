import assert from "node:assert/strict";
import test from "node:test";

import { evaluateWorkerResult } from "../src/worker-result.js";

test("accepts a worker only after declared completion and a committed branch", () => {
  assert.equal(
    evaluateWorkerResult({
      processExitCode: 0,
      status: "completed",
      commitsAhead: 2,
    }).accepted,
    true,
  );

  for (const candidate of [
    { processExitCode: 1, status: "completed" as const, commitsAhead: 2 },
    { processExitCode: 0, status: "incomplete" as const, commitsAhead: 2 },
    { processExitCode: 0, status: undefined, commitsAhead: 2 },
    { processExitCode: 0, status: "completed" as const, commitsAhead: 0 },
  ]) {
    assert.equal(evaluateWorkerResult(candidate).accepted, false);
  }
});

test("reports an agent-neutral reason when the configured provider exits unsuccessfully", () => {
  assert.deepEqual(
    evaluateWorkerResult({
      processExitCode: 1,
      status: "completed",
      commitsAhead: 2,
    }).reasons,
    ["agent_failed"],
  );
});
