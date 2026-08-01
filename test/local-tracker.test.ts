import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadLocalTracker,
  nextLfiId,
  nextRepositoryLfiId,
  parseTrackerDocument,
  serializeTrackerDocument,
  type TrackerDocument,
} from "../src/local-tracker.js";
import {
  withLocalRelationships,
  withoutLocalRelationships,
} from "../src/local-relationships.js";
import { runCommand } from "../src/process.js";
import { formatLocalStatus } from "../src/status.js";
import {
  loadReconciledLocalTracker,
  reconcileTrackerFilenames,
} from "../src/tracker-files.js";

const document = (
  id: number,
  type: TrackerDocument["type"],
  title: string,
  path: string,
  options: {
    blockedBy?: string[];
    body?: string;
    executionTier?: "light" | "standard" | "deep";
    spec?: string;
    status?: TrackerDocument["status"];
  } = {},
): TrackerDocument => ({
  id: `LFI-${id}`,
  number: id,
  type,
  title,
  status: options.status ?? "ready",
  ...(options.executionTier === undefined
    ? {}
    : { executionTier: options.executionTier }),
  ...(options.spec === undefined ? {} : { spec: options.spec }),
  blockedBy: options.blockedBy ?? [],
  body: options.body ?? "Document.\n",
  path,
});

test("tracker documents round-trip plain marker lines", () => {
  const path = "[READY] LFI-15 — implement-task-parser.md";
  const source = "Type: task\nBlocked by: LFI-12\nTier: deep\n\n## What to build\n\nParse a task.\n";
  const parsed = parseTrackerDocument(source, path);
  assert.deepEqual(parsed, {
    id: "LFI-15",
    number: 15,
    type: "task",
    title: "Implement task parser",
    status: "ready",
    executionTier: "deep",
    blockedBy: ["LFI-12"],
    body: "## What to build\n\nParse a task.\n",
    path,
  });
  const serialized = serializeTrackerDocument(parsed);
  assert.doesNotMatch(serialized, /^---$/mu);
  assert.deepEqual(parseTrackerDocument(serialized, path), parsed);
});

test("task rendering keeps readable relationships outside marker lines", () => {
  const spec = document(14, "spec", "Local first", "[SPEC] LFI-14 — local-first.md");
  const blocker = document(12, "task", "Prerequisite", "[DONE] LFI-12 — prerequisite.md", {
    status: "completed",
  });
  const task = document(15, "task", "Implement parser", "[READY] LFI-15 — implement-parser.md", {
    blockedBy: ["LFI-12"],
    body: "## What to build\n\nParse a task.\n",
    executionTier: "deep",
    spec: "LFI-14",
  });
  const rendered = withLocalRelationships(task, {
    documents: [spec, blocker, task],
    tasks: [blocker, task],
    specs: [spec],
  });

  assert.match(rendered, /^> \*\*Task complexity:\*\* `deep`/u);
  assert.match(rendered, /## Specification[\s\S]*LFI-14/u);
  assert.match(rendered, /## Blocked by[\s\S]*LFI-12/u);
  assert.equal(withoutLocalRelationships(rendered), "## What to build\n\nParse a task.");
});

test("tracker validates blockers and cycles and shares one ID sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-tracker-"));
  const tasks = join(root, "tasks");
  await mkdir(tasks, { recursive: true });
  const donePath = join(tasks, "[DONE] LFI-12 — prerequisite.md");
  const taskPath = join(tasks, "[READY] LFI-15 — parser.md");
  await writeFile(donePath, serializeTrackerDocument(document(12, "task", "Prerequisite", donePath, {
    status: "completed",
  })));
  await writeFile(taskPath, serializeTrackerDocument(document(15, "task", "Parser", taskPath, {
    blockedBy: ["LFI-12"],
  })));

  const tracker = await loadLocalTracker(root);
  assert.equal(nextLfiId(tracker.documents), "LFI-16");

  await writeFile(donePath, serializeTrackerDocument(document(12, "task", "Prerequisite", donePath, {
    blockedBy: ["LFI-15"],
    status: "completed",
  })));
  await assert.rejects(loadLocalTracker(root), /cycle/u);
});

test("repository ID allocation includes a canonical filename found only in history", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-id-history-"));
  const tasks = join(root, ".lfi", "tasks");
  await mkdir(tasks, { recursive: true });
  const path = join(tasks, "[DONE] LFI-9 — deleted.md");
  await writeFile(path, "Type: task\nBlocked by: None\n\nDeleted.\n");
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await git("add", ".");
  await git("commit", "-m", "docs: add task");
  await rm(path);
  await git("add", "-u");
  await git("commit", "-m", "docs: remove task");

  assert.equal(await nextRepositoryLfiId(root, []), "LFI-10");
});

