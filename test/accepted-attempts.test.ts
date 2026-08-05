import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  forgetAttemptCheckpoint,
  readAttemptCheckpoint,
  readAttemptCheckpoints,
  recordAttemptCheckpoint,
} from "../src/accepted-attempts.js";

const stateRoot = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "lfi-accepted-attempts-"));

const attempt = (taskId: string, commit: string) => ({
  taskId,
  commit,
  baseRef: "main",
  baseCommit: "b".repeat(40),
  recordedAt: new Date().toISOString(),
  status: "validated" as const,
});

test("a recorded acceptance is readable by task id", async () => {
  const root = await stateRoot();

  await recordAttemptCheckpoint(root, attempt("LFI-1", "a".repeat(40)));

  assert.deepEqual(
    (await readAttemptCheckpoint(root, "LFI-1"))?.commit,
    "a".repeat(40),
  );
  assert.equal(await readAttemptCheckpoint(root, "LFI-2"), undefined);
});

test("acceptances of several tasks live side by side", async () => {
  const root = await stateRoot();

  await recordAttemptCheckpoint(root, attempt("LFI-1", "a".repeat(40)));
  await recordAttemptCheckpoint(root, attempt("LFI-2", "c".repeat(40)));

  assert.deepEqual(
    Object.keys(await readAttemptCheckpoints(root)).sort(),
    ["LFI-1", "LFI-2"],
  );
});

test("re-recording a task replaces its earlier acceptance", async () => {
  const root = await stateRoot();
  await recordAttemptCheckpoint(root, attempt("LFI-1", "a".repeat(40)));

  await recordAttemptCheckpoint(root, attempt("LFI-1", "d".repeat(40)));

  assert.equal(
    (await readAttemptCheckpoint(root, "LFI-1"))?.commit,
    "d".repeat(40),
  );
});

test("forgetting one acceptance keeps the others", async () => {
  const root = await stateRoot();
  await recordAttemptCheckpoint(root, attempt("LFI-1", "a".repeat(40)));
  await recordAttemptCheckpoint(root, attempt("LFI-2", "c".repeat(40)));

  await forgetAttemptCheckpoint(root, "LFI-1");
  await forgetAttemptCheckpoint(root, "LFI-3");

  assert.deepEqual(Object.keys(await readAttemptCheckpoints(root)), ["LFI-2"]);
});

test("a missing state file reads as no acceptances", async () => {
  assert.deepEqual(await readAttemptCheckpoints(await stateRoot()), {});
});

test("an unreadable state file reads as no acceptances", async () => {
  const root = await stateRoot();
  await writeFile(join(root, "accepted-attempts.json"), "{not json");

  assert.deepEqual(await readAttemptCheckpoints(root), {});
});

test("entries that do not describe an acceptance are dropped", async () => {
  const root = await stateRoot();
  await writeFile(
    join(root, "accepted-attempts.json"),
    JSON.stringify({
      "LFI-1": { taskId: "LFI-1", commit: 42 },
      "LFI-2": attempt("LFI-2", "c".repeat(40)),
      "LFI-3": { ...attempt("LFI-3", "d".repeat(40)), status: "unknown" },
    }),
  );

  assert.deepEqual(Object.keys(await readAttemptCheckpoints(root)), ["LFI-2"]);
});

test("legacy acceptance records are normalized to explicit checkpoint statuses", async () => {
  const root = await stateRoot();
  await writeFile(
    join(root, "accepted-attempts.json"),
    JSON.stringify({
      "LFI-1": { ...attempt("LFI-1", "a".repeat(40)), status: undefined },
      "LFI-2": {
        ...attempt("LFI-2", "c".repeat(40)),
        status: undefined,
        validationPending: true,
      },
    }),
  );

  const records = await readAttemptCheckpoints(root);

  assert.equal(records["LFI-1"]?.status, "validated");
  assert.equal(records["LFI-2"]?.status, "reviewed");
});

test("records are written as formatted JSON", async () => {
  const root = await stateRoot();

  await recordAttemptCheckpoint(root, attempt("LFI-1", "a".repeat(40)));

  const raw = await readFile(join(root, "accepted-attempts.json"), "utf8");
  assert.match(raw, /^\{\n {2}"LFI-1": \{\n/u);
  assert.equal(raw.endsWith("\n"), true);
});
