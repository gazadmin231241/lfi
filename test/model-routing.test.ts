import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, serializeEnvConfig } from "../src/config.js";
import type { ExecutionTier } from "../src/execution-tier.js";
import { serializeTrackerDocument } from "../src/local-tracker.js";
import { runCommand } from "../src/process.js";
import { runLfi } from "../src/runner.js";

const initializeRoutingRepository = async (options: {
  tasks: Array<{ id: number; tier?: ExecutionTier }>;
  config?: Partial<typeof DEFAULT_CONFIG>;
  codexScript: string;
}): Promise<{ root: string; calls: string; tools: string }> => {
  const root = await mkdtemp(join(tmpdir(), "lfi-routing-"));
  const lfiRoot = join(root, ".lfi");
  const tasksRoot = join(lfiRoot, "tasks");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  await mkdir(tasksRoot, { recursive: true });
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
      MAX_PARALLEL: 3,
      MAX_STAGES: 1,
      VALIDATE_COMMAND: "true",
      ...options.config,
    }),
  );
  await writeFile(join(lfiRoot, "task-prompt.md"), "Implement the task.\n");
  for (const task of options.tasks) {
    const id = `LFI-${task.id}`;
    const path = join(tasksRoot, `${id}-routing-task.md`);
    await writeFile(
      path,
      serializeTrackerDocument({
        id,
        number: task.id,
        type: "task",
        title: `Routing task ${task.id}`,
        status: "ready",
        ...(task.tier === undefined ? {} : { executionTier: task.tier }),
        blockedBy: [],
        body: `Implement ${id}.\n`,
        path,
      }),
    );
  }
  await writeFile(
    join(tools, "codex"),
    options.codexScript.replaceAll("{{CALLS}}", calls),
  );
  await chmod(join(tools, "codex"), 0o755);
  for (const args of [
    ["init", "-b", "main"],
    ["config", "user.name", "LFI Test"],
    ["config", "user.email", "lfi@example.test"],
    ["add", "."],
    ["commit", "-m", "test: initialize routing repository"],
  ]) {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  }
  return { root, calls, tools };
};

test("run routes task tiers to models while preserving configured reasoning", async () => {
  const fixture = await initializeRoutingRepository({
    tasks: [
      { id: 1, tier: "light" },
      { id: 2 },
      { id: 3, tier: "deep" },
    ],
    config: {
      CODEX_MODEL: "legacy",
      LIGHT_MODEL: "luna",
      STANDARD_MODEL: "terra",
      DEEP_MODEL: "sol",
      CODEX_REASONING_EFFORT: "low",
    },
    codexScript: `#!/bin/sh
output=""
model=""
printf '%s\\n' "$*" >> "{{CALLS}}"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    output="$1"
  elif [ "$1" = "--model" ]; then
    shift
    model="$1"
  fi
  shift
done
cat >/dev/null
printf '%s\\n' "$model" >> "{{CALLS}}"
printf 'implemented\\n' > "implemented-$(basename "$PWD").txt"
printf '{"status":"completed","summary":"implemented"}\\n' > "$output"
`,
  });
  const originalPath = process.env.PATH;
  process.env.PATH = `${fixture.tools}:${originalPath ?? ""}`;
  try {
    assert.equal(await runLfi(fixture.root, "en"), 0);
  } finally {
    process.env.PATH = originalPath;
  }

  const calls = await readFile(fixture.calls, "utf8");
  for (const model of ["luna", "terra", "sol"]) {
    assert.match(calls, new RegExp(`--model ${model}\\b`, "u"));
  }
  assert.equal(
    [...calls.matchAll(/model_reasoning_effort="low"/gu)].length,
    3,
  );
  const runLog = await readFile(
    join(fixture.root, ".lfi", "logs", "run.log"),
    "utf8",
  );
  assert.match(runLog, /LFI-2.+no execution tier.+standard/isu);
  for (const [id, model] of [
    ["LFI-1", "luna"],
    ["LFI-2", "terra"],
    ["LFI-3", "sol"],
  ]) {
    assert.match(
      runLog,
      new RegExp(
        `${id}\\n    Work started\\n    ${model} · low\\b`,
        "u",
      ),
    );
  }
  assert.equal(basename(fixture.root).startsWith("lfi-routing-"), true);
});

