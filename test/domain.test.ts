import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBlockedBy,
  selectRunnableIssues,
  type GithubIssue,
} from "../src/issues.js";
import { evaluateWorkerResult } from "../src/worker-result.js";

const issue = (
  number: number,
  labels: string[],
  body = "",
): GithubIssue => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.test/issues/${number}`,
  labels,
  body,
});

test("selects only lfi tasks whose blockers are closed", () => {
  const issues = [
    issue(1, ["lfi:task"]),
    issue(2, ["lfi:task"], "## Blocked by\n\n- #1"),
    issue(3, ["lfi:spec"]),
    issue(4, ["ready-for-agent"]),
    issue(5, ["lfi:task", "lfi:spec"]),
  ];

  assert.deepEqual(
    selectRunnableIssues(issues, new Set([1, 2, 3, 4, 5])).map(
      (item) => item.number,
    ),
    [1],
  );
  assert.deepEqual(parseBlockedBy(issues[1]!.body), [1]);
});

test("does not treat references outside the Blocked by section as blockers", () => {
  const body = "## Parent\n\n#42\n\n## Blocked by\n\nNone — can start immediately.";
  assert.deepEqual(parseBlockedBy(body), []);
});

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
