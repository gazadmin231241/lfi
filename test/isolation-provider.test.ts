import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeAgentEnvironment,
  wrapWithIsolation,
} from "../src/isolation-provider.js";

const stdoutLines: string[] = [];
const stderrLines: string[] = [];
const command = {
  command: "codex",
  args: ["exec", "-"],
  input: "A prompt long enough to belong on standard input.",
  idleTimeoutMs: 60_000,
  onStdoutLine: (line: string) => stdoutLines.push(line),
  onStderrLine: (line: string) => stderrLines.push(line),
  environment: sanitizeAgentEnvironment(
    {
      PATH: "/tools",
      HOME: "/home/agent",
      OPENAI_API_KEY: "agent-api-test-value",
      GH_TOKEN: "code-host-test-value",
      GIT_CONFIG_PARAMETERS: "'http.extraheader=authorization: test'",
    },
    { name: "Agent", email: "agent@example.test" },
  ),
};

test("local isolation wraps a command without spawning a process", () => {
  const wrapped = wrapWithIsolation(command, {
    provider: "local",
    worktree: "/workspace/task",
    gitDirectory: "/repository/.git",
    homeDirectory: "/home/agent",
    codeHostCredentialDirectories: [
      "/home/agent/.ssh",
      "/home/agent/.config/gh",
      "/home/agent/.config/glab-cli",
    ],
    codeHostCredentialFiles: ["/home/agent/.git-credentials"],
    gitConfigFiles: ["/repository/.git/config"],
    sanitizedGitConfig: "/repository/.git/lfi-agent/safe-git-config",
  });

  assert.equal(wrapped.command, "bwrap");
  assert.deepEqual(wrapped.args.slice(-4), [
    "--",
    "codex",
    "exec",
    "-",
  ]);
  assert.equal(wrapped.input, command.input);
  assert.equal(wrapped.idleTimeoutMs, 60_000);
  assert.strictEqual(wrapped.onStdoutLine, command.onStdoutLine);
  assert.strictEqual(wrapped.onStderrLine, command.onStderrLine);
  assert.equal(wrapped.environment.GH_TOKEN, undefined);
  assert.equal(wrapped.environment.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(wrapped.environment.OPENAI_API_KEY, "agent-api-test-value");
  assert.equal(wrapped.environment.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.deepEqual(
    wrapped.args.slice(
      wrapped.args.indexOf("--ro-bind"),
      wrapped.args.indexOf("--ro-bind") + 3,
    ),
    ["--ro-bind", "/", "/"],
  );
  assert.ok(
    wrapped.args.some(
      (value, index) =>
        value === "--bind" &&
        wrapped.args[index + 1] === "/workspace/task" &&
        wrapped.args[index + 2] === "/workspace/task",
    ),
  );
  assert.ok(
    wrapped.args.indexOf("--tmpfs") < wrapped.args.indexOf("--bind"),
    "the temporary filesystem must be mounted before a worktree below /tmp",
  );
  assert.ok(
    wrapped.args.some(
      (value, index) =>
        value === "--bind" &&
        wrapped.args[index + 1] === "/repository/.git" &&
        wrapped.args[index + 2] === "/repository/.git",
    ),
  );
  assert.ok(
    wrapped.args.some(
      (value, index) =>
        value === "--tmpfs" && wrapped.args[index + 1] === "/tmp",
    ),
  );
  assert.equal(wrapped.args.includes("--unshare-net"), false);
  assert.equal(wrapped.args.includes("--dev-bind"), false);
  assert.ok(
    wrapped.args.some(
      (value, index) =>
        value === "--dev" && wrapped.args[index + 1] === "/dev",
    ),
  );
});

test("local isolation hides code-host credentials and exposes package caches", () => {
  const wrapped = wrapWithIsolation(command, {
    provider: "local",
    worktree: "/workspace/task",
    gitDirectory: "/repository/.git",
    homeDirectory: "/home/agent",
    codeHostCredentialDirectories: [
      "/home/agent/.ssh",
      "/home/agent/.config/gh",
      "/home/agent/.config/glab-cli",
    ],
    codeHostCredentialFiles: ["/home/agent/.git-credentials"],
    gitConfigFiles: ["/repository/.git/config"],
    sanitizedGitConfig: "/repository/.git/lfi-agent/safe-git-config",
  });

  for (const path of [
    "/home/agent/.ssh",
    "/home/agent/.config/gh",
    "/home/agent/.config/glab-cli",
  ]) {
    assert.ok(
      wrapped.args.some(
        (value, index) =>
          value === "--tmpfs" && wrapped.args[index + 1] === path,
      ),
    );
  }
  assert.ok(
    wrapped.args.some(
      (value, index) =>
        value === "--bind" &&
        wrapped.args[index + 1] ===
          "/repository/.git/lfi-agent/safe-git-config" &&
        wrapped.args[index + 2] === "/repository/.git/config",
    ),
  );
  for (const path of [
    "/home/agent/.npm",
    "/home/agent/.local/share/pnpm/store",
    "/home/agent/.cache/node/corepack",
  ]) {
    assert.ok(
      wrapped.args.some(
        (value, index) =>
          value === "--bind-try" &&
          wrapped.args[index + 1] === path &&
          wrapped.args[index + 2] === path,
      ),
    );
  }
});

test("none isolation returns the command unchanged", () => {
  const wrapped = wrapWithIsolation(command, {
    provider: "none",
    worktree: "/workspace/task",
    gitDirectory: "/repository/.git",
    homeDirectory: "/home/agent",
    codeHostCredentialDirectories: [],
    codeHostCredentialFiles: [],
    gitConfigFiles: [],
    sanitizedGitConfig: "/repository/.git/lfi-agent/safe-git-config",
  });

  assert.strictEqual(wrapped, command);
});
