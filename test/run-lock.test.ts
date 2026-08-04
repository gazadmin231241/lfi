import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireRunLock, isProcessRunning } from "../src/run-lock.js";

const stateRoot = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "lfi-run-lock-"));

const age = async (path: string, seconds: number): Promise<void> => {
  const past = new Date(Date.now() - seconds * 1_000);
  await utimes(path, past, past);
};

test("acquiring a free lock records the current pid", async () => {
  const root = await stateRoot();

  const lock = await acquireRunLock(root, "run-1");

  assert.ok(lock);
  const raw = await readFile(join(root, "run.lock"), "utf8");
  assert.deepEqual(JSON.parse(raw), { pid: process.pid, runId: "run-1" });
});

test("releasing a lock removes its file", async () => {
  const root = await stateRoot();
  const lock = await acquireRunLock(root, "run-1");
  assert.ok(lock);

  await lock.release();

  await assert.rejects(stat(join(root, "run.lock")));
});

test("a lock held by a live process is refused", async () => {
  const root = await stateRoot();
  await writeFile(
    join(root, "run.lock"),
    `${JSON.stringify({ pid: 4242, runId: "run-1" })}\n`,
  );

  const lock = await acquireRunLock(root, "run-2", {
    isProcessAlive: (pid) => {
      assert.equal(pid, 4242);
      return true;
    },
  });

  assert.equal(lock, undefined);
});

test("a lock left by a dead process is reclaimed", async () => {
  const root = await stateRoot();
  await writeFile(
    join(root, "run.lock"),
    `${JSON.stringify({ pid: 4242, runId: "run-1" })}\n`,
  );

  const lock = await acquireRunLock(root, "run-2", {
    isProcessAlive: () => false,
  });

  assert.ok(lock);
  const raw = await readFile(join(root, "run.lock"), "utf8");
  assert.deepEqual(JSON.parse(raw), { pid: process.pid, runId: "run-2" });
});

test("an unreadable lock is left alone while it is still fresh", async () => {
  const root = await stateRoot();
  await writeFile(join(root, "run.lock"), "");

  const lock = await acquireRunLock(root, "run-2", {
    isProcessAlive: () => false,
  });

  assert.equal(lock, undefined);
});

test("an unreadable lock is reclaimed once it is stale", async () => {
  const root = await stateRoot();
  const lockPath = join(root, "run.lock");
  await writeFile(lockPath, "not json");
  await age(lockPath, 60);

  const lock = await acquireRunLock(root, "run-2", {
    isProcessAlive: () => false,
  });

  assert.ok(lock);
});

test("the running process reads as alive and an unused pid does not", () => {
  assert.equal(isProcessRunning(process.pid), true);
  // Above the default pid ceiling, so nothing can be occupying it.
  assert.equal(isProcessRunning(0x7fff_fffe), false);
});
