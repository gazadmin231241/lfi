import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadLocalTracker,
  nextLfiId,
  nextRepositoryLfiId,
  parseTrackerDocument,
  serializeTrackerDocument,
} from "../src/local-tracker.js";
import { formatLocalStatus } from "../src/status.js";
import { runCommand } from "../src/process.js";

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

test("repository ID allocation does not reuse an ID after its file is deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-id-history-"));
  const taskDirectory = join(root, ".lfi", "tasks");
  await mkdir(taskDirectory, { recursive: true });
  const taskPath = join(taskDirectory, "LFI-9-deleted.md");
  await writeFile(
    taskPath,
    taskSource
      .replaceAll("LFI-15", "LFI-9")
      .replace("spec: LFI-14\n", "")
      .replace("  - LFI-12\n", "")
      .replace("github_issue: 362\n", ""),
  );
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await git("add", ".");
  await git("commit", "-m", "docs: add task");
  await rm(taskPath);
  await git("add", "-u");
  await git("commit", "-m", "docs: remove task");

  assert.equal(await nextRepositoryLfiId(root, []), "LFI-10");
});

test("tracker enforces informative filenames and completion timestamps", async () => {
  assert.throws(
    () =>
      parseTrackerDocument(
        taskSource.replace("status: ready", "status: completed"),
        "task.md",
      ),
    /completed_at/u,
  );
  const root = await mkdtemp(join(tmpdir(), "lfi-filename-"));
  await mkdir(join(root, "tasks"));
  await mkdir(join(root, "specs"));
  await writeFile(
    join(root, "tasks", "task.md"),
    taskSource
      .replace("spec: LFI-14\n", "")
      .replace("  - LFI-12\n", "")
      .replace("github_issue: 362\n", ""),
  );
  await assert.rejects(loadLocalTracker(root), /informative-slug/u);
});

test("local status derives explicit display prefixes", () => {
  const spec = parseTrackerDocument(
    taskSource
      .replace("type: task", "type: spec")
      .replaceAll("LFI-15", "LFI-14")
      .replace("spec: LFI-14\n", "")
      .replace("  - LFI-12\n", "")
      .replace("github_issue: 362\n", ""),
    "spec.md",
  );
  const tasks = [
    parseTrackerDocument(
      taskSource.replace("github_issue: 362\n", "").replace("  - LFI-12\n", ""),
      "ready.md",
    ),
    parseTrackerDocument(
      taskSource
        .replaceAll("LFI-15", "LFI-16")
        .replace("status: ready", "status: completed")
        .replace(
          "blocked_by:",
          "completed_at: 2026-01-01T00:00:00.000Z\nblocked_by:",
        )
        .replace("github_issue: 362\n", "")
        .replace("  - LFI-12\n", ""),
      "completed.md",
    ),
  ];
  const tracker = { documents: [spec, ...tasks], tasks, specs: [spec] };
  assert.deepEqual(formatLocalStatus(tracker, new Set(["LFI-15"])), [
    "[SPEC] LFI-14 — Implement task parser",
    "[RUNNING] LFI-15 — Implement task parser",
    "[DONE] LFI-16 — Implement task parser",
  ]);
});

test("local status orders completions by time and localizes blockers", () => {
  const blocked = parseTrackerDocument(
    taskSource.replace("github_issue: 362\n", ""),
    "blocked.md",
  );
  const older = parseTrackerDocument(
    taskSource
      .replaceAll("LFI-15", "LFI-20")
      .replace("status: ready", "status: completed")
      .replace("spec: LFI-14\n", "")
      .replace("  - LFI-12\n", "")
      .replace("github_issue: 362\n", "")
      .replace("blocked_by:", "completed_at: 2026-01-01T00:00:00.000Z\nblocked_by:"),
    "older.md",
  );
  const newer = parseTrackerDocument(
    serializeTrackerDocument({
      ...older,
      id: "LFI-2",
      number: 2,
      completedAt: "2026-02-01T00:00:00.000Z",
      path: "newer.md",
    }),
    "newer.md",
  );
  const { completedAt: _completedAt, ...blockerBase } = older;
  const blocker = {
    ...blockerBase,
    id: "LFI-12",
    number: 12,
    status: "ready" as const,
    path: "blocker.md",
  };
  const tasks = [blocked, older, newer, blocker];
  const tracker = { documents: tasks, tasks, specs: [] };
  const lines = formatLocalStatus(tracker, new Set(), {
    language: "ru",
  });
  assert.match(lines[0]!, /заблокирована задачами LFI-12/u);
  assert.ok(lines.indexOf("[DONE] LFI-2 — Implement task parser") <
    lines.indexOf("[DONE] LFI-20 — Implement task parser"));
});
