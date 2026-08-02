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
  expandSkillPlaceholders,
  isUnavailableModelError,
  runAgent,
} from "../src/agent-provider.js";

const completionInstruction = `End your response with this block:
<lfi:completion>
{"status":"completed","summary":"Describe the result."}
</lfi:completion>`;

test("Codex provider builds its invocation without spawning a process", () => {
  const invocation = buildAgentInvocation({
    agent: "codex",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "gpt-test",
    reasoning: "high",
    prompt: completionInstruction,
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
    "--model",
    "gpt-test",
    "-",
  ]);
  assert.equal(invocation.input, completionInstruction);
});

test("Codex provider expands skill placeholders without spawning a process", () => {
  assert.equal(
    expandSkillPlaceholders("codex", "Use {{SKILL:implement}} then {{SKILL:code-review}}."),
    "Use $implement then $code-review.",
  );
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

test("Pi provider builds a JSON-stream invocation without spawning a process", () => {
  const invocation = buildAgentInvocation({
    agent: "pi",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "openai/gpt-5.6:high",
    reasoning: "xhigh",
    prompt: completionInstruction,
  });

  assert.equal(invocation.command, "pi");
  assert.deepEqual(invocation.args, [
    "--mode",
    "json",
    "--no-session",
    "--model",
    "openai/gpt-5.6:high",
    "--thinking",
    "xhigh",
  ]);
  assert.equal(invocation.input, completionInstruction);
});

test("Pi provider expands skill placeholders and recognises unavailable models", () => {
  assert.equal(
    expandSkillPlaceholders("pi", "Use {{SKILL:implement}} then {{SKILL:code-review}}."),
    "Use /skill:implement then /skill:code-review.",
  );
  assert.equal(
    isUnavailableModelError("pi", "No model found matching openai/missing-model"),
    true,
  );
});

test("Pi provider streams event details and reports stdout API errors in its summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-pi-output-"));
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  await mkdir(bin, { recursive: true });
  const pi = join(bin, "pi");
  await writeFile(
    pi,
    `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"type":"tool_execution_start","toolName":"bash","args":{"command":"pnpm test"}}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Проверяю Pi."}]}}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"Authentication failed: invalid API key","content":[]}}'
exit 1
`,
  );
  await chmod(pi, 0o755);

  const originalPath = process.env.PATH;
  const originalLog = console.log;
  const terminal: string[] = [];
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => {
    terminal.push(values.join(" "));
  };
  try {
    const result = await runAgent({
      agent: "pi",
      cwd: root,
      prompt: completionInstruction,
      model: "openai/gpt-test",
      reasoning: "medium",
      gitDirectory: root,
      log: { directory: logs, startedAt: "2026-07-30T13:44:12.749Z", iteration: 1 },
      logName: "LFI-2",
      idleTimeoutMinutes: 1,
      isolationProvider: "none",
      prefix: "lfi-2",
      language: "en",
    });
    assert.equal(result.status, undefined);
    assert.match(result.summary, /Authentication failed: invalid API key/u);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }

  assert.deepEqual(terminal, ["[lfi-2] Проверяю Pi."]);
  const taskLog = await readFile(join(logs, "LFI-2.log"), "utf8");
  assert.match(taskLog, /\$ pnpm test/u);
  assert.match(taskLog, /Проверяю Pi\./u);
  assert.match(taskLog, /Authentication failed: invalid API key/u);
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
printf '%s\\n' '{"type":"item.started","item":{"type":"command_execution","command":"sed -n '\\''1,40p'\\'' src/codex.ts"}}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Проверяю формат логов."}}'
while [ ! -f "${release}" ]; do read -r _ < /dev/null || true; done
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Готово.\\n<lfi:completion>\\n{\\"status\\":\\"completed\\",\\"summary\\":\\"Готово.\\"}\\n</lfi:completion>"}}'
printf '%s' '{"type":"turn.completed","usage":{"input_tokens":120,"output_tokens":30}}'
printf '%s\\n' 'failed to refresh available models' >&2
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
      prompt: completionInstruction,
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
      language: "en",
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

  assert.deepEqual(terminal, [
    "[lfi-2] Проверяю формат логов.",
    `[lfi-2] Готово.
<lfi:completion>
{"status":"completed","summary":"Готово."}
</lfi:completion>`,
  ]);
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

test("runAgent rejects a prompt missing the completion contract before starting Codex", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-codex-preflight-"));
  const bin = join(root, "bin");
  const marker = join(root, "codex-started");
  await mkdir(bin);
  const codex = join(bin, "codex");
  await writeFile(codex, `#!/bin/sh\nprintf started > "${marker}"\n`);
  await chmod(codex, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  try {
    await assert.rejects(
      runAgent({
        agent: "codex",
        cwd: root,
        prompt: "Implement the task.",
        model: "",
        reasoning: "medium",
        gitDirectory: root,
        log: {
          directory: join(root, "logs"),
          startedAt: "2026-07-30T13:44:12.749Z",
          iteration: 1,
        },
        logName: "LFI-2",
        idleTimeoutMinutes: 1,
        isolationProvider: "none",
        prefix: "lfi-2",
        language: "en",
      }),
      /prompt must instruct the agent to emit an LFI completion block/u,
    );
  } finally {
    process.env.PATH = originalPath;
  }

  await assert.rejects(readFile(marker, "utf8"), /ENOENT/u);
});
