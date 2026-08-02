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

import {
  buildAgentInvocation,
  isUnavailableModelError,
  runAgent,
} from "../src/agent-provider.js";

test("Codex provider builds its invocation without spawning a process", () => {
  const invocation = buildAgentInvocation({
    agent: "codex",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "gpt-test",
    reasoning: "high",
    prompt: "Implement the task.",
    finalPath: "/tmp/result.json",
    schemaPath: "/tmp/schema.json",
  });

  assert.equal(invocation.command, "codex");
  assert.deepEqual(invocation.args, [
    "--ask-for-approval",
    "never",
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--add-dir",
    "/repository/.git",
    "-c",
    'model_reasoning_effort="high"',
    "-c",
    "sandbox_workspace_write.network_access=true",
    "-C",
    "/worktree",
    "-o",
    "/tmp/result.json",
    "--model",
    "gpt-test",
    "--output-schema",
    "/tmp/schema.json",
    "-",
  ]);
  assert.equal(invocation.input, "Implement the task.");
});

test("Codex provider recognises unavailable-model errors without spawning", () => {
  assert.equal(
    isUnavailableModelError("codex", "model gpt-test is not available"),
    true,
  );
  assert.equal(
    isUnavailableModelError("codex", "network request failed"),
    false,
  );
});

const waitForFileContent = async (
  path: string,
  pattern: RegExp,
): Promise<string> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const content = await readFile(path, "utf8").catch(() => "");
    if (pattern.test(content)) return content;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${pattern} in ${path}`);
};

test("runAgent streams readable task details to a flat task log", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-codex-output-"));
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  const release = join(root, "release");
  await mkdir(bin, { recursive: true });
  const codex = join(bin, "codex");
  await writeFile(
    codex,
    `#!/bin/sh
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    output="$1"
  fi
  shift
done
printf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"sed -n '\\''1,40p'\\'' src/codex.ts"}}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Проверяю формат логов."}}'
while [ ! -f "${release}" ]; do read -r _ < /dev/null || true; done
printf '%s' '{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":30}}'
printf '%s\\n' 'failed to refresh available models' >&2
printf '%s\\n' '{"status":"completed","summary":"Готово."}' > "$output"
`,
  );
  await chmod(codex, 0o755);

  const originalPath = process.env.PATH;
  const originalLog = console.log;
  const terminal: string[] = [];
  let running: ReturnType<typeof runAgent> | undefined;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => {
    terminal.push(values.join(" "));
  };
  try {
    running = runAgent({
      agent: "codex",
      cwd: root,
      prompt: "Implement.",
      model: "",
      reasoning: "medium",
      gitDirectory: root,
      log: {
        directory: logs,
        startedAt: "2026-07-30T13:44:12.749Z",
        iteration: 1,
      },
      logName: "LFI-2",
      idleTimeoutMinutes: 1,
      isolationProvider: "none",
      prefix: "lfi-2",
    });

    const liveLog = await waitForFileContent(
      join(logs, "LFI-2.log"),
      /Проверяю формат логов\./u,
    );
    assert.match(liveLog, /sed -n '1,40p' src\/codex\.ts/u);
    await writeFile(release, "");
    const result = await running;
    assert.equal(result.status, "completed");
  } finally {
    await writeFile(release, "");
    await running?.catch(() => undefined);
    console.log = originalLog;
    process.env.PATH = originalPath;
  }

  assert.deepEqual(terminal, ["[lfi-2] Проверяю формат логов."]);
  const taskLog = await readFile(join(logs, "LFI-2.log"), "utf8");
  assert.match(
    taskLog,
    /Run started: 2026-07-30T13:44:12\.749Z; iteration: 1/u,
  );
  assert.match(taskLog, /sed -n '1,40p' src\/codex\.ts/u);
  assert.match(taskLog, /Проверяю формат логов\./u);
  assert.match(taskLog, /turn\.completed input=120 output=30/u);
  assert.match(taskLog, /failed to refresh available models/u);
  assert.match(taskLog, /status=completed/u);
  assert.deepEqual(
    (await readdir(logs, { recursive: true })).filter((path) =>
      path.endsWith(".jsonl.gz") || path.endsWith(".schema.json"),
    ),
    [],
  );
});
