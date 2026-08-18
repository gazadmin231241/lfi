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
  defaultDshProvider,
  dshModelSelection,
  dshProfileName,
  dshReasoningEffort,
  expandSkillPlaceholders,
  isUnavailableModelError,
  isUnsupportedReasoningError,
  resolveAgentProfile,
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

test("Codex provider grants its sandbox explicitly declared output directories", () => {
  const invocation = buildAgentInvocation({
    agent: "codex",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "gpt-test",
    reasoning: "high",
    prompt: completionInstruction,
    writableDirectories: ["/repository/.lfi/logs"],
  });

  assert.deepEqual(
    invocation.args.slice(
      invocation.args.indexOf("/repository/.git") + 1,
      invocation.args.indexOf("-c"),
    ),
    ["--add-dir", "/repository/.lfi/logs"],
  );
});

test("pi withholds excluded tools and omits the flag when none are configured", () => {
  const withoutDenylist = buildAgentInvocation({
    agent: "pi",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "opencode-go/deepseek-v4-pro",
    reasoning: "high",
    prompt: completionInstruction,
    excludedTools: [],
  });
  const withDenylist = buildAgentInvocation({
    agent: "pi",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "opencode-go/deepseek-v4-pro",
    reasoning: "high",
    prompt: completionInstruction,
    excludedTools: ["clarify_prompt", "subagent"],
  });

  assert.equal(withoutDenylist.args.includes("--exclude-tools"), false);
  assert.deepEqual(withDenylist.args.slice(-2), [
    "--exclude-tools",
    "clarify_prompt,subagent",
  ]);
});

test("Codex ignores an excluded tool denylist it cannot honour", () => {
  const invocation = buildAgentInvocation({
    agent: "codex",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "gpt-test",
    reasoning: "high",
    prompt: completionInstruction,
    excludedTools: ["clarify_prompt"],
  });

  assert.equal(invocation.args.includes("--exclude-tools"), false);
});

test("each agent provider declares only its own configuration profile", () => {
  const home = "/home/agent";
  const codex = resolveAgentProfile("codex", home, {});
  const pi = resolveAgentProfile("pi", home, {});

  assert.deepEqual(codex.paths, [
    "/home/agent/.codex/config.toml",
    "/home/agent/.codex/hooks",
    "/home/agent/.codex/agents",
    "/home/agent/.codex/AGENTS.md",
    "/home/agent/.codex/auth.json",
  ]);
  assert.deepEqual(pi.paths, [
    "/home/agent/.pi/agent/settings.json",
    "/home/agent/.pi/agent/extensions",
    "/home/agent/.pi/agent/agents",
    "/home/agent/.pi/agent/subagents.json",
    "/home/agent/.pi/agent/AGENTS.md",
    "/home/agent/.pi/agent/auth.json",
  ]);
  assert.equal(codex.skillsDirectory, "/home/agent/.agents/skills");
  assert.equal(pi.skillsDirectory, codex.skillsDirectory);

  const excludedPathsByAgent = new Map([
    [codex, [
      "/home/agent/.config/gh",
      "/home/agent/.ssh",
      "/home/agent/.git-credentials",
      "/home/agent/.netrc",
      "/home/agent/.codex/history.jsonl",
      "/home/agent/.codex/sessions",
      "/home/agent/.codex/attachments",
      "/home/agent/.codex/browser",
      "/home/agent/.codex/cache",
    ]],
    [pi, [
      "/home/agent/.config/gh",
      "/home/agent/.ssh",
      "/home/agent/.git-credentials",
      "/home/agent/.netrc",
      "/home/agent/.pi/agent/history.jsonl",
      "/home/agent/.pi/agent/sessions",
      "/home/agent/.pi/agent/attachments",
      "/home/agent/.pi/agent/browser",
      "/home/agent/.pi/agent/cache",
    ]],
  ]);
  for (const [profile, excludedPaths] of excludedPathsByAgent) {
    for (const path of excludedPaths) {
      assert.equal(profile.paths.includes(path), false);
    }
  }
});

