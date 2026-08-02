import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
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
import { fakeIsolationExecutable } from "./support.js";

const addOrigin = async (
  git: (...args: string[]) => Promise<void>,
): Promise<void> => {
  const remote = await mkdtemp(join(tmpdir(), "lfi-origin-"));
  const initialized = await runCommand("git", ["init", "--bare", remote]);
  assert.equal(initialized.exitCode, 0, initialized.stderr);
  await git("remote", "add", "origin", remote);
  await git("push", "-u", "origin", "main");
};

test("local dry-run selects the dependency frontier without GitHub", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-local-plan-"));
  const lfiRoot = join(root, ".lfi");
  const tasks = join(root, ".scratch");
  await mkdir(tasks, { recursive: true });
  await mkdir(lfiRoot, { recursive: true });
  await writeFile(
    join(lfiRoot, "config.env"),
    serializeEnvConfig(DEFAULT_CONFIG),
  );
  const create = async (
    number: number,
    status: "ready" | "completed",
    blockedBy: string[],
  ) => {
    const path = join(
      tasks,
      `[${status === "completed" ? "DONE" : "READY"}] LFI-${number} — task.md`,
    );
    return writeFile(
      path,
      serializeTrackerDocument({
        id: `LFI-${number}`,
        number,
        type: "task",
        title: `Task ${number}`,
        status,
        blockedBy,
        body: `Build task ${number}.\n`,
        path,
      }),
    );
  };
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

test("local run does not repeat accepted work after integration fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-local-baseline-failure-"));
  const lfiRoot = join(root, ".lfi");
  const tasks = join(root, ".scratch");
  const tools = join(root, "test-tools");
  const taskPath = join(tasks, "[READY] LFI-1 — fix-validation.md");
  const codexCalls = join(root, "codex-calls");
  await mkdir(tasks, { recursive: true });
  await mkdir(lfiRoot, { recursive: true });
  await mkdir(tools);
  await writeFile(
    join(root, ".gitignore"),
    "# LFI local tracker: begin\n.lfi/*\n!.lfi/tasks/\n!.lfi/tasks/*.md\n!.lfi/specs/\n!.lfi/specs/*.md\n# LFI local tracker: end\n",
  );
  await writeFile(
    join(lfiRoot, "config.env"),
    serializeEnvConfig({
      ...DEFAULT_CONFIG,
      ISOLATION_PROVIDER: "none",
      MAX_PARALLEL: 1,
      MAX_STAGES: 2,
      VALIDATE_COMMAND: "printf 'validation is broken\\n' >&2; exit 1",
    }),
  );
  await writeFile(join(lfiRoot, "task-prompt.md"), "Implement the task.\n");
  await writeFile(
    taskPath,
    serializeTrackerDocument({
      id: "LFI-1",
      number: 1,
      type: "task",
      title: "Fix validation",
      status: "ready",
      blockedBy: [],
      body: "Create baseline-ready.txt.\n",
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
cat >/dev/null
printf 'called\\n' >> "${codexCalls}"
printf 'implemented\\n' > implemented.txt
git add implemented.txt
git commit -m 'agent: prepare baseline-ready result'
printf '{"status":"completed","summary":"implemented"}\\n' > "$output"
`,
  );
  await chmod(join(tools, "codex"), 0o755);
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await git("add", ".");
  await git("commit", "-m", "test: initialize repository");
  await addOrigin(git);

  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    assert.equal(await runLfi(root, "en"), 1);
  } finally {
    process.env.PATH = originalPath;
  }

  assert.equal(await readFile(codexCalls, "utf8"), "called\n");
  const readyPath = join(tasks, "[READY] LFI-1 — fix-validation.md");
  const task = parseTrackerDocument(
    await readFile(readyPath, "utf8"),
    readyPath,
  );
  assert.equal(task.status, "ready");
});

test("local task run commits worker changes, pushes code, and completes the task", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-local-run-"));
  const lfiRoot = join(root, ".lfi");
  const tasks = join(root, ".scratch");
  const tools = join(root, "test-tools");
  const taskPath = join(tasks, "[READY] LFI-1 — implement-local-run.md");
  const ghCalls = join(root, "gh-calls");
  await mkdir(tasks, { recursive: true });
  await mkdir(lfiRoot, { recursive: true });
  await mkdir(tools);
  await writeFile(
    join(root, ".gitignore"),
    ".lfi/*\n",
  );
  await writeFile(
    join(lfiRoot, "config.env"),
    serializeEnvConfig({
      ...DEFAULT_CONFIG,
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
      body: "Create implemented.txt.\n\n- [ ] File is created.\n- [x] Existing completed criterion.\n",
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
git commit -m 'agent: implement local run'
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
  await writeFile(
    join(tools, "bwrap"),
    fakeIsolationExecutable(join(lfiRoot, "isolation-calls")),
  );
  await chmod(join(tools, "codex"), 0o755);
  await chmod(join(tools, "gh"), 0o755);
  await chmod(join(tools, "bwrap"), 0o755);
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await git("add", ".");
  await git("commit", "-m", "test: initialize repository");
  await addOrigin(git);
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
  assert.match(output, /    Codex default · medium/u);
  assert.match(output, /\[lfi-1\] Implementation is ready\./u);
  assert.match(output, /-{20,}\nIntegration\n-{20,}/u);
  assert.match(output, /    Merging branch: lfi\/lfi-1 \(LFI-1\)/u);
  assert.match(output, /    Combined validation passed/u);
  assert.match(output, /    Changes merged into main/u);
  assert.match(output, /-{20,}\nSummary\n-{20,}/u);
  assert.match(output, /  Completed: LFI-1/u);
  assert.doesNotMatch(output, /\$ /u);
  assert.doesNotMatch(output, /validation detail/u);
  const runLog = await readFile(join(lfiRoot, "logs", "run.log"), "utf8");
  assert.match(
    runLog,
    /Run started: .+; iteration: 0 ---\n[\s\S]*Iteration 1/u,
  );
  assert.equal(
    runLog.slice(runLog.indexOf("\n", runLog.indexOf("--- Run started:")) + 1).trim(),
    output.trim(),
  );
  const successfulIntegrationLog = await readFile(
    join(lfiRoot, "logs", "integration.log"),
    "utf8",
  );
  assert.match(successfulIntegrationLog, /validation detail: implemented\.txt exists/u);
  assert.match(successfulIntegrationLog, /\[REDACTED\]/u);
  assert.doesNotMatch(successfulIntegrationLog, /github_pat_EXAMPLE_SECRET_123456/u);

  const delivered = await runCommand(
    "git",
    ["show", "origin/main:implemented.txt"],
    { cwd: root },
  );
  assert.equal(delivered.stdout, "implemented\n");
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
  assert.match(task.body, /- \[x\] File is created\./u);
  assert.doesNotMatch(task.body, /- \[ \]/u);
  const deliveredTask = await runCommand(
    "git",
    [
      "show",
      "origin/main:.scratch/[DONE] LFI-1 — implement-local-run.md",
    ],
    { cwd: root },
  );
  assert.equal(
    parseTrackerDocument(deliveredTask.stdout, completedPath).status,
    "completed",
  );
  await assert.rejects(readFile(taskPath, "utf8"));
  const trackedCompleted = await runCommand(
    "git",
    [
      "ls-files",
      "--error-unmatch",
      "--",
      ".scratch/[DONE] LFI-1 — implement-local-run.md",
    ],
    { cwd: root },
  );
  assert.equal(trackedCompleted.exitCode, 0, trackedCompleted.stderr);
  const localLog = await runCommand("git", ["log", "--format=%s"], { cwd: root });
  assert.match(localLog.stdout, /docs\(lfi\): update local task tracker/u);
  assert.match(localLog.stdout, /chore\(lfi\): complete LFI-1/u);
  assert.match(localLog.stdout, /agent: implement local run/u);
  const deliveredLog = await runCommand(
    "git",
    ["log", "origin/main", "--format=%s"],
    { cwd: root },
  );
  assert.match(deliveredLog.stdout, /agent: implement local run/u);
  const isolationCalls = await readFile(
    join(lfiRoot, "isolation-calls"),
    "utf8",
  );
  assert.match(isolationCalls, /worktrees\/lfi-1\|.*-- codex /u);
  assert.match(isolationCalls, /--sandbox workspace-write/u);
  assert.match(isolationCalls, /--add-dir/u);
  await assert.rejects(readFile(ghCalls, "utf8"));

  const blockedPath = join(tasks, "[READY] LFI-2 — blocked.md");
  const blockerPath = join(tasks, "[READY] LFI-3 — blocker.md");
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
      join(tasks, "[BLOCKED] LFI-2 — blocked.md"),
      "utf8",
    ).then((source) => source.includes("Type: task")),
    true,
  );
  assert.equal(
    await readFile(
      join(tasks, "[READY] LFI-3 — blocker.md"),
      "utf8",
    ).then((source) => source.includes("Type: task")),
    true,
  );
  assert.match(
    await readFile(join(lfiRoot, "logs", "run.log"), "utf8"),
    /LFI-2 заблокирована задачами LFI-3\./u,
  );

  const failingPath = join(tasks, "[READY] LFI-4 — failing.md");
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
  await assert.rejects(stat(join(lfiRoot, "logs", "failures")));
  const failedTaskLog = await readFile(
    join(lfiRoot, "logs", "LFI-4.log"),
    "utf8",
  );
  assert.match(failedTaskLog, /sed -n '1,40p' failing\.txt/u);
  assert.match(failedTaskLog, /Could not complete the task\./u);
  assert.match(failedTaskLog, /provider warning/u);
  assert.match(failedTaskLog, /exit=0/u);
  assert.match(failedTaskLog, /status=incomplete/u);
  assert.match(failedTaskLog, /blocked/u);
  const failureOutput = failureTerminal.join("\n");
  assert.match(failureOutput, /Log: \.lfi\/logs\/LFI-4\.log/u);
  assert.doesNotMatch(failureOutput, /Diagnostics:/u);

  const validationTaskPath = join(tasks, "[READY] LFI-5 — validation-failure.md");
  const validationCodexCalls = join(root, "validation-codex-calls");
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
      MAX_PARALLEL: 1,
      MAX_STAGES: 3,
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
printf 'called\\n' >> "${validationCodexCalls}"
printf 'validation failure\\n' > validation-failure.txt
git add validation-failure.txt
git commit -m 'agent: create validation failure fixture'
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
  assert.equal(
    (await readFile(validationCodexCalls, "utf8")).trim().split("\n").length,
    1,
  );
  assert.doesNotMatch(validationOutput, /validation-line-[1-6](?:\D|$)/u);
  assert.match(validationOutput, /validation-line-7/u);
  assert.match(validationOutput, /validation-line-25/u);
  assert.match(validationOutput, /Validation command: i=1; while/u);
  assert.match(validationOutput, /Full output: \.lfi\/logs\/integration\.log/u);
  assert.match(
    validationOutput,
    /Preserved integration branch lfi\/integration-.+ at .+\/integration-/u,
  );
  assert.ok(
    (await readdir(join(lfiRoot, "worktrees"))).some((name) =>
      name.startsWith("integration-"),
    ),
  );
  const integrationLog = await readFile(
    join(lfiRoot, "logs", "integration.log"),
    "utf8",
  );
  assert.match(integrationLog, /validation-line-1/u);
  assert.match(integrationLog, /validation-line-25/u);
  await assert.rejects(stat(join(lfiRoot, "logs", "failures")));
});