test("run starts repeated-model tasks up to the configured parallel limit", async () => {
  const fixture = await initializeRoutingRepository({
    tasks: [
      { id: 1, tier: "standard" },
      { id: 2, tier: "light" },
      { id: 3, tier: "standard" },
    ],
    config: {
      LIGHT_MODEL: "luna",
      STANDARD_MODEL: "terra",
    },
    codexScript: `#!/bin/sh
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    output="$1"
  fi
  shift
done
cat >/dev/null
printf 'started\n' >> "{{CALLS}}"
attempt=0
while [ "$(wc -l < "{{CALLS}}")" -lt 3 ] && [ "$attempt" -lt 20 ]; do
  sleep 0.05
  attempt=$((attempt + 1))
done
if [ "$(wc -l < "{{CALLS}}")" -lt 3 ]; then
  printf '{"status":"incomplete","summary":"parallel worker did not start"}\n' > "$output"
  exit 0
fi
printf 'implemented\n' > "implemented-$(basename "$PWD").txt"
printf '{"status":"completed","summary":"implemented"}\n' > "$output"
`,
  });
  const originalPath = process.env.PATH;
  process.env.PATH = `${fixture.tools}:${originalPath ?? ""}`;
  try {
    assert.equal(await runLfi(fixture.root, "en"), 0);
  } finally {
    process.env.PATH = originalPath;
  }

  assert.equal(await readFile(fixture.calls, "utf8"), "started\nstarted\nstarted\n");
});

test("run reports an unavailable model and continues other tiers", async () => {
  const fixture = await initializeRoutingRepository({
    tasks: [
      { id: 1, tier: "light" },
      { id: 2, tier: "light" },
      { id: 3, tier: "deep" },
    ],
    config: {
      LIGHT_MODEL: "luna-unavailable",
      STANDARD_MODEL: "terra",
      DEEP_MODEL: "sol",
      MAX_STAGES: 3,
    },
    codexScript: `#!/bin/sh
output=""
model=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    output="$1"
  elif [ "$1" = "--model" ]; then
    shift
    model="$1"
  fi
  shift
done
cat >/dev/null
printf '%s\\n' "$model" >> "{{CALLS}}"
if [ "$model" = "luna-unavailable" ]; then
  printf '%s\\n' "model luna-unavailable is not available for this account" >&2
  exit 1
fi
printf 'implemented\\n' > "implemented-$(basename "$PWD").txt"
printf '{"status":"completed","summary":"implemented"}\\n' > "$output"
`,
  });
  const originalPath = process.env.PATH;
  process.env.PATH = `${fixture.tools}:${originalPath ?? ""}`;
  try {
    assert.equal(await runLfi(fixture.root, "en"), 1);
  } finally {
    process.env.PATH = originalPath;
  }

  const calls = (await readFile(fixture.calls, "utf8")).trim().split("\n");
  assert.deepEqual(calls.sort(), [
    "luna-unavailable",
    "luna-unavailable",
    "sol",
  ]);
  const runLog = await readFile(
    join(fixture.root, ".lfi", "logs", "run.log"),
    "utf8",
  );
  assert.match(runLog, /luna-unavailable.+unavailable/isu);
  assert.match(runLog, /light tier model luna-unavailable/iu);
  assert.match(runLog, /LFI-2.+skipped/isu);
  assert.match(runLog, /Completed: LFI-3/u);
});

test("retries preserve the assigned model and user reasoning", async () => {
  const fixture = await initializeRoutingRepository({
    tasks: [{ id: 1, tier: "deep" }],
    config: {
      DEEP_MODEL: "sol",
      CODEX_REASONING_EFFORT: "low",
      MAX_STAGES: 2,
    },
    codexScript: `#!/bin/sh
output=""
printf '%s\\n' "$*" >> "{{CALLS}}"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    output="$1"
  fi
  shift
done
cat >/dev/null
if [ "$(wc -l < "{{CALLS}}")" -eq 1 ]; then
  printf '{"status":"incomplete","summary":"retry"}\\n' > "$output"
  exit 0
fi
printf 'implemented\\n' > implemented-after-retry.txt
printf '{"status":"completed","summary":"implemented"}\\n' > "$output"
`,
  });
  const originalPath = process.env.PATH;
  process.env.PATH = `${fixture.tools}:${originalPath ?? ""}`;
  try {
    assert.equal(await runLfi(fixture.root, "en"), 0);
  } finally {
    process.env.PATH = originalPath;
  }

  const calls = await readFile(fixture.calls, "utf8");
  assert.equal([...calls.matchAll(/--model sol\b/gu)].length, 2);
  assert.equal(
    [...calls.matchAll(/model_reasoning_effort="low"/gu)].length,
    2,
  );
});