test("the codex profile follows CODEX_HOME when the environment relocates it", () => {
  const home = "/home/agent";
  const relocated = resolveAgentProfile("codex", home, {
    CODEX_HOME: "/home/agent/.config/orca/codex-runtime-home/home",
  });

  assert.equal(
    relocated.stateDirectory,
    "/home/agent/.config/orca/codex-runtime-home/home",
  );
  assert.deepEqual(relocated.paths, [
    "/home/agent/.config/orca/codex-runtime-home/home/config.toml",
    "/home/agent/.config/orca/codex-runtime-home/home/hooks",
    "/home/agent/.config/orca/codex-runtime-home/home/agents",
    "/home/agent/.config/orca/codex-runtime-home/home/AGENTS.md",
    "/home/agent/.config/orca/codex-runtime-home/home/auth.json",
  ]);
  assert.equal(relocated.skillsDirectory, "/home/agent/.agents/skills");

  const pi = resolveAgentProfile("pi", home, {
    CODEX_HOME: "/home/agent/.config/orca/codex-runtime-home/home",
  });
  assert.equal(pi.stateDirectory, "/home/agent/.pi/agent");
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
printf '%s\\n' '{"type":"tool_execution_start","toolName":"read","args":{"path":"src/pi.ts"}}'
printf '%s\\n' '{"type":"tool_execution_start","toolName":"bash","args":{"command":"pnpm test"}}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking","thinking":"**Планирую запуск тестов**\\n\\nДетали рассуждения."},{"type":"toolCall","name":"bash"}]}}'
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

  assert.deepEqual(terminal, [
    "[lfi-2] $ pnpm test",
    "[lfi-2] Планирую запуск тестов",
    "[lfi-2] Проверяю Pi.",
  ]);
  const taskLog = await readFile(join(logs, "LFI-2.log"), "utf8");
  assert.match(taskLog, /\$ pnpm test/u);
  assert.match(taskLog, /\$ read/u);
  assert.match(taskLog, /Проверяю Pi\./u);
  assert.match(taskLog, /Authentication failed: invalid API key/u);
});

test("Claude provider builds a stream-json invocation without spawning a process", () => {
  const invocation = buildAgentInvocation({
    agent: "claude",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "sonnet",
    reasoning: "xhigh",
    prompt: completionInstruction,
    writableDirectories: ["/repository/.lfi/logs"],
    excludedTools: ["WebSearch", "Task"],
  });

  assert.equal(invocation.command, "claude");
  assert.deepEqual(invocation.args, [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--dangerously-skip-permissions",
    "--add-dir",
    "/repository/.git",
    "--add-dir",
    "/repository/.lfi/logs",
    "--effort",
    "xhigh",
    "--disallowed-tools",
    "WebSearch,Task",
    "--model",
    "sonnet",
  ]);
  assert.equal(invocation.input, completionInstruction);
});

test("Claude provider omits the denylist flag when no tools are excluded", () => {
  const invocation = buildAgentInvocation({
    agent: "claude",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "sonnet",
    reasoning: "high",
    prompt: completionInstruction,
    excludedTools: [],
  });

  assert.equal(invocation.args.includes("--disallowed-tools"), false);
});

