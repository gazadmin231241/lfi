import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { attemptWork } from "../src/attempt-work.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { runCommand } from "../src/process.js";
import { codexCompletionEvent } from "./helpers/agent-events.js";

test("a merger that commits reused dirty work does not start a second worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-reused-dirty-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const worktree = join(worktreesRoot, "lfi-1");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  await mkdir(worktreesRoot, { recursive: true });
  await mkdir(tools);
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runCommand("git", args, { cwd });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "LFI Test");
  await git(root, "config", "user.email", "lfi@example.test");
  await writeFile(join(root, "result.txt"), "base\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test: initialize repository");
  await git(root, "worktree", "add", "-b", "lfi/lfi-1", worktree, "main");
  await writeFile(join(worktree, "result.txt"), "task\n");
  await writeFile(join(root, "result.txt"), "main\n");
  await git(root, "commit", "-am", "fix: update main");
  await writeFile(
    join(tools, "codex"),
    `#!/bin/sh
printf 'called\\n' >> "${calls}"
printf 'combined\\n' > result.txt
${codexCompletionEvent("completed", "resolved existing work")}
`,
  );
  await chmod(join(tools, "codex"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const result = await attemptWork({
      cwd: root,
      worktreesRoot,
      baseRef: "main",
      task: {
        id: "LFI-1",
        number: 1,
        title: "Reuse existing work",
        sourcePath: ".scratch/[READY] LFI-1 — reuse.md",
        body: "Preserve the existing implementation.",
      },
      config: { ...DEFAULT_CONFIG, ISOLATION_PROVIDER: "none" },
      gitDirectory: join(root, ".git"),
      log: {
        directory: join(root, ".lfi", "logs"),
        startedAt: new Date().toISOString(),
        iteration: 1,
      },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });
    assert.equal(result.accepted, true, result.summary);
    assert.equal(await readFile(calls, "utf8"), "called\n");
    assert.equal(await readFile(join(worktree, "result.txt"), "utf8"), "combined\n");
  } finally {
    process.env.PATH = originalPath;
  }
});
