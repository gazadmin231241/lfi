import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadLocalTracker,
  runnableLocalTasks,
} from "../src/local-tracker.js";

test("tracker loads marker lines from a document tree and offers only tasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-marker-lines-"));
  const tasks = join(root, "tasks");
  await mkdir(tasks, { recursive: true });
  const documents = [
    ["[DONE] LFI-1 — prerequisite.md", "Type: task\nBlocked by: None\nTier: light\n\nDone.\n"],
    ["[READY] LFI-2 — executable-work.md", "Type: task\nBlocked by: LFI-1\nTier: deep\n\nBuild it.\n"],
    ["[READY] LFI-4 — research-question.md", "Type: research\nBlocked by: None\n\nInvestigate.\n"],
    ["[READY] LFI-5 — prototype.md", "Type: prototype\nBlocked by: None\n\nPrototype.\n"],
    ["[READY] LFI-6 — grilling.md", "Type: grilling\nBlocked by: None\n\nStress-test.\n"],
  ] as const;
  for (const [filename, source] of documents) {
    await writeFile(join(tasks, filename), source);
  }
  const feature = join(tasks, "feature");
  await mkdir(feature);
  await writeFile(
    join(feature, "[SPEC] LFI-3 — feature.md"),
    "Type: spec\nBlocked by: None\n\nSpecification.\n",
  );

  const tracker = await loadLocalTracker(root);
  assert.deepEqual(
    tracker.documents.find((document) => document.id === "LFI-2"),
    {
      id: "LFI-2",
      number: 2,
      type: "task",
      title: "Executable work",
      status: "ready",
      executionTier: "deep",
      blockedBy: ["LFI-1"],
      body: "Build it.\n",
      path: join(tasks, "[READY] LFI-2 — executable-work.md"),
    },
  );
  assert.deepEqual(tracker.tasks.map((document) => document.id), ["LFI-1", "LFI-2"]);
  assert.deepEqual(tracker.specs.map((document) => document.id), ["LFI-3"]);
  assert.deepEqual(runnableLocalTasks(tracker).runnable.map((document) => document.id), ["LFI-2"]);

  const researchPath = join(tasks, "[READY] LFI-4 — research-question.md");
  await writeFile(
    researchPath,
    (await readFile(researchPath, "utf8")).replace("Type: research", "Type: task"),
  );
  const promoted = await loadLocalTracker(root);
  assert.deepEqual(
    runnableLocalTasks(promoted).runnable.map((document) => document.id),
    ["LFI-2", "LFI-4"],
  );
});

test("tracker reports a marker-less Markdown document as malformed", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-malformed-marker-"));
  const tasks = join(root, "tasks");
  await mkdir(tasks, { recursive: true });
  const path = join(tasks, "[READY] LFI-1 — malformed.md");
  await writeFile(path, "Tier: standard\n\nMissing its declaration.\n");

  await assert.rejects(loadLocalTracker(root), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /\[READY\] LFI-1 — malformed\.md/u);
    assert.match(error.message, /missing Type: \/ отсутствует Type:/u);
    return true;
  });
});

test("tracker rejects a malformed blocker marker instead of unblocking work", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-malformed-blocker-"));
  const tasks = join(root, "tasks");
  await mkdir(tasks, { recursive: true });
  const path = join(tasks, "[READY] LFI-1 — unsafe-to-run.md");
  await writeFile(
    path,
    "Type: task\nBlocked by: LFI-O, truncated\nTier: standard\n\nDo not run.\n",
  );

  await assert.rejects(loadLocalTracker(root), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /\[READY\] LFI-1 — unsafe-to-run\.md/u);
    assert.match(error.message, /invalid Blocked by: \/ некорректный Blocked by:/u);
    return true;
  });
});
