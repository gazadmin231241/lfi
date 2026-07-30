import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, parseEnvConfig, serializeEnvConfig } from "../src/config.js";
import { initializeProject } from "../src/init.js";
import { pruneExpiredRunLogs } from "../src/logs.js";

test("config round-trips defaults and keeps advanced values editable", () => {
  const serialized = serializeEnvConfig(DEFAULT_CONFIG);
  const parsed = parseEnvConfig(serialized);

  assert.equal(parsed.CODEX_REASONING_EFFORT, "medium");
  assert.equal(parsed.MAX_PARALLEL, 3);
  assert.equal(parsed.MAX_STAGES, 10);
  assert.equal(parsed.LOG_RETENTION_DAYS, 3);
  assert.equal(parsed.ISSUE_LABEL, "ready-for-agent");
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
  await mkdir(bin);
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf '%s\\n' '{"nameWithOwner":"acme/widgets","defaultBranchRef":{"name":"trunk"}}'
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
});
