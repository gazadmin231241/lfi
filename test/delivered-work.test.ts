import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, serializeEnvConfig } from "../src/config.js";
import { runCommand } from "../src/process.js";
import { runLfi } from "../src/runner.js";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-delivered-work-"));
  const lfi = join(root, ".lfi");
  const tasks = join(root, ".scratch");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  await mkdir(tasks, { recursive: true });
  await mkdir(lfi, { recursive: true });
  await mkdir(tools);
  await writeFile(join(root, ".gitignore"), ".lfi/*\n");
  await writeFile(join(lfi, "config.env"), serializeEnvConfig({
    ...DEFAULT_CONFIG,
    ISOLATION_PROVIDER: "none",
    VALIDATE_COMMAND: "true",
  }));
  await writeFile(join(lfi, "task-prompt.md"), "Implement the task.\n");
  await writeFile(
    join(tasks, "[READY] LFI-1 — delivered.md"),
    "Type: task\nBlocked by: None\nTier: light\n\nDelivered work.\n",
  );
  await writeFile(join(tools, "codex"), `#!/bin/sh\nprintf 'called\\n' >> "${calls}"\nexit 1\n`);
  await chmod(join(tools, "codex"), 0o755);
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runCommand("git", args, { cwd });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "LFI Test");
  await git(root, "config", "user.email", "lfi@example.test");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test: initialize repository");
  const remote = await mkdtemp(join(tmpdir(), "lfi-delivered-origin-"));
  await git(root, "init", "--bare", "-b", "main", remote);
  await git(root, "remote", "add", "origin", remote);
  await git(root, "push", "-u", "origin", "main");
  return { root, tasks, tools, calls, remote, git };
};

const commitToRemote = async (
  remote: string,
  mutate: (seed: string) => Promise<void>,
): Promise<void> => {
  const seed = await mkdtemp(join(tmpdir(), "lfi-delivered-seed-"));
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: seed });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  const clone = await runCommand("git", ["clone", remote, seed]);
  assert.equal(clone.exitCode, 0, clone.stderr);
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await mutate(seed);
  await git("add", ".");
  await git("commit", "-m", "test: deliver remote work");
  await git("push", "origin", "main");
};

test("run fast-forwards delivered tracker work before selecting tasks", async () => {
  const subject = await fixture();
  await commitToRemote(subject.remote, (seed) =>
    runCommand("git", [
      "mv",
      ".scratch/[READY] LFI-1 — delivered.md",
      ".scratch/[DONE] LFI-1 — delivered.md",
    ], { cwd: seed }).then((result) => assert.equal(result.exitCode, 0, result.stderr)),
  );
  const terminal: string[] = [];
  const originalPath = process.env.PATH;
  const originalLog = console.log;
  process.env.PATH = `${subject.tools}:${originalPath ?? ""}`;
  console.log = (...values: unknown[]) => terminal.push(values.join(" "));
  try {
    assert.equal(await runLfi(subject.root, "en"), 0);
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
  }
  assert.match(terminal.join("\n"), /Local main fast-forwarded to origin\/main/u);
  await assert.rejects(readFile(join(subject.tasks, "[READY] LFI-1 — delivered.md"), "utf8"));
  await readFile(join(subject.tasks, "[DONE] LFI-1 — delivered.md"), "utf8");
  await assert.rejects(readFile(subject.calls, "utf8"));
});

test("run refuses a diverged default branch before handing work to an agent", async () => {
  const subject = await fixture();
  await commitToRemote(subject.remote, (seed) =>
    writeFile(join(seed, "delivered.txt"), "delivered\n"),
  );
  await writeFile(join(subject.root, "local.txt"), "local\n");
  await subject.git(subject.root, "add", "local.txt");
  await subject.git(subject.root, "commit", "-m", "test: local work");
  const originalPath = process.env.PATH;
  process.env.PATH = `${subject.tools}:${originalPath ?? ""}`;
  try {
    await assert.rejects(
      runLfi(subject.root, "en"),
      /Reconcile before starting a run: git merge --ff-only origin\/main/u,
    );
  } finally {
    process.env.PATH = originalPath;
  }
  await assert.rejects(readFile(subject.calls, "utf8"));
  const head = await runCommand("git", ["log", "-1", "--format=%s"], {
    cwd: subject.root,
  });
  assert.equal(head.stdout.trim(), "test: local work");
});

test("run refuses a non-default checkout without changing it", async () => {
  const subject = await fixture();
  await subject.git(subject.root, "switch", "-c", "feature");
  await commitToRemote(subject.remote, (seed) =>
    writeFile(join(seed, "delivered.txt"), "delivered\n"),
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${subject.tools}:${originalPath ?? ""}`;
  try {
    await assert.rejects(
      runLfi(subject.root, "en"),
      /A run must start on local main[\s\S]*git switch main/u,
    );
  } finally {
    process.env.PATH = originalPath;
  }
  const branch = await runCommand("git", ["branch", "--show-current"], {
    cwd: subject.root,
  });
  assert.equal(branch.stdout.trim(), "feature");
  await assert.rejects(readFile(subject.calls, "utf8"));
});
