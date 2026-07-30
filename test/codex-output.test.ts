import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCodex } from "../src/codex.js";

test("runCodex keeps commands and stderr in the task log while streaming agent messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-codex-output-"));
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(bin, { recursive: true }),
  );
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
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":30}}'
printf '%s\\n' 'failed to refresh available models' >&2
printf '%s\\n' '{"status":"completed","summary":"Готово."}' > "$output"
`,
  );
  await chmod(codex, 0o755);

  const originalPath = process.env.PATH;
  const originalLog = console.log;
  const terminal: string[] = [];
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => {
    terminal.push(values.join(" "));
  };
  try {
    const result = await runCodex({
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
      prefix: "lfi-2",
    });

    assert.equal(result.status, "completed");
  } finally {
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
  assert.match(taskLog, /failed to refresh available models/u);
  assert.match(taskLog, /status=completed/u);
  assert.deepEqual(
    (await readdir(logs, { recursive: true })).filter((path) =>
      path.endsWith(".jsonl.gz"),
    ),
    [],
  );
});
