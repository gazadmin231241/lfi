import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseEnvConfig } from "../src/config.js";
import { initializeProject } from "../src/init.js";
import {
  defaultMergePrompt,
  defaultReviewPrompt,
  defaultTaskPrompt,
  legacyDefaultTaskPrompts,
} from "../src/prompts.js";

test("repeated init localizes stock templates and adds missing config settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-init-reconcile-"));
  const lfiRoot = join(root, ".lfi");
  await mkdir(join(lfiRoot, "prompts"), { recursive: true });
  await writeFile(
    join(lfiRoot, "config.env"),
    "BASE_BRANCH=main\nVALIDATE_COMMAND=pnpm check\n",
  );
  await writeFile(join(lfiRoot, "prompts", "review.md"), defaultReviewPrompt("en"));
  await writeFile(join(lfiRoot, "prompts", "merge.md"), "My merge instructions.\n");
  await writeFile(join(lfiRoot, "task-prompt.md"), defaultTaskPrompt("en"));

  assert.equal(
    await initializeProject({ cwd: root, language: "ru", yes: true }),
    "exists",
  );

  assert.equal(
    await readFile(join(lfiRoot, "prompts", "review.md"), "utf8"),
    defaultReviewPrompt("ru"),
  );
  assert.equal(
    await readFile(join(lfiRoot, "prompts", "task.md"), "utf8"),
    defaultTaskPrompt("ru"),
  );
  assert.equal(
    await readFile(join(lfiRoot, "prompts", "merge.md"), "utf8"),
    "My merge instructions.\n",
  );
  const configSource = await readFile(join(lfiRoot, "config.env"), "utf8");
  assert.match(configSource, /^REVIEW_ENABLED=true # /mu);
  assert.match(configSource, /^MAX_REMEDIATION_ROUNDS=1 # /mu);
  assert.match(configSource, /Добавлено повторным `lfi init`/u);
  assert.equal(parseEnvConfig(configSource).VALIDATE_COMMAND, "pnpm check");
});

test("repeated init upgrades a superseded stock task prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-init-stock-upgrade-"));
  const lfiRoot = join(root, ".lfi");
  await mkdir(join(lfiRoot, "prompts"), { recursive: true });
  await writeFile(join(lfiRoot, "config.env"), "BASE_BRANCH=main\n");
  await writeFile(
    join(lfiRoot, "prompts", "task.md"),
    legacyDefaultTaskPrompts[0] ?? "",
  );

  await initializeProject({ cwd: root, language: "ru", yes: true });

  assert.equal(
    await readFile(join(lfiRoot, "prompts", "task.md"), "utf8"),
    defaultTaskPrompt("ru"),
  );
});

test("repeated init keeps a custom legacy task prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-init-custom-legacy-"));
  const lfiRoot = join(root, ".lfi");
  await mkdir(lfiRoot, { recursive: true });
  await writeFile(join(lfiRoot, "config.env"), "BASE_BRANCH=main\n");
  await writeFile(join(lfiRoot, "task-prompt.md"), "My task instructions.\n");

  await initializeProject({ cwd: root, language: "ru", yes: true });

  await assert.rejects(readFile(join(lfiRoot, "prompts", "task.md"), "utf8"));
  assert.equal(
    await readFile(join(lfiRoot, "task-prompt.md"), "utf8"),
    "My task instructions.\n",
  );
});

test("repeated init applies explicit configuration options", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-init-options-"));
  const lfiRoot = join(root, ".lfi");
  await mkdir(lfiRoot, { recursive: true });
  await writeFile(join(lfiRoot, "config.env"), "BASE_BRANCH=main\nMAX_PARALLEL=2\n");

  await initializeProject({
    cwd: root,
    language: "en",
    yes: true,
    model: "gpt-test",
    reasoning: "high",
    retentionDays: 9,
  });

  const config = parseEnvConfig(await readFile(join(lfiRoot, "config.env"), "utf8"));
  assert.equal(config.DEFAULT_MODEL, "codex:gpt-test:high");
  assert.equal(config.LIGHT_MODEL, "codex:gpt-test:high");
  assert.equal(config.REASONING_EFFORT, "high");
  assert.equal(config.LOG_RETENTION_DAYS, 9);
  assert.equal(config.MAX_PARALLEL, 2);
});
