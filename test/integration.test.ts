import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/config.js";
import { runCommand } from "../src/process.js";
import { mergeWithAgent } from "../src/runner-support.js";

const conflictedRepository = async (
  codexBody: string,
  kind: "text" | "modify-delete" = "text",
) => {
  const root = await mkdtemp(join(tmpdir(), "lfi-merge-repair-"));
  const tools = join(root, "tools");
  const logs = join(root, "logs");
  await mkdir(tools);
  await writeFile(join(tools, "codex"), `#!/bin/sh\n${codexBody}\n`);
  await chmod(join(tools, "codex"), 0o755);
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await writeFile(join(root, ".gitignore"), "logs/\n");
  await writeFile(join(root, "conflict.txt"), "base\n");
  await git("add", ".");
  await git("commit", "-m", "test: initialize repository");
  await git("switch", "-c", "feature");
  await writeFile(join(root, "conflict.txt"), "feature\n");
  await git("commit", "-am", "feat: change conflict file");
  await git("switch", "main");
  if (kind === "text") {
    await writeFile(join(root, "conflict.txt"), "main\n");
    await git("commit", "-am", "fix: change conflict file");
  } else {
    await git("rm", "conflict.txt");
    await git("commit", "-m", "fix: remove conflict file");
  }
  const merge = await runCommand("git", ["merge", "feature"], { cwd: root });
  assert.notEqual(merge.exitCode, 0);
  return { root, tools, logs };
};

const repairWithFakeCodex = async (
  fixture: Awaited<ReturnType<typeof conflictedRepository>>,
  logName: string,
  allowedPaths?: readonly string[],
) => {
  const originalPath = process.env.PATH;
  process.env.PATH = `${fixture.tools}:${originalPath ?? ""}`;
  try {
    await mergeWithAgent({
      cwd: fixture.root,
      context: "Resolve the test integration.",
      config: { ...DEFAULT_CONFIG, VALIDATE_COMMAND: "true" },
      gitDirectory: join(fixture.root, ".git"),
      log: {
        directory: fixture.logs,
        startedAt: "2026-07-30T13:44:12.749Z",
        iteration: 1,
      },
      logName,
      language: "en",
      ...(allowedPaths ? { allowedPaths } : {}),
    });
  } finally {
    process.env.PATH = originalPath;
  }
};

test("successful merge repair is committed by the LFI host", async () => {
  const fixture = await conflictedRepository(
    "printf 'resolved\\n' > conflict.txt",
  );
  await repairWithFakeCodex(fixture, "merge-test");

  assert.equal(
    await readFile(join(fixture.root, "conflict.txt"), "utf8"),
    "resolved\n",
  );
  const status = await runCommand("git", ["status", "--porcelain"], {
    cwd: fixture.root,
  });
  assert.equal(status.stdout, "");
  const subject = await runCommand("git", ["log", "-1", "--format=%s"], {
    cwd: fixture.root,
  });
  assert.equal(subject.stdout.trim(), "chore(lfi): resolve integration");
});

test("merge repair cannot commit unresolved conflicts", async () => {
  const fixture = await conflictedRepository("exit 0");
  await assert.rejects(
    repairWithFakeCodex(fixture, "merge-unresolved"),
    /Merger did not resolve conflict\.txt/u,
  );

  const unmerged = await runCommand(
    "git",
    ["diff", "--name-only", "--diff-filter=U"],
    { cwd: fixture.root },
  );
  assert.equal(unmerged.stdout.trim(), "conflict.txt");
  const subject = await runCommand("git", ["log", "-1", "--format=%s"], {
    cwd: fixture.root,
  });
  assert.equal(subject.stdout.trim(), "fix: change conflict file");
});

test("merge repair cannot commit an unchanged markerless conflict", async () => {
  const fixture = await conflictedRepository("exit 0", "modify-delete");

  await assert.rejects(
    repairWithFakeCodex(fixture, "merge-markerless"),
    /Merger did not resolve conflict\.txt/u,
  );

  const unmerged = await runCommand(
    "git",
    ["diff", "--name-only", "--diff-filter=U"],
    { cwd: fixture.root },
  );
  assert.equal(unmerged.stdout.trim(), "conflict.txt");
});

test("repair cannot modify a path outside its allowlist", async () => {
  const fixture = await conflictedRepository(
    "printf 'resolved\\n' > conflict.txt; printf 'unrelated\\n' > unrelated.txt",
  );

  await assert.rejects(
    repairWithFakeCodex(fixture, "merge-out-of-scope", ["conflict.txt"]),
    /outside the integrated diff: unrelated\.txt/u,
  );

  const subject = await runCommand("git", ["log", "-1", "--format=%s"], {
    cwd: fixture.root,
  });
  assert.equal(subject.stdout.trim(), "fix: change conflict file");
});
