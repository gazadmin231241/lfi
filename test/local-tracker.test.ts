import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadLocalTracker,
  nextLfiId,
  parseTrackerDocument,
  serializeTrackerDocument,
} from "../src/local-tracker.js";
import { formatLocalStatus } from "../src/status.js";

const taskSource = `---
id: LFI-15
type: task
title: Implement task parser
status: ready
spec: LFI-14
blocked_by:
  - LFI-12
github_issue: 362
---

## What to build

Parse a task.
`;

test("local tracker documents round-trip readable Markdown metadata", () => {
  const parsed = parseTrackerDocument(taskSource, "task.md");
  assert.deepEqual(parsed, {
    id: "LFI-15",
    number: 15,
    type: "task",
    title: "Implement task parser",
    status: "ready",
    spec: "LFI-14",
    blockedBy: ["LFI-12"],
    githubIssue: 362,
    body: "## What to build\n\nParse a task.\n",
    path: "task.md",
  });
  assert.equal(parseTrackerDocument(serializeTrackerDocument(parsed), "task.md").title, parsed.title);
});

test("local tracker validates references, cycles, and one shared ID sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-tracker-"));
  const tasks = join(root, "tasks");
  const specs = join(root, "specs");
  await mkdir(tasks);
  await mkdir(specs);
  await writeFile(
    join(specs, "LFI-14-local-first.md"),
    serializeTrackerDocument({
      id: "LFI-14",
      number: 14,
      type: "spec",
      title: "Local-first",
      status: "ready",
      blockedBy: [],
      body: "# Local-first\n",
      path: join(specs, "LFI-14-local-first.md"),
    }),
  );
  await writeFile(
    join(tasks, "LFI-15-parser.md"),
    taskSource.replace("  - LFI-12\n", ""),
  );

  const tracker = await loadLocalTracker(root);
  assert.equal(tracker.documents.length, 2);
  assert.equal(nextLfiId(tracker.documents), "LFI-16");

  await writeFile(
    join(tasks, "LFI-12-cycle.md"),
    taskSource
      .replace("id: LFI-15", "id: LFI-12")
      .replace("spec: LFI-14", "spec: LFI-14")
      .replace("- LFI-12", "- LFI-15")
      .replace("github_issue: 362\n", ""),
  );
  await writeFile(
    join(tasks, "LFI-15-parser.md"),
    taskSource.replace("github_issue: 362\n", ""),
  );
  await assert.rejects(loadLocalTracker(root), /cycle/u);
});

test("local status derives the four compact display markers", () => {
  const tasks = [
    parseTrackerDocument(
      taskSource.replace("github_issue: 362\n", "").replace("  - LFI-12\n", ""),
      "ready.md",
    ),
    parseTrackerDocument(
      taskSource
        .replaceAll("LFI-15", "LFI-16")
        .replace("status: ready", "status: completed")
        .replace("github_issue: 362\n", "")
        .replace("  - LFI-12\n", ""),
      "completed.md",
    ),
  ];
  const tracker = { documents: tasks, tasks, specs: [] };
  assert.deepEqual(formatLocalStatus(tracker, new Set(["LFI-15"])), [
    "🔵 LFI-15 — Implement task parser",
    "✅ LFI-16 — Implement task parser",
  ]);
});
