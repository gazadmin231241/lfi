import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, serializeEnvConfig } from "../src/config.js";
import {
  parseTrackerDocument,
  serializeTrackerDocument,
} from "../src/local-tracker.js";
import { dryRun, runLfi } from "../src/runner.js";
import { runCommand } from "../src/process.js";

test("local dry-run selects the dependency frontier without GitHub", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-local-plan-"));
  const lfiRoot = join(root, ".lfi");
  const tasks = join(lfiRoot, "tasks");
  await mkdir(tasks, { recursive: true });
  await mkdir(join(lfiRoot, "specs"));
  await writeFile(
    join(lfiRoot, "config.env"),
    serializeEnvConfig({ ...DEFAULT_CONFIG, TASK_SOURCE: "local" }),
  );
  const create = async (
    number: number,
    status: "ready" | "completed",
    blockedBy: string[],
  ) =>
    writeFile(
      join(tasks, `LFI-${number}-task.md`),
      serializeTrackerDocument({
        id: `LFI-${number}`,
        number,
        type: "task",
        title: `Task ${number}`,
        status,
        blockedBy,
        body: `Build task ${number}.\n`,
        path: join(tasks, `LFI-${number}-task.md`),
      }),
    );
  await create(1, "completed", []);
  await create(2, "ready", ["LFI-1"]);
  await create(3, "ready", ["LFI-2"]);

  const plan = await dryRun(root);
  assert.deepEqual(plan.runnable.map((task) => task.id), ["LFI-2"]);
  assert.deepEqual(plan.blocked.map((task) => task.id), ["LFI-3"]);

  const selected = await dryRun(root, ["LFI-3"]);
  assert.deepEqual(selected.runnable, []);
  assert.deepEqual(selected.blocked.map((task) => task.id), ["LFI-3"]);
});

test("local run checkpoints, integrates, and completes a task without GitHub", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-local-run-"));
  const lfiRoot = join(root, ".lfi");
  const tasks = join(lfiRoot, "tasks");
  const tools = join(root, "test-tools");
  const taskPath = join(tasks, "LFI-1-implement-local-run.md");
  const ghCalls = join(root, "gh-calls");
  await mkdir(tasks, { recursive: true });
  await mkdir(join(lfiRoot, "specs"));
  await mkdir(tools);
  await writeFile(
    join(root, ".gitignore"),
    ".lfi/*\n!.lfi/tasks/\n!.lfi/tasks/**\n!.lfi/specs/\n!.lfi/specs/**\n",
  );
  await writeFile(
    join(lfiRoot, "config.env"),
    serializeEnvConfig({
      ...DEFAULT_CONFIG,
      TASK_SOURCE: "local",
      MAX_PARALLEL: 1,
      MAX_STAGES: 2,
      VALIDATE_COMMAND: "test -f implemented.txt",
    }),
  );
  await writeFile(join(lfiRoot, "task-prompt.md"), "Implement the task.\n");
  await writeFile(
    taskPath,
    serializeTrackerDocument({
      id: "LFI-1",
      number: 1,
      type: "task",
      title: "Implement local run",
      status: "ready",
      blockedBy: [],
      body: "Create implemented.txt.\n",
      path: taskPath,
    }),
  );
  await writeFile(
    join(tools, "codex"),
    `#!/bin/sh
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    output="$1"
  fi
  shift
done
printf 'implemented\\n' > implemented.txt
git add implemented.txt
git commit -m "feat: implement local task" >/dev/null
printf '{"status":"completed","summary":"implemented"}\\n' > "$output"
`,
  );
  await writeFile(
    join(tools, "gh"),
    `#!/bin/sh
printf 'called\\n' >> "${ghCalls}"
exit 97
`,
  );
  await chmod(join(tools, "codex"), 0o755);
  await chmod(join(tools, "gh"), 0o755);
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await git("add", ".");
  await git("commit", "-m", "test: initialize repository");
  await writeFile(
    taskPath,
    (await readFile(taskPath, "utf8")).replace(
      "Create implemented.txt.",
      "Create implemented.txt with a newline.",
    ),
  );

  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    assert.equal(await runLfi(root, "en"), 0);
  } finally {
    process.env.PATH = originalPath;
  }

  assert.equal(await readFile(join(root, "implemented.txt"), "utf8"), "implemented\n");
  const task = parseTrackerDocument(await readFile(taskPath, "utf8"), taskPath);
  assert.equal(task.status, "completed");
  const log = await runCommand("git", ["log", "--format=%s"], { cwd: root });
  assert.match(log.stdout, /docs\(lfi\): update local task tracker/u);
  assert.match(log.stdout, /feat: implement local task/u);
  assert.match(log.stdout, /chore\(lfi\): complete LFI-1/u);
  await assert.rejects(readFile(ghCalls, "utf8"));
});
