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

test("selects only open ready issues whose blockers are closed", () => {
  const issues = [
    issue(1, ["ready-for-agent"]),
    issue(2, ["ready-for-agent"], "## Blocked by\n\n- #1"),
    issue(3, ["ready-for-agent", "blocked"]),
    issue(4, ["needs-info"]),
  ];

  assert.deepEqual(
    selectRunnableIssues(issues, new Set([1, 2, 3, 4])).map((item) => item.number),
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
