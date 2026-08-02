import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  openIsolationSession,
  resolveIsolationDeclaration,
  sanitizeAgentEnvironment,
  withIsolationSession,
} from "../src/isolation-provider.js";
import { resolveAgentProfile } from "../src/agent-provider.js";

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

test("local isolation session runs commands without changing boundary mechanics", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-isolation-session-"));
  const gitDirectory = join(root, "repository", ".git");
  const homeDirectory = join(root, "home", "agent");
  await Promise.all([
    mkdir(join(homeDirectory, ".ssh"), { recursive: true }),
    mkdir(join(homeDirectory, ".config", "gh"), { recursive: true }),
    mkdir(join(homeDirectory, ".config", "glab-cli"), { recursive: true }),
    mkdir(gitDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(homeDirectory, ".git-credentials"), "secret"),
    writeFile(join(gitDirectory, "config"), "unsafe"),
  ]);
  const session = await openIsolationSession({
    provider: "local",
    agent: "codex",
    worktree: "/workspace/task",
    gitDirectory,
    homeDirectory,
    environment: command.environment,
  });
  const wrapped = session.prepare(command);

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
        wrapped.args[index + 1] === gitDirectory &&
        wrapped.args[index + 2] === gitDirectory,
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
  await session.close();
  await rm(root, { recursive: true, force: true });
});

test("local isolation derives credential exclusions and package caches on open", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-isolation-session-"));
  const gitDirectory = join(root, "repository", ".git");
  const homeDirectory = join(root, "home", "agent");
  await Promise.all([
    mkdir(join(homeDirectory, ".ssh"), { recursive: true }),
    mkdir(join(homeDirectory, ".config/gh"), { recursive: true }),
    mkdir(join(homeDirectory, ".config/glab-cli"), { recursive: true }),
    mkdir(gitDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(homeDirectory, ".git-credentials"), "secret"),
    writeFile(join(gitDirectory, "config"), "unsafe"),
  ]);
  const session = await openIsolationSession({
    provider: "local",
    agent: "codex",
    worktree: "/workspace/task",
    gitDirectory,
    homeDirectory,
    environment: command.environment,
  });
  const wrapped = session.prepare(command);

  for (const path of [
    join(homeDirectory, ".ssh"),
    join(homeDirectory, ".config/gh"),
    join(homeDirectory, ".config/glab-cli"),
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
        wrapped.args[index + 1]?.endsWith("/safe-git-config") &&
        wrapped.args[index + 2] === join(gitDirectory, "config"),
    ),
  );
  for (const path of [
    join(homeDirectory, ".npm"),
    join(homeDirectory, ".local/share/pnpm/store"),
    join(homeDirectory, ".cache/node/corepack"),
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
  await session.close();
  await rm(root, { recursive: true, force: true });
});

test("none isolation session returns commands unchanged", async () => {
  const session = await openIsolationSession({
    provider: "none",
    agent: "codex",
    worktree: "/workspace/task",
    gitDirectory: "/repository/.git",
    homeDirectory: "/home/agent",
    environment: command.environment,
  });
  const wrapped = session.prepare(command);

  assert.strictEqual(wrapped, command);
  await session.close();
});

test("boundary declarations contain the selected agent profile and shared skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-isolation-declaration-"));
  const gitDirectory = join(root, "repository", ".git");
  const homeDirectory = join(root, "home", "agent");
  await Promise.all([
    mkdir(gitDirectory, { recursive: true }),
    mkdir(join(homeDirectory, ".ssh"), { recursive: true }),
    mkdir(join(homeDirectory, ".config", "gh"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(homeDirectory, ".git-credentials"), "code-host credential"),
    writeFile(join(homeDirectory, ".netrc"), "code-host credential"),
  ]);
  for (const agent of ["codex", "pi"] as const) {
    const declaration = await resolveIsolationDeclaration({
      agent,
      worktree: "/workspace/task",
      gitDirectory,
      homeDirectory,
      environment: command.environment,
    }, join(gitDirectory, "safe-git-config"));

    const profile = resolveAgentProfile(agent, homeDirectory);
    assert.deepEqual(declaration.agentProfilePaths, profile.paths);
    assert.equal(declaration.skillsDirectory, profile.skillsDirectory);
    const boundaryPaths = [
      ...declaration.agentProfilePaths,
      declaration.skillsDirectory,
    ];
    for (const excluded of [
      join(homeDirectory, `.${agent === "codex" ? "codex" : "pi/agent"}/history.jsonl`),
      join(homeDirectory, `.${agent === "codex" ? "codex" : "pi/agent"}/sessions`),
      join(homeDirectory, `.${agent === "codex" ? "codex" : "pi/agent"}/attachments`),
      join(homeDirectory, `.${agent === "codex" ? "codex" : "pi/agent"}/browser`),
      join(homeDirectory, `.${agent === "codex" ? "codex" : "pi/agent"}/cache`),
      join(homeDirectory, ".config/gh"),
      join(homeDirectory, ".ssh"),
      join(homeDirectory, ".git-credentials"),
      join(homeDirectory, ".netrc"),
    ]) {
      assert.equal(boundaryPaths.includes(excluded), false);
    }
  }
  await rm(root, { recursive: true, force: true });
});

test("withIsolationSession closes after failure", async () => {
  let closed = false;
  await assert.rejects(
    withIsolationSession(
      async () => ({
        prepare: <Command>(value: Command) => value,
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        close: async () => { closed = true; },
      }),
      async () => { throw new Error("command failed"); },
    ),
    /command failed/u,
  );
  assert.equal(closed, true);
});