test("Claude provider declares its own profile and keeps account state writable", () => {
  const home = "/home/agent";
  const claude = resolveAgentProfile("claude", home, {});

  assert.equal(claude.stateDirectory, "/home/agent/.claude");
  assert.deepEqual(claude.paths, [
    "/home/agent/.claude/settings.json",
    "/home/agent/.claude/.credentials.json",
    "/home/agent/.claude/agents",
    "/home/agent/.claude/skills",
    "/home/agent/.claude/plugins",
    "/home/agent/.claude/CLAUDE.md",
  ]);
  assert.deepEqual(claude.writablePaths, [
    "/home/agent/.claude",
    "/home/agent/.claude.json",
  ]);
  assert.equal(claude.skillsDirectory, "/home/agent/.agents/skills");
  for (const excluded of [
    "/home/agent/.claude/history.jsonl",
    "/home/agent/.claude/projects",
    "/home/agent/.claude/todos",
    "/home/agent/.claude/shell-snapshots",
  ]) {
    assert.equal(claude.paths.includes(excluded), false);
  }

  const relocated = resolveAgentProfile("claude", home, {
    CLAUDE_CONFIG_DIR: "/home/agent/.config/claude-runtime",
  });
  assert.equal(relocated.stateDirectory, "/home/agent/.config/claude-runtime");
  assert.equal(
    relocated.paths[0],
    "/home/agent/.config/claude-runtime/settings.json",
  );
});

test("Claude provider expands skill placeholders and recognises unavailable models", () => {
  assert.equal(
    expandSkillPlaceholders("claude", "Use {{SKILL:implement}} then {{SKILL:code-review}}."),
    "Use /implement then /code-review.",
  );
  assert.equal(
    isUnavailableModelError("claude", "Invalid model name: sonnet5"),
    true,
  );
  assert.equal(isUnavailableModelError("claude", "network request failed"), false);
});

test("Claude provider streams event details and reports a failed turn in its summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-claude-output-"));
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  await mkdir(bin, { recursive: true });
  const claude = join(bin, "claude");
  await writeFile(
    claude,
    `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"type":"system","subtype":"init","tools":["Bash"]}'
printf '%s\\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"**Планирую запуск тестов**\\n\\nДетали рассуждения."},{"type":"tool_use","name":"Read","input":{"file_path":"src/claude.ts"}},{"type":"tool_use","name":"Bash","input":{"command":"pnpm test"}}]}}'
printf '%s\\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Проверяю Claude."}]}}'
printf '%s\\n' '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Credit balance is too low","usage":{"input_tokens":120,"output_tokens":34}}'
exit 1
`,
  );
  await chmod(claude, 0o755);

  const originalPath = process.env.PATH;
  const originalLog = console.log;
  const terminal: string[] = [];
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => {
    terminal.push(values.join(" "));
  };
  try {
    const result = await runAgent({
      agent: "claude",
      cwd: root,
      prompt: completionInstruction,
      model: "sonnet",
      reasoning: "medium",
      gitDirectory: root,
      log: { directory: logs, startedAt: "2026-08-17T13:44:12.749Z", iteration: 1 },
      logName: "LFI-5",
      idleTimeoutMinutes: 1,
      isolationProvider: "none",
      prefix: "lfi-5",
      language: "en",
    });
    assert.equal(result.status, undefined);
    assert.match(result.summary, /Credit balance is too low/u);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }

  assert.deepEqual(terminal, [
    "[lfi-5] Планирую запуск тестов",
    "[lfi-5] $ pnpm test",
    "[lfi-5] Проверяю Claude.",
  ]);
  const taskLog = await readFile(join(logs, "LFI-5.log"), "utf8");
  assert.match(taskLog, /\$ pnpm test/u);
  assert.match(taskLog, /\$ Read/u);
  assert.match(taskLog, /result input=120 output=34/u);
  assert.match(taskLog, /Credit balance is too low/u);
});

