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

import { loadLocalTracker, nextLfiId, nextRepositoryLfiId, parseTrackerDocument, serializeTrackerDocument } from "../src/local-tracker.js";
import { formatLocalStatus } from "../src/status.js";
import { runCommand } from "../src/process.js";
import { loadReconciledLocalTracker, reconcileTrackerFilenames } from "../src/tracker-files.js";
import {
  withLocalRelationships,
  withoutLocalRelationships,
} from "../src/local-relationships.js";

const taskSource = `---
id: LFI-15
type: task
title: Implement task parser
status: ready
execution_tier: deep
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
    executionTier: "deep",
    spec: "LFI-14",
    blockedBy: ["LFI-12"],
    githubIssue: 362,
    body: "## What to build\n\nParse a task.\n",
    path: "task.md",
  });
  assert.equal(parseTrackerDocument(serializeTrackerDocument(parsed), "task.md").title, parsed.title);
});

test("local task rendering exposes complexity and hides managed markers", () => {
  const task = parseTrackerDocument(taskSource, "task.md");
  const spec = parseTrackerDocument(
    taskSource
      .replace("id: LFI-15", "id: LFI-14")
      .replace("type: task", "type: spec")
      .replace("execution_tier: deep\n", "")
      .replace("spec: LFI-14\n", "")
      .replace("  - LFI-12\n", ""),
    "spec.md",
  );
  const blocker = parseTrackerDocument(
    taskSource
      .replace("id: LFI-15", "id: LFI-12")
      .replace("spec: LFI-14\n", "")
      .replace("  - LFI-12\n", ""),
    "blocker.md",
  );
  const rendered = withLocalRelationships(task, {
    documents: [spec, blocker, task],
    tasks: [blocker, task],
    specs: [spec],
  });

  assert.match(rendered, /^> \*\*Task complexity:\*\* `deep`/u);
  assert.match(rendered, /\n## Specification\n/u);
  assert.doesNotMatch(rendered, /<!-- lfi:local-relationships/u);
  assert.doesNotMatch(rendered, /\[lfi-local-relationships/u);
  assert.equal(withoutLocalRelationships(rendered), "## What to build\n\nParse a task.");
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
      .replace("execution_tier: deep\n", "")
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
    "Feature: LFI-14 — Implement task parser",
    "[SPEC] LFI-14 — Implement task parser",
    "[RUNNING] LFI-15 — Implement task parser",
    "[DONE] LFI-16 — Implement task parser",
  ]);
});

test("local status groups feature documents and trailing standalone tasks", () => {
  const document = (
    id: string,
    type: "task" | "spec",
    title: string,
    options: {
      completedAt?: string;
      spec?: string;
    } = {},
  ) =>
    parseTrackerDocument(
      serializeTrackerDocument({
        id,
        number: Number(id.slice(4)),
        type,
        title,
        status: options.completedAt ? "completed" : "ready",
        ...(type === "task" ? { executionTier: "standard" as const } : {}),
        ...(options.spec ? { spec: options.spec } : {}),
        blockedBy: [],
        ...(options.completedAt ? { completedAt: options.completedAt } : {}),
        body: "Document.\n",
        path: `${id}.md`,
      }),
      `${id}.md`,
    );
  const firstSpec = document("LFI-1", "spec", "First feature");
  const firstTask = document("LFI-2", "task", "First task", { spec: "LFI-1" });
  const secondSpec = document("LFI-3", "spec", "Second feature");
  const secondTask = document("LFI-4", "task", "Second task", {
    completedAt: "2026-02-01T00:00:00.000Z",
    spec: "LFI-3",
  });
  const standalone = document("LFI-5", "task", "Standalone task");
  const tracker = {
    documents: [firstSpec, firstTask, secondSpec, secondTask, standalone],
    tasks: [firstTask, secondTask, standalone],
    specs: [firstSpec, secondSpec],
  };

  assert.deepEqual(formatLocalStatus(tracker, new Set()), [
    "Feature: LFI-1 — First feature",
    "[SPEC] LFI-1 — First feature",
    "[READY] LFI-2 — First task",
    "Feature: LFI-3 — Second feature",
    "[SPEC] LFI-3 — Second feature",
    "[DONE] LFI-4 — Second task",
    "Standalone tasks",
    "[READY] LFI-5 — Standalone task",
  ]);
  assert.deepEqual(formatLocalStatus(tracker, new Set(), { language: "ru" }), [
    "Функция: LFI-1 — First feature",
    "[SPEC] LFI-1 — First feature",
    "[READY] LFI-2 — First task",
    "Функция: LFI-3 — Second feature",
    "[SPEC] LFI-3 — Second feature",
    "[DONE] LFI-4 — Second task",
    "Задачи без спецификации",
    "[READY] LFI-5 — Standalone task",
  ]);
});

test("tracker filenames expose derived status before the stable ID and title", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-status-filenames-"));
  const tasksRoot = join(root, "tasks");
  const specsRoot = join(root, "specs");
  await mkdir(tasksRoot);
  await mkdir(join(tasksRoot, "completed"));
  await mkdir(specsRoot);
  const specPath = join(specsRoot, "LFI-1-feature.md");
  const firstPath = join(tasksRoot, "LFI-2-first-task.md");
  const secondPath = join(tasksRoot, "LFI-3-second-task.md");
  const completedPath = join(tasksRoot, "completed", "LFI-4-completed-task.md");
  await writeFile(
    specPath,
    serializeTrackerDocument({
      id: "LFI-1",
      number: 1,
      type: "spec",
      title: "Feature",
      status: "ready",
      blockedBy: [],
      body: "Feature.\n",
      path: specPath,
    }),
  );
  await writeFile(
    firstPath,
    serializeTrackerDocument({
      id: "LFI-2",
      number: 2,
      type: "task",
      title: "First task",
      status: "ready",
      spec: "LFI-1",
      blockedBy: [],
      body: "First.\n",
      path: firstPath,
    }),
  );
  await writeFile(
    secondPath,
    serializeTrackerDocument({
      id: "LFI-3",
      number: 3,
      type: "task",
      title: "Second task",
      status: "ready",
      spec: "LFI-1",
      blockedBy: ["LFI-2"],
      body: "Second.\n",
      path: secondPath,
    }),
  );
  await writeFile(
    completedPath,
    serializeTrackerDocument({
      id: "LFI-4",
      number: 4,
      type: "task",
      title: "Completed task",
      status: "completed",
      completedAt: "2026-01-01T00:00:00.000Z",
      spec: "LFI-1",
      blockedBy: [],
      body: "Completed.\n",
      path: completedPath,
    }),
  );

  const tracker = await loadLocalTracker(root);
  await reconcileTrackerFilenames(tracker, new Set(["LFI-2"]));
  assert.deepEqual(await readdir(specsRoot), []);
  assert.deepEqual(
    (await readdir(tasksRoot)).sort(),
    ["completed", "feature"],
  );
  assert.deepEqual(await readdir(join(tasksRoot, "completed")), []);
  assert.deepEqual(
    (await readdir(join(tasksRoot, "feature"))).sort(),
    ["[SPEC] LFI-1 — feature.md", "tasks"],
  );
  assert.deepEqual(
    (await readdir(join(tasksRoot, "feature", "tasks"))).sort(),
    [
      "[BLOCKED] LFI-3 — second-task.md",
      "[DONE] LFI-4 — completed-task.md",
      "[RUNNING] LFI-2 — first-task.md",
    ],
  );
  const migrated = await loadLocalTracker(root);
  assert.equal(migrated.tasks.length, 3);
  assert.equal(migrated.tasks.find((item) => item.id === "LFI-4")?.completedAt,
    "2026-01-01T00:00:00.000Z");
  const second = await readFile(
    join(tasksRoot, "feature", "tasks", "[BLOCKED] LFI-3 — second-task.md"),
    "utf8",
  );
  assert.match(
    second,
    /## Specification[\s\S]*\[LFI-1 — Feature\]\(<\.\.\/\[SPEC\] LFI-1 — feature\.md>\)/u,
  );
  assert.match(
    second,
    /## Blocked by[\s\S]*- \[LFI-2 — First task\]\(<\[RUNNING\] LFI-2 — first-task\.md>\)/u,
  );
});

test("new layout ignores feature material and validates specification placement", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-new-layout-"));
  const feature = join(root, "tasks", "feature");
  const featureTasks = join(feature, "tasks");
  await mkdir(featureTasks, { recursive: true });
  await writeFile(join(feature, "notes.md"), "# Notes\n");
  await writeFile(join(feature, "diagram.png"), "not really an image");
  await writeFile(
    join(feature, "[SPEC] LFI-14 — feature.md"),
    taskSource
      .replace("id: LFI-15", "id: LFI-14")
      .replace("type: task", "type: spec")
      .replace("execution_tier: deep\n", "")
      .replace("spec: LFI-14\n", "")
      .replace("  - LFI-12\n", ""),
  );
  await writeFile(
    join(featureTasks, "[READY] LFI-15 — implement-task-parser.md"),
    taskSource.replace("  - LFI-12\n", ""),
  );
  await writeFile(
    join(root, "tasks", "[READY] LFI-16 — standalone.md"),
    taskSource
      .replace("id: LFI-15", "id: LFI-16")
      .replace("title: Implement task parser", "title: Standalone")
      .replace("spec: LFI-14\n", "")
      .replace("  - LFI-12\n", ""),
  );

  const tracker = await loadLocalTracker(root);
  assert.deepEqual(tracker.documents.map((item) => item.id).sort(), [
    "LFI-14",
    "LFI-15",
    "LFI-16",
  ]);

  const specificationPath = join(feature, "[SPEC] LFI-14 — feature.md");
  const specificationSource = await readFile(specificationPath, "utf8");
  await rm(specificationPath);
  await assert.rejects(loadLocalTracker(root), /exactly one specification/u);

  await writeFile(specificationPath, specificationSource);
  const duplicatePath = join(feature, "[SPEC] LFI-17 — duplicate.md");
  await writeFile(
    duplicatePath,
    specificationSource
      .replace("id: LFI-14", "id: LFI-17")
      .replace("title: Implement task parser", "title: Duplicate"),
  );
  await assert.rejects(loadLocalTracker(root), /exactly one specification/u);

  await rm(duplicatePath);
  const otherFeature = join(root, "tasks", "other-feature");
  await mkdir(join(otherFeature, "tasks"), { recursive: true });
  await writeFile(
    join(otherFeature, "[SPEC] LFI-17 — other-feature.md"),
    specificationSource
      .replace("id: LFI-14", "id: LFI-17")
      .replace("title: Implement task parser", "title: Other feature"),
  );
  const featureTaskPath = join(featureTasks, "[READY] LFI-15 — implement-task-parser.md");
  await writeFile(
    featureTaskPath,
    (await readFile(featureTaskPath, "utf8")).replace("spec: LFI-14", "spec: LFI-17"),
  );
  await assert.rejects(loadLocalTracker(root), /task must reference LFI-14/u);
});

test("reconciliation follows specification renames and task specification changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-layout-changes-"));
  const tasksRoot = join(root, "tasks");
  const firstFeature = join(tasksRoot, "first-feature");
  const secondFeature = join(tasksRoot, "second-feature");
  await mkdir(join(firstFeature, "tasks"), { recursive: true });
  await mkdir(join(secondFeature, "tasks"), { recursive: true });
  const makeSpec = (id: string, title: string, path: string) =>
    serializeTrackerDocument({
      id,
      number: Number(id.slice(4)),
      type: "spec",
      title,
      status: "ready",
      blockedBy: [],
      body: `${title}.\n`,
      path,
    });
  const firstSpecPath = join(firstFeature, "[SPEC] LFI-1 — first-feature.md");
  const secondSpecPath = join(secondFeature, "[SPEC] LFI-2 — second-feature.md");
  const taskPath = join(firstFeature, "tasks", "[READY] LFI-3 — task.md");
  await writeFile(firstSpecPath, makeSpec("LFI-1", "First feature", firstSpecPath));
  await writeFile(secondSpecPath, makeSpec("LFI-2", "Second feature", secondSpecPath));
  await writeFile(
    taskPath,
    serializeTrackerDocument({
      id: "LFI-3",
      number: 3,
      type: "task",
      title: "Task",
      status: "ready",
      spec: "LFI-1",
      blockedBy: [],
      body: "Task.\n",
      path: taskPath,
    }),
  );

  const tracker = await loadLocalTracker(root);
  const firstSpec = tracker.specs.find((item) => item.id === "LFI-1")!;
  const task = tracker.tasks[0]!;
  firstSpec.title = "Renamed feature";
  await reconcileTrackerFilenames(tracker, new Set());
  assert.equal(
    firstSpec.path,
    join(tasksRoot, "renamed-feature", "[SPEC] LFI-1 — renamed-feature.md"),
  );
  assert.equal(task.path, join(tasksRoot, "renamed-feature", "tasks", "[READY] LFI-3 — task.md"));

  await writeFile(
    task.path,
    (await readFile(task.path, "utf8")).replace("spec: LFI-1", "spec: LFI-2"),
  );
  const repointed = await loadReconciledLocalTracker(root);
  const movedTask = repointed.tasks[0]!;
  assert.equal(movedTask.path, join(secondFeature, "tasks", "[READY] LFI-3 — task.md"));
  assert.match(await readFile(movedTask.path, "utf8"), /\.\.\/\[SPEC\] LFI-2 — second-feature\.md/u);

  await writeFile(
    movedTask.path,
    (await readFile(movedTask.path, "utf8")).replace("spec: LFI-2\n", ""),
  );
  const cleared = await loadReconciledLocalTracker(root);
  const standaloneTask = cleared.tasks[0]!;
  assert.equal(standaloneTask.path, join(tasksRoot, "[READY] LFI-3 — task.md"));
  assert.match(await readFile(standaloneTask.path, "utf8"), /## Specification\n\nNone\./u);
});

test("reconciliation disambiguates feature slugs and reserves completed", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-layout-collisions-"));
  const specsRoot = join(root, "specs");
  await mkdir(join(root, "tasks"), { recursive: true });
  await mkdir(specsRoot);
  const specifications: ReadonlyArray<readonly [string, string]> = [
    ["LFI-1", "Same title"],
    ["LFI-2", "Same title!"],
    ["LFI-3", "Completed"],
  ];
  for (const [id, title] of specifications) {
    const path = join(specsRoot, `${id}-spec.md`);
    await writeFile(path, serializeTrackerDocument({
      id,
      number: Number(id.slice(4)),
      type: "spec",
      title,
      status: "ready",
      blockedBy: [],
      body: "Specification.\n",
      path,
    }));
  }

  const tracker = await loadLocalTracker(root);
  await reconcileTrackerFilenames(tracker, new Set());
  assert.deepEqual((await readdir(join(root, "tasks"))).sort(), [
    "completed-2",
    "same-title",
    "same-title-2",
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
  assert.match(lines[1]!, /заблокирована задачами LFI-12/u);
  assert.ok(lines.indexOf("[DONE] LFI-2 — Implement task parser") <
    lines.indexOf("[DONE] LFI-20 — Implement task parser"));
});
