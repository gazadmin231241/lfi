import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  parseEnvConfig,
  serializeEnvConfig,
  validateConfig,
} from "../src/config.js";
import { initializeProject } from "../src/init.js";
import { pruneExpiredRunLogs } from "../src/logs.js";
import { runCommand } from "../src/process.js";

test("config round-trips defaults without configurable tracker labels", () => {
  const serialized = serializeEnvConfig(DEFAULT_CONFIG);
  const parsed = parseEnvConfig(serialized);

  assert.equal(parsed.CODEX_REASONING_EFFORT, "medium");
  assert.equal(parsed.MAX_PARALLEL, 3);
  assert.equal(parsed.MAX_STAGES, 10);
  assert.equal(parsed.LOG_RETENTION_DAYS, 3);
  assert.doesNotMatch(serialized, /ISSUE_LABEL|EXCLUDE_LABELS/u);
  assert.equal("ISSUE_LABEL" in parsed, false);
  assert.equal("EXCLUDE_LABELS" in parsed, false);
  assert.equal(parsed.TASK_SOURCE, "local");
});

test("config ignores removed tracker-label settings", () => {
  const parsed = parseEnvConfig(
    "TASK_SOURCE=github\nISSUE_LABEL=ready-for-agent\nEXCLUDE_LABELS=blocked\n",
  );
  assert.equal("ISSUE_LABEL" in parsed, false);
  assert.equal("EXCLUDE_LABELS" in parsed, false);
});

test("config treats missing task source as the legacy GitHub mode", () => {
  assert.equal(parseEnvConfig("BASE_BRANCH=main\n").TASK_SOURCE, "github");
});

test("config rejects unsafe concurrency and invalid numeric values", () => {
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, MAX_PARALLEL: 0 }),
    /MAX_PARALLEL/u,
  );
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, LOG_RETENTION_DAYS: Number.NaN }),
    /LOG_RETENTION_DAYS/u,
  );
  assert.throws(
    () => parseEnvConfig("CODEX_REASONING_EFFORT=extreme\n"),
    /unsupported/u,
  );
});

test("log pruning removes expired runs but preserves active run", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-logs-"));
  const oldRun = join(root, "old");
  const activeRun = join(root, "active");
  await mkdir(oldRun);
  await mkdir(activeRun);
  await writeFile(join(oldRun, "worker.log"), "old");
  await writeFile(join(activeRun, "worker.log"), "active");
  const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
  await utimes(oldRun, old, old);

  const removed = await pruneExpiredRunLogs(root, {
    retentionDays: 3,
    activeRunName: "active",
    now: new Date(),
  });

  assert.deepEqual(removed, ["old"]);
  await assert.rejects(stat(oldRun));
  assert.equal(await readFile(join(activeRun, "worker.log"), "utf8"), "active");
});

test("init creates an ignored, runnable project configuration from detected defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-init-"));
  const bin = join(root, "bin");
  const ghCalls = join(root, "gh-calls");
  await mkdir(bin);
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${ghCalls}"
case "$*" in
  *"repo view"*)
    printf '%s\\n' '{"nameWithOwner":"acme/widgets","defaultBranchRef":{"name":"trunk"}}'
    ;;
esac
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  await writeFile(join(root, "pnpm-lock.yaml"), "");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { "validate:all": "node validate.js" } }),
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  try {
    const result = await initializeProject({
      cwd: root,
      language: "en",
      retentionDays: 7,
      yes: true,
      taskSource: "github",
      model: "gpt-test",
      reasoning: "high",
    });
    assert.equal(result, "created");
  } finally {
    process.env.PATH = previousPath;
  }

  const config = parseEnvConfig(
    await readFile(join(root, ".lfi", "config.env"), "utf8"),
  );
  assert.equal(config.BASE_BRANCH, "trunk");
  assert.equal(config.CODEX_MODEL, "gpt-test");
  assert.equal(config.CODEX_REASONING_EFFORT, "high");
  assert.equal(config.LOG_RETENTION_DAYS, 7);
  assert.equal(config.VALIDATE_COMMAND, "pnpm validate:all");
  assert.equal(config.WORKTREE_SETUP_COMMAND, "pnpm install --frozen-lockfile");
  assert.match(await readFile(join(root, ".gitignore"), "utf8"), /^\.lfi\/$/mu);
  assert.match(
    await readFile(join(root, ".lfi", "task-prompt.md"), "utf8"),
    /Use \$implement/u,
  );
  const githubGuide = await readFile(
    join(root, "docs", "agents", "issue-tracker.md"),
    "utf8",
  );
  assert.match(githubGuide, /lfi:spec/u);
  assert.match(githubGuide, /lfi:task/u);
  assert.doesNotMatch(githubGuide, /ready-for-agent|model:sol|\.scratch/u);
  const calls = await readFile(ghCalls, "utf8");
  assert.match(calls, /label create lfi:spec/u);
  assert.match(calls, /label create lfi:task/u);
});

test("local init works without gh or a remote and tracks only task documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-local-init-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const ghMarker = join(root, "gh-called");
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
touch '${ghMarker}'
exit 1
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  await runCommand("git", ["init", "-b", "main"], { cwd: root });
  await mkdir(join(root, "docs", "agents"), { recursive: true });
  await writeFile(join(root, ".gitignore"), "# custom\n\nbuild/\n");
  await writeFile(
    join(root, "docs", "agents", "issue-tracker.md"),
    "custom tracker guide\n",
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: {} }));
    await initializeProject({
      cwd: root,
      language: "ru",
      retentionDays: 3,
      yes: true,
      taskSource: "local",
    });
  } finally {
    process.env.PATH = previousPath;
  }

  const config = parseEnvConfig(
    await readFile(join(root, ".lfi", "config.env"), "utf8"),
  );
  assert.equal(config.TASK_SOURCE, "local");
  assert.equal(config.BASE_BRANCH, "main");
  assert.equal(await stat(join(root, ".lfi", "tasks")).then((item) => item.isDirectory()), true);
  assert.equal(await stat(join(root, ".lfi", "specs")).then((item) => item.isDirectory()), true);
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^# custom\n\nbuild\//u);
  assert.match(gitignore, /\.lfi\/\*/u);
  assert.match(gitignore, /!\.lfi\/tasks\//u);
  assert.match(gitignore, /!\.lfi\/specs\//u);
  const localGuide = await readFile(
    join(root, "docs", "agents", "issue-tracker.md"),
    "utf8",
  );
  assert.match(localGuide, /\.lfi\/specs/u);
  assert.match(localGuide, /\.lfi\/tasks/u);
  assert.match(localGuide, /lfi:spec/u);
  assert.match(localGuide, /lfi:task/u);
  assert.doesNotMatch(localGuide, /ready-for-agent|model:sol|\.scratch/u);
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /Трекер задач/u);
  await assert.rejects(stat(ghMarker));
});