test("dsh provider carries its settings in the environment, not in flags", () => {
  const invocation = buildAgentInvocation({
    agent: "dsh",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "deepseek-v4-pro",
    reasoning: "xhigh",
    prompt: completionInstruction,
    writableDirectories: ["/repository/.lfi/logs"],
    excludedTools: ["web_search", "todo_write"],
  });

  assert.equal(invocation.command, "dsh");
  assert.deepEqual(invocation.args, [
    "--profile",
    dshProfileName,
    completionInstruction,
  ]);
  // The harness reads its task from argv, so nothing is written to stdin.
  assert.equal(invocation.input, "");
  assert.deepEqual(invocation.environment, {
    LFI_DSH_REASONING: "max",
    LFI_DSH_PROVIDER: "deepseek-official",
    LFI_DSH_MODEL: "deepseek-v4-pro",
    LFI_DSH_DENIED_TOOLS: "web_search,todo_write",
    DSH_PERMISSION_MODE: "danger-full-access",
  });

  const withoutDenylist = buildAgentInvocation({
    agent: "dsh",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "",
    reasoning: "medium",
    prompt: completionInstruction,
    excludedTools: [],
  });
  assert.deepEqual(withoutDenylist.environment, {
    LFI_DSH_REASONING: "low",
    LFI_DSH_PROVIDER: "deepseek-official",
    DSH_PERMISSION_MODE: "danger-full-access",
  });
});

test("a dsh model may name the harness route that bills it", () => {
  assert.deepEqual(dshModelSelection("opencode-go/deepseek-v4-pro"), {
    provider: "opencode-go",
    model: "deepseek-v4-pro",
  });
  // A model id carrying its own slashes keeps every one past the first.
  assert.deepEqual(dshModelSelection("opencode-go/vendor/model-9"), {
    provider: "opencode-go",
    model: "vendor/model-9",
  });
  // Nothing to split: the native DeepSeek adapter serves it.
  assert.deepEqual(dshModelSelection("deepseek-v4-pro"), {
    provider: defaultDshProvider,
    model: "deepseek-v4-pro",
  });
  assert.deepEqual(dshModelSelection(""), { provider: defaultDshProvider });
  assert.deepEqual(dshModelSelection(undefined), { provider: defaultDshProvider });
  // A dangling separator is a model id, not a route with no model behind it.
  assert.deepEqual(dshModelSelection("opencode-go/"), {
    provider: defaultDshProvider,
    model: "opencode-go/",
  });

  const invocation = buildAgentInvocation({
    agent: "dsh",
    cwd: "/worktree",
    gitDirectory: "/repository/.git",
    model: "opencode-go/deepseek-v4-flash",
    reasoning: "low",
    prompt: completionInstruction,
  });
  assert.deepEqual(invocation.environment, {
    LFI_DSH_REASONING: "low",
    LFI_DSH_PROVIDER: "opencode-go",
    LFI_DSH_MODEL: "deepseek-v4-flash",
    DSH_PERMISSION_MODE: "danger-full-access",
  });
});

test("dsh reasoning stays monotonic across the DeepSeek scale", () => {
  assert.deepEqual(
    (["low", "medium", "high", "xhigh", "max"] as const).map(dshReasoningEffort),
    ["low", "low", "high", "max", "max"],
  );
});

test("dsh provider declares its own profile and keeps the harness home writable", () => {
  const home = "/home/agent";
  const dsh = resolveAgentProfile("dsh", home, {});

  assert.equal(dsh.stateDirectory, "/home/agent/.dsh");
  assert.deepEqual(dsh.paths, [
    "/home/agent/.dsh/profiles",
    "/home/agent/.dsh/settings.yaml",
    "/home/agent/.dsh/cordis.patch.yml",
    "/home/agent/.dsh/.credentials.yaml",
    "/home/agent/.dsh/.env",
  ]);
  assert.deepEqual(dsh.writablePaths, ["/home/agent/.dsh"]);
  // The harness already scans ~/.agents/skills as its user-agents skill root,
  // so LFI's installed skills need no second copy.
  assert.equal(dsh.skillsDirectory, "/home/agent/.agents/skills");

  const relocated = resolveAgentProfile("dsh", home, { DSH_HOME: "/srv/dsh" });
  assert.equal(relocated.stateDirectory, "/srv/dsh");
  assert.deepEqual(relocated.writablePaths, ["/srv/dsh"]);
});