test("status comes from filename and reconciliation keeps status prefixes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-status-filenames-"));
  const feature = join(root, "tasks", "feature");
  const tasks = join(feature, "tasks");
  await mkdir(tasks, { recursive: true });
  const specPath = join(feature, "[SPEC] LFI-1 — feature.md");
  const firstPath = join(tasks, "[READY] LFI-2 — first-task.md");
  const secondPath = join(tasks, "[READY] LFI-3 — second-task.md");
  await writeFile(specPath, serializeTrackerDocument(document(1, "spec", "Feature", specPath)));
  await writeFile(firstPath, serializeTrackerDocument(document(2, "task", "First task", firstPath, {
    spec: "LFI-1",
  })));
  await writeFile(secondPath, serializeTrackerDocument(document(3, "task", "Second task", secondPath, {
    blockedBy: ["LFI-2"],
    spec: "LFI-1",
  })));

  const tracker = await loadLocalTracker(root);
  assert.equal(tracker.tasks[0]?.status, "ready");
  await reconcileTrackerFilenames(tracker, new Set(["LFI-2"]));
  assert.deepEqual((await readdir(tasks)).sort(), [
    "[BLOCKED] LFI-3 — second-task.md",
    "[RUNNING] LFI-2 — first-task.md",
  ]);
  const reloaded = await loadLocalTracker(root);
  assert.equal(reloaded.tasks.find((task) => task.id === "LFI-2")?.status, "ready");
});

test("feature placement supplies the specification relationship", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-feature-placement-"));
  const feature = join(root, "tasks", "feature");
  const tasks = join(feature, "tasks");
  await mkdir(tasks, { recursive: true });
  await writeFile(join(feature, "diagram.png"), "not an image");
  await writeFile(join(feature, "[SPEC] LFI-1 — feature.md"), "Type: spec\nBlocked by: None\n\nFeature.\n");
  await writeFile(join(tasks, "[READY] LFI-2 — task.md"), "Type: task\nBlocked by: None\nTier: standard\n\nTask.\n");

  const tracker = await loadLocalTracker(root);
  assert.equal(tracker.tasks[0]?.spec, "LFI-1");
  await rm(join(feature, "[SPEC] LFI-1 — feature.md"));
  await assert.rejects(loadLocalTracker(root), /exactly one specification/u);
});

test("reconciliation follows a specification title change", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-layout-change-"));
  const feature = join(root, "tasks", "feature");
  const tasks = join(feature, "tasks");
  await mkdir(tasks, { recursive: true });
  const specPath = join(feature, "[SPEC] LFI-1 — feature.md");
  const taskPath = join(tasks, "[READY] LFI-2 — task.md");
  await writeFile(specPath, serializeTrackerDocument(document(1, "spec", "Feature", specPath)));
  await writeFile(taskPath, serializeTrackerDocument(document(2, "task", "Task", taskPath, {
    spec: "LFI-1",
  })));

  const tracker = await loadLocalTracker(root);
  tracker.specs[0]!.title = "Renamed feature";
  await reconcileTrackerFilenames(tracker, new Set());
  const reconciled = await loadReconciledLocalTracker(root);
  assert.equal(reconciled.specs[0]?.title, "Renamed feature");
  assert.match(reconciled.tasks[0]?.path ?? "", /renamed-feature\/tasks/u);
  assert.match(await readFile(reconciled.tasks[0]!.path, "utf8"), /LFI-1 — Renamed feature/u);
});

test("status output groups features and localizes blockers", () => {
  const spec = document(1, "spec", "Feature", "[SPEC] LFI-1 — feature.md");
  const blocker = document(2, "task", "Blocker", "[READY] LFI-2 — blocker.md", {
    spec: "LFI-1",
  });
  const blocked = document(3, "task", "Blocked", "[BLOCKED] LFI-3 — blocked.md", {
    blockedBy: ["LFI-2"],
    spec: "LFI-1",
  });
  const done = document(4, "task", "Done", "[DONE] LFI-4 — done.md", {
    spec: "LFI-1",
    status: "completed",
  });
  const tracker = {
    documents: [spec, blocker, blocked, done],
    tasks: [blocker, blocked, done],
    specs: [spec],
  };

  assert.deepEqual(formatLocalStatus(tracker, new Set(), { language: "ru" }), [
    "Функция: LFI-1 — Feature",
    "[SPEC] LFI-1 — Feature",
    "[READY] LFI-2 — Blocker",
    "[BLOCKED] LFI-3 — Blocked · заблокирована задачами LFI-2",
    "[DONE] LFI-4 — Done",
  ]);
});
