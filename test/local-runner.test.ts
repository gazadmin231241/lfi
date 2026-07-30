import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
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
        ...(status === "completed"
          ? { completedAt: "2026-01-01T00:00:00.000Z" }
          : {}),
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
  assert.deepEqual(plan.blocked[0]?.blockedBy, ["LFI-2"]);

  const selected = await dryRun(root, ["LFI-3"]);
  assert.deepEqual(selected.runnable, []);
  assert.deepEqual(selected.blocked.map((task) => task.id), ["LFI-3"]);
});

test("local run commits worker changes, integrates, and completes a task without GitHub", async () => {
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
      VALIDATE_COMMAND:
        "printf 'validation detail: implemented.txt exists github_pat_EXAMPLE_SECRET_123456\\n' && test -f implemented.txt",
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
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Implementation is ready."}}'
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
  const originalLog = console.log;
  const terminal: string[] = [];
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => {
    terminal.push(values.join(" "));
  };
  try {
    assert.equal(await runLfi(root, "en"), 0);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }

  const output = terminal.join("\n");
  assert.match(output, /={20,}\nIteration 1\n={20,}/u);
  assert.match(output, /  Runnable: LFI-1/u);
  assert.match(output, /    Work started/u);
  assert.match(output, /\[lfi-1\] Implementation is ready\./u);
  assert.match(output, /-{20,}\nIntegration\n-{20,}/u);
  assert.match(output, /    Merging branch: lfi\/lfi-1 \(LFI-1\)/u);
  assert.match(output, /    Combined validation passed/u);
  assert.match(output, /    Changes merged into main/u);
  assert.match(output, /-{20,}\nSummary\n-{20,}/u);
  assert.match(output, /  Completed: LFI-1/u);
  assert.doesNotMatch(output, /\$ /u);
  assert.doesNotMatch(output, /validation detail/u);
  const successfulIntegrationLog = await readFile(
    join(lfiRoot, "logs", "integration.log"),
    "utf8",
  );
  assert.match(successfulIntegrationLog, /validation detail: implemented\.txt exists/u);
  assert.match(successfulIntegrationLog, /\[REDACTED\]/u);
  assert.doesNotMatch(successfulIntegrationLog, /github_pat_EXAMPLE_SECRET_123456/u);

  assert.equal(await readFile(join(root, "implemented.txt"), "utf8"), "implemented\n");
  const completedPath = join(
    tasks,
    "[DONE] LFI-1 — implement-local-run.md",
  );
  const task = parseTrackerDocument(
    await readFile(completedPath, "utf8"),
    completedPath,
  );
  assert.equal(task.status, "completed");
  await assert.rejects(readFile(taskPath, "utf8"));
  const log = await runCommand("git", ["log", "--format=%s"], { cwd: root });
  assert.match(log.stdout, /docs\(lfi\): update local task tracker/u);
  assert.match(log.stdout, /feat\(lfi\): implement LFI-1/u);
  assert.match(log.stdout, /chore\(lfi\): complete LFI-1/u);
  await assert.rejects(readFile(ghCalls, "utf8"));

  const blockedPath = join(tasks, "LFI-2-blocked.md");
  const blockerPath = join(tasks, "LFI-3-blocker.md");
  await writeFile(
    blockedPath,
    serializeTrackerDocument({
      id: "LFI-2",
      number: 2,
      type: "task",
      title: "Blocked task",
      status: "ready",
      blockedBy: ["LFI-3"],
      body: "Wait for LFI-3.\n",
      path: blockedPath,
    }),
  );
  await writeFile(
    blockerPath,
    serializeTrackerDocument({
      id: "LFI-3",
      number: 3,
      type: "task",
      title: "Blocker",
      status: "ready",
      blockedBy: [],
      body: "Implement the blocker.\n",
      path: blockerPath,
    }),
  );
  assert.equal(await runLfi(root, "ru", ["LFI-2"]), 1);
  assert.equal(
    await readFile(
      join(tasks, "[BLOCKED] LFI-2 — blocked-task.md"),
      "utf8",
    ).then((source) => source.includes("status: ready")),
    true,
  );
  assert.equal(
    await readFile(
      join(tasks, "[READY] LFI-3 — blocker.md"),
      "utf8",
    ).then((source) => source.includes("status: ready")),
    true,
  );

  const failingPath = join(tasks, "LFI-4-failing.md");
  await writeFile(
    failingPath,
    serializeTrackerDocument({
      id: "LFI-4",
      number: 4,
      type: "task",
      title: "Failing task",
      status: "ready",
      blockedBy: [],
      body: "Report an incomplete result.\n",
      path: failingPath,
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
printf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"sed -n '\\''1,40p'\\'' failing.txt"}}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Could not complete the task."}}'
printf '%s\\n' 'provider warning' >&2
printf '%s\\n' '{"status":"incomplete","summary":"blocked"}' > "$output"
`,
  );
  await chmod(join(tools, "codex"), 0o755);
  const failureTerminal: string[] = [];
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => {
    failureTerminal.push(values.join(" "));
  };
  try {
    assert.equal(await runLfi(root, "en", ["LFI-4"]), 1);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }
  const failures = await readdir(join(lfiRoot, "logs", "failures"));
  assert.equal(failures.length, 2);
  assert.ok(failures.every((name) => /^LFI-4--.+--iteration-\d+\.jsonl\.gz$/u.test(name)));
  assert.equal(
    (await readdir(join(lfiRoot, "logs"))).some((name) =>
      /^LFI-1.*\.jsonl\.gz$/u.test(name),
    ),
    false,
  );
  const failureOutput = failureTerminal.join("\n");
  assert.match(failureOutput, /Log: \.lfi\/logs\/LFI-4\.log/u);
  assert.match(
    failureOutput,
    /Diagnostics: \.lfi\/logs\/failures\/LFI-4--.+--iteration-2\.jsonl\.gz/u,
  );

  const validationTaskPath = join(tasks, "LFI-5-validation-failure.md");
  await writeFile(
    validationTaskPath,
    serializeTrackerDocument({
      id: "LFI-5",
      number: 5,
      type: "task",
      title: "Validation failure",
      status: "ready",
      blockedBy: [],
      body: "Create validation-failure.txt.\n",
      path: validationTaskPath,
    }),
  );
  await writeFile(
    join(lfiRoot, "config.env"),
    serializeEnvConfig({
      ...DEFAULT_CONFIG,
      TASK_SOURCE: "local",
      MAX_PARALLEL: 1,
      MAX_STAGES: 1,
      VALIDATE_COMMAND:
        "i=1; while [ $i -le 25 ]; do echo validation-line-$i; i=$((i+1)); done; exit 1",
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
printf 'validation failure\\n' > validation-failure.txt
printf '%s\\n' '{"status":"completed","summary":"implemented"}' > "$output"
`,
  );
  await chmod(join(tools, "codex"), 0o755);
  const validationTerminal: string[] = [];
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => {
    validationTerminal.push(values.join(" "));
  };
  const originalError = console.error;
  console.error = (...values: unknown[]) => {
    validationTerminal.push(values.join(" "));
  };
  try {
    assert.equal(await runLfi(root, "en", ["LFI-5"]), 1);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.env.PATH = originalPath;
  }
  const validationOutput = validationTerminal.join("\n");
  assert.doesNotMatch(validationOutput, /validation-line-[1-5](?:\D|$)/u);
  assert.match(validationOutput, /validation-line-6/u);
  assert.match(validationOutput, /validation-line-25/u);
  assert.match(validationOutput, /Validation command: i=1; while/u);
  assert.match(validationOutput, /Full output: \.lfi\/logs\/integration\.log/u);
  const integrationLog = await readFile(
    join(lfiRoot, "logs", "integration.log"),
    "utf8",
  );
  assert.match(integrationLog, /validation-line-1/u);
  assert.match(integrationLog, /validation-line-25/u);
  assert.ok(
    (await readdir(join(lfiRoot, "logs", "failures"))).some((name) =>
      /^LFI-5--.+--iteration-1\.jsonl\.gz$/u.test(name),
    ),
  );
});