test("dsh provider names skills in prose and recognises unavailable models", () => {
  assert.equal(
    expandSkillPlaceholders("dsh", "Use {{SKILL:implement}} then {{SKILL:code-review}}."),
    'Use the "implement" skill then the "code-review" skill.',
  );
  assert.equal(isUnavailableModelError("dsh", "Model Not Exist"), true);
  assert.equal(isUnavailableModelError("dsh", "network request failed"), false);
});

test("dsh reports a reasoning level its route does not offer as its own refusal", () => {
  const refusal =
    'UNSUPPORTED_REASONING_EFFORT: pi-ai provider "opencode-go" model "deepseek-v4-pro" does not support reasoning effort "low"';
  assert.equal(isUnsupportedReasoningError("dsh", refusal), true);
  // The two refusals stay distinct: a level the model lacks is not a missing
  // model, and LFI's message for each says which one happened.
  assert.equal(isUnavailableModelError("dsh", refusal), false);
  assert.equal(isUnsupportedReasoningError("dsh", "Model Not Exist"), false);
  // The other agents validate the level in their own argument parsing, so this
  // refusal never reaches a provider and LFI does not claim to recognise it.
  assert.equal(isUnsupportedReasoningError("claude", refusal), false);
});

test("dsh provider reads the streamed session log and reports why a turn ended", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-dsh-output-"));
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  await mkdir(bin, { recursive: true });
  const dsh = join(bin, "dsh");
  // The fake harness echoes the settings LFI passed through the environment, so
  // the test covers the invocation contract and the parser in one run.
  await writeFile(
    dsh,
    `#!/bin/sh
printf '%s\\n' '{"type":"turn/start","seq":1,"time":1,"data":{"turn":1}}'
printf '%s\\n' '{"type":"assistant/message","seq":2,"time":2,"data":{"turn":1,"step":1,"message":{"content":[{"type":"reasoning","text":"**Планирую запуск тестов**\\n\\nДетали рассуждения."}]},"usage":{"inputTokens":120,"outputTokens":34}}}'
printf '%s\\n' '{"type":"assistant/chunk","seq":3,"time":3,"data":{"chunk":{"type":"text-delta"}}}'
printf '%s\\n' '{"type":"tool/call","seq":4,"time":4,"data":{"turn":1,"step":1,"callId":"c1","name":"str_replace_editor","arguments":"{\\"path\\":\\"src/dsh.ts\\"}"}}'
printf '%s\\n' '{"type":"tool/call","seq":5,"time":5,"data":{"turn":1,"step":1,"callId":"c2","name":"bash","arguments":"{\\"command\\":\\"pnpm test --effort '"$LFI_DSH_REASONING"'\\"}"}}'
printf '%s\\n' '{"type":"assistant/message","seq":6,"time":6,"data":{"turn":1,"step":2,"message":{"content":[{"type":"text","text":"Проверяю dsh."}]}}}'
printf '%s\\n' '{"type":"turn/end","seq":7,"time":7,"data":{"turn":1,"reason":{"kind":"error","error":{"code":"QUOTA","message":"Insufficient balance"}}}}'
printf '%s\\n' 'Проверяю dsh.'
exit 1
`,
  );
  await chmod(dsh, 0o755);

  const originalPath = process.env.PATH;
  const originalLog = console.log;
  const terminal: string[] = [];
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => {
    terminal.push(values.join(" "));
  };
  try {
    const result = await runAgent({
      agent: "dsh",
      cwd: root,
      prompt: completionInstruction,
      model: "deepseek-v4-pro",
      reasoning: "high",
      gitDirectory: root,
      log: { directory: logs, startedAt: "2026-08-17T13:44:12.749Z", iteration: 1 },
      logName: "LFI-7",
      idleTimeoutMinutes: 1,
      isolationProvider: "none",
      prefix: "lfi-7",
      language: "en",
    });
    assert.equal(result.status, undefined);
    assert.match(result.summary, /QUOTA: Insufficient balance/u);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }

  assert.deepEqual(terminal, [
    "[lfi-7] Планирую запуск тестов",
    "[lfi-7] $ pnpm test --effort high",
    "[lfi-7] Проверяю dsh.",
  ]);
  const taskLog = await readFile(join(logs, "LFI-7.log"), "utf8");
  assert.match(taskLog, /\$ str_replace_editor/u);
  assert.match(taskLog, /usage input=120 output=34/u);
  assert.match(taskLog, /turn ended: error QUOTA: Insufficient balance/u);
});