test("Russian run logs missing tiers and unavailable configured models", async () => {
  const fixture = await initializeRoutingRepository({
    tasks: [{ id: 1, tier: "light" }, { id: 2 }],
    config: {
      LIGHT_MODEL: "luna-unavailable",
      STANDARD_MODEL: "terra",
      MAX_STAGES: 1,
    },
    codexScript: `#!/bin/sh
output=""
model=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    output="$1"
  elif [ "$1" = "--model" ]; then
    shift
    model="$1"
  fi
  shift
done
cat >/dev/null
printf '%s\\n' "$model" >> "{{CALLS}}"
if [ "$model" = "luna-unavailable" ]; then
  printf '%s\\n' "model luna-unavailable is not available" >&2
  exit 1
fi
printf 'implemented\\n' > "implemented-$(basename "$PWD").txt"
printf '{"status":"completed","summary":"implemented"}\\n' > "$output"
`,
  });
  const originalPath = process.env.PATH;
  process.env.PATH = `${fixture.tools}:${originalPath ?? ""}`;
  try {
    assert.equal(await runLfi(fixture.root, "ru"), 1);
  } finally {
    process.env.PATH = originalPath;
  }

  const runLog = await readFile(
    join(fixture.root, ".lfi", "logs", "run.log"),
    "utf8",
  );
  assert.match(runLog, /LFI-2: уровень выполнения не указан/u);
  assert.match(
    runLog,
    /LFI-2\n    Работа началась\n    terra · medium\b/u,
  );
  assert.match(
    runLog,
    /модель luna-unavailable уровня light недоступна/u,
  );
});

test("GitHub run blocks conflicting tier labels without invoking a worker", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), "lfi-github-routing-"));
  const root = join(sandbox, "work");
  const remote = join(sandbox, "origin.git");
  const lfiRoot = join(root, ".lfi");
  const tools = join(sandbox, "tools");
  const ghCalls = join(sandbox, "gh-calls");
  const codexCalled = join(sandbox, "codex-called");
  await mkdir(root);
  await mkdir(lfiRoot);
  await mkdir(tools);
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runCommand("git", args, { cwd });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git(sandbox, "init", "--bare", remote);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "LFI Test");
  await git(root, "config", "user.email", "lfi@example.test");
  await writeFile(join(root, ".gitignore"), ".lfi/\n");
  await writeFile(join(root, "README.md"), "test\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test: initialize GitHub routing repository");
  await git(root, "remote", "add", "origin", remote);
  await git(root, "push", "-u", "origin", "main");
  await writeFile(
    join(lfiRoot, "config.env"),
    serializeEnvConfig({
      ...DEFAULT_CONFIG,
      TASK_SOURCE: "github",
      BASE_BRANCH: "main",
      STANDARD_MODEL: "terra",
      VALIDATE_COMMAND: "true",
      MAX_STAGES: 1,
    }),
  );
  await writeFile(join(lfiRoot, "task-prompt.md"), "Implement the task.\n");
  await writeFile(
    join(tools, "gh"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${ghCalls}"
case "$*" in
  *"repo view"*)
    printf '%s\\n' '{"nameWithOwner":"acme/widgets","defaultBranchRef":{"name":"main"}}'
    ;;
  *"--label lfi:task"*)
    printf '%s\\n' '[{"number":7,"title":"Conflicting tier","url":"https://github.test/7","body":"Do work.","labels":[{"name":"lfi:task"},{"name":"lfi:tier:light"},{"name":"lfi:tier:deep"}]}]'
    ;;
  *"--limit 1000"*)
    printf '%s\\n' '[{"number":7}]'
    ;;
  *"dependencies/blocked_by"*)
    ;;
  *"issue view 7"*)
    printf '%s\\n' 'Conflicting tier'
    ;;
esac
`,
  );
  await writeFile(
    join(tools, "codex"),
    `#!/bin/sh
touch "${codexCalled}"
exit 97
`,
  );
  await chmod(join(tools, "gh"), 0o755);
  await chmod(join(tools, "codex"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    assert.equal(await runLfi(root, "en"), 1);
  } finally {
    process.env.PATH = originalPath;
  }

  await assert.rejects(readFile(codexCalled, "utf8"));
  assert.match(
    await readFile(join(lfiRoot, "logs", "run.log"), "utf8"),
    /#7 has conflicting execution tier labels.+Keep exactly one lfi:tier:\*/su,
  );
  assert.match(await readFile(ghCalls, "utf8"), /issue comment 7/u);
});
