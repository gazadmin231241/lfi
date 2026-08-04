import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  forgetAcceptedAttempt,
  readAcceptedAttempt,
  readAcceptedAttempts,
  recordAcceptedAttempt,
} from "../src/accepted-attempts.js";

const stateRoot = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "lfi-accepted-attempts-"));

const attempt = (taskId: string, commit: string) => ({
  taskId,
  commit,
  baseRef: "main",
  baseCommit: "b".repeat(40),
  recordedAt: new Date().toISOString(),
});

test("a recorded acceptance is readable by task id", async () => {
  const root = await stateRoot();

  await recordAcceptedAttempt(root, attempt("LFI-1", "a".repeat(40)));

  assert.deepEqual(
    (await readAcceptedAttempt(root, "LFI-1"))?.commit,
    "a".repeat(40),
  );
  assert.equal(await readAcceptedAttempt(root, "LFI-2"), undefined);
});

test("acceptances of several tasks live side by side", async () => {
  const root = await stateRoot();

  await recordAcceptedAttempt(root, attempt("LFI-1", "a".repeat(40)));
  await recordAcceptedAttempt(root, attempt("LFI-2", "c".repeat(40)));

  assert.deepEqual(
    Object.keys(await readAcceptedAttempts(root)).sort(),
    ["LFI-1", "LFI-2"],
  );
});

test("re-recording a task replaces its earlier acceptance", async () => {
  const root = await stateRoot();
  await recordAcceptedAttempt(root, attempt("LFI-1", "a".repeat(40)));

  await recordAcceptedAttempt(root, attempt("LFI-1", "d".repeat(40)));

  assert.equal(
    (await readAcceptedAttempt(root, "LFI-1"))?.commit,
    "d".repeat(40),
  );
});

test("forgetting one acceptance keeps the others", async () => {
  const root = await stateRoot();
  await recordAcceptedAttempt(root, attempt("LFI-1", "a".repeat(40)));
  await recordAcceptedAttempt(root, attempt("LFI-2", "c".repeat(40)));

  await forgetAcceptedAttempt(root, "LFI-1");
  await forgetAcceptedAttempt(root, "LFI-3");

  assert.deepEqual(Object.keys(await readAcceptedAttempts(root)), ["LFI-2"]);
});

test("a missing state file reads as no acceptances", async () => {
  assert.deepEqual(await readAcceptedAttempts(await stateRoot()), {});
});

test("an unreadable state file reads as no acceptances", async () => {
  const root = await stateRoot();
  await writeFile(join(root, "accepted-attempts.json"), "{not json");

  assert.deepEqual(await readAcceptedAttempts(root), {});
});

test("entries that do not describe an acceptance are dropped", async () => {
  const root = await stateRoot();
  await writeFile(
    join(root, "accepted-attempts.json"),
    JSON.stringify({
      "LFI-1": { taskId: "LFI-1", commit: 42 },
      "LFI-2": attempt("LFI-2", "c".repeat(40)),
    }),
  );

  assert.deepEqual(Object.keys(await readAcceptedAttempts(root)), ["LFI-2"]);
});

test("records are written as formatted JSON", async () => {
  const root = await stateRoot();

  await recordAcceptedAttempt(root, attempt("LFI-1", "a".repeat(40)));

  const raw = await readFile(join(root, "accepted-attempts.json"), "utf8");
  assert.match(raw, /^\{\n {2}"LFI-1": \{\n/u);
  assert.equal(raw.endsWith("\n"), true);
});