test("an agent that lingers after its completion block still reports success", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-pi-lingering-"));
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  await mkdir(bin, { recursive: true });
  const pi = join(bin, "pi");
  await writeFile(
    pi,
    `#!/bin/sh
cat >/dev/null
printf '%s\\n' '${JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{
          type: "text",
          text: '<lfi:completion>\n{"status":"completed","summary":"Готово."}\n</lfi:completion>',
        }],
      },
    })}'
# Outlive the completion the way a stuck agent process does.
sleep 120
`,
  );
  await chmod(pi, 0o755);

  const originalPath = process.env.PATH;
  const originalLog = console.log;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  console.log = () => undefined;
  try {
    const result = await runAgent({
      agent: "pi",
      cwd: root,
      prompt: completionInstruction,
      model: "openai/gpt-test",
      reasoning: "medium",
      gitDirectory: root,
      log: { directory: logs, startedAt: "2026-07-30T13:44:12.749Z", iteration: 1 },
      logName: "LFI-4",
      idleTimeoutMinutes: 60,
      isolationProvider: "none",
      prefix: "lfi-4",
      language: "en",
      completionGraceMs: 50,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.exitCode, 0);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }

  const taskLog = await readFile(join(logs, "LFI-4.log"), "utf8");
  assert.match(taskLog, /exit=0 \(closed after completion\)/u);
  assert.match(taskLog, /status=completed/u);
});

test("agent output keeps multi-byte characters intact across chunk boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-pi-encoding-"));
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  await mkdir(bin, { recursive: true });
  // Long enough that the text is delivered in several stdout chunks, each of
  // which can end mid-character.
  const text = "Проверяю кодировку. ".repeat(6000);
  const pi = join(bin, "pi");
  await writeFile(
    pi,
    `#!/bin/sh
cat >/dev/null
cat <<'EVENT'
${JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{
          type: "text",
          text: `${text}<lfi:completion>\n{"status":"completed","summary":"Готово."}\n</lfi:completion>`,
        }],
      },
    })}
EVENT
`,
  );
  await chmod(pi, 0o755);

  const originalPath = process.env.PATH;
  const originalLog = console.log;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  console.log = () => undefined;
  try {
    const result = await runAgent({
      agent: "pi",
      cwd: root,
      prompt: completionInstruction,
      model: "openai/gpt-test",
      reasoning: "medium",
      gitDirectory: root,
      log: { directory: logs, startedAt: "2026-07-30T13:44:12.749Z", iteration: 1 },
      logName: "LFI-3",
      idleTimeoutMinutes: 1,
      isolationProvider: "none",
      prefix: "lfi-3",
      language: "en",
    });
    assert.equal(result.status, "completed");
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }

  const taskLog = await readFile(join(logs, "LFI-3.log"), "utf8");
  assert.equal(taskLog.includes("�"), false);
  assert.equal(taskLog.includes(text), true);
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
printf '%s\\n' '{"type":"item.completed","item":{"type":"reasoning","text":"**Читаю формат логов**\\n\\nПодробности рассуждения."}}'
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
    "[lfi-2] Читаю формат логов",
    "[lfi-2] $ sed -n '1,40p' src/codex.ts",
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
