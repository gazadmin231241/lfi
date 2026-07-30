import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatLogRuns,
  formatTaskLogSection,
  listLogRuns,
  readLatestTaskLog,
} from "../src/log-view.js";

test("log view lists current and historical runs newest first", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-log-view-"));
  const lfiRoot = join(root, ".lfi");
  const stateRoot = join(lfiRoot, "state");
  const historyRoot = join(stateRoot, "history");
  await mkdir(historyRoot, { recursive: true });
  await writeFile(
    join(stateRoot, "current-run.json"),
    `${JSON.stringify({
      runId: "2026-07-30T13-44-12.749Z",
      startedAt: "2026-07-30T13:44:12.749Z",
      status: "running",
      stage: 2,
      activeIssues: ["LFI-3"],
      completed: ["LFI-2"],
    })}\n`,
  );
  await writeFile(
    join(historyRoot, "2026-07-30T11-58-06.317Z.json"),
    `${JSON.stringify({
      runId: "2026-07-30T11-58-06.317Z",
      startedAt: "2026-07-30T11:58:06.317Z",
      completed: [],
      unresolved: [{ id: "LFI-2", reason: "blocked" }],
      iterations: 1,
      finishedAt: "2026-07-30T12:01:00.000Z",
    })}\n`,
  );

  assert.deepEqual(await listLogRuns(lfiRoot), [
    {
      startedAt: "2026-07-30T13:44:12.749Z",
      tasks: ["LFI-2", "LFI-3"],
      status: "running",
      iterations: 2,
    },
    {
      startedAt: "2026-07-30T11:58:06.317Z",
      tasks: ["LFI-2"],
      status: "failed",
      iterations: 1,
    },
  ]);
});

test("log view reads only the latest task-log section", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-task-log-view-"));
  const logsRoot = join(root, ".lfi", "logs");
  await mkdir(logsRoot, { recursive: true });
  await writeFile(
    join(logsRoot, "LFI-2.log"),
    `
--- Run started: 2026-07-29T10:00:00.000Z; iteration: 1 ---
old command

--- Run started: 2026-07-30T13:44:12.749Z; iteration: 2 ---
latest summary
`,
  );

  assert.deepEqual(await readLatestTaskLog(logsRoot, "LFI-2"), {
    path: join(logsRoot, "LFI-2.log"),
    content:
      "--- Run started: 2026-07-30T13:44:12.749Z; iteration: 2 ---\nlatest summary\n",
  });
});

test("log view formats a localized human-readable run table", () => {
  const output = formatLogRuns(
    [
      {
        startedAt: "2026-07-30T13:44:12.749Z",
        tasks: ["LFI-2"],
        status: "running",
        iterations: 2,
      },
      {
        startedAt: "2026-07-30T11:58:06.317Z",
        tasks: [],
        status: "no_tasks",
        iterations: 0,
      },
    ],
    "ru",
    "UTC",
  );

  assert.match(output, /Время\s+Задачи\s+Результат\s+Итерации/u);
  assert.match(output, /30\.07, 13:44\s+LFI-2\s+выполняется\s+2/u);
  assert.match(output, /30\.07, 11:58\s+—\s+нет задач\s+0/u);
});

test("log view localizes stored task-log metadata", () => {
  assert.equal(
    formatTaskLogSection(
      "--- Run started: 2026-07-30T13:44:12.749Z; iteration: 2 ---\nГотово.\n",
      "ru",
    ),
    "--- Запуск начат: 2026-07-30T13:44:12.749Z; итерация: 2 ---\nГотово.\n",
  );
});

test("log view keeps timestamp-directory logs readable during migration", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-legacy-log-view-"));
  const lfiRoot = join(root, ".lfi");
  const legacy = join(lfiRoot, "logs", "2026-07-30T10-07-09Z");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "lfi-2-1.log"), "legacy task output\n");
  await writeFile(
    join(legacy, "summary.json"),
    `${JSON.stringify({
      completed: ["LFI-2"],
      unresolved: [],
    })}\n`,
  );

  assert.deepEqual(await listLogRuns(lfiRoot), [
    {
      startedAt: "2026-07-30T10:07:09.000Z",
      tasks: ["LFI-2"],
      status: "completed",
      iterations: 1,
    },
  ]);
  assert.deepEqual(await readLatestTaskLog(join(lfiRoot, "logs"), "LFI-2"), {
    path: join(legacy, "lfi-2-1.log"),
    content: "legacy task output\n",
  });
});
