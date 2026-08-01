import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  parseEnvConfig,
  resolveIntegrationModel,
  resolveWorkerModel,
  serializeEnvConfig,
  validateConfig,
} from "../src/config.js";
import { initializeProject } from "../src/init.js";
import { configureTrackerContract } from "../src/local-setup.js";
import { pruneExpiredRunLogs } from "../src/logs.js";
import { runCommand } from "../src/process.js";

test("config round-trips defaults without configurable tracker labels", () => {
  const serialized = serializeEnvConfig(DEFAULT_CONFIG);
  const parsed = parseEnvConfig(serialized);

  assert.equal(parsed.CODEX_REASONING_EFFORT, "medium");
  assert.equal(parsed.LIGHT_MODEL, "");
  assert.equal(parsed.STANDARD_MODEL, "");
  assert.equal(parsed.DEEP_MODEL, "");
  assert.equal(parsed.MAX_PARALLEL, 3);
  assert.equal(parsed.MAX_STAGES, 10);
  assert.equal(parsed.LOG_RETENTION_DAYS, 3);
  assert.doesNotMatch(serialized, /ISSUE_LABEL|EXCLUDE_LABELS/u);
  assert.equal("ISSUE_LABEL" in parsed, false);
  assert.equal("EXCLUDE_LABELS" in parsed, false);
  assert.equal(parsed.TASK_SOURCE, "local");
});

test("execution tiers resolve worker and integration models without changing reasoning", () => {
  const config = {
    ...DEFAULT_CONFIG,
    CODEX_MODEL: "legacy",
    LIGHT_MODEL: "luna",
    STANDARD_MODEL: "terra",
    DEEP_MODEL: "sol",
    CODEX_REASONING_EFFORT: "low" as const,
  };

  assert.equal(resolveWorkerModel(config, "light"), "luna");
  assert.equal(resolveWorkerModel(config, "standard"), "terra");
  assert.equal(resolveWorkerModel(config, "deep"), "sol");
  assert.equal(resolveWorkerModel({ ...config, LIGHT_MODEL: "" }, "light"), "legacy");
  assert.equal(resolveIntegrationModel(config), "terra");
  assert.equal(
    resolveIntegrationModel({ ...config, MERGER_MODEL: "integrator" }),
    "integrator",
  );
  assert.equal(config.CODEX_REASONING_EFFORT, "low");
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

test("log pruning removes expired flat-log sections and failure artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-flat-logs-"));
  const failures = join(root, "failures");
  await mkdir(failures);
  const taskLog = join(root, "LFI-2.log");
  await writeFile(
    taskLog,
    `
--- Run started: 2026-07-20T10:00:00.000Z; iteration: 1 ---
old command

--- Run started: 2026-07-29T10:00:00.000Z; iteration: 2 ---
new message
`,
  );
  const oldFailure = join(
    failures,
    "LFI-2--2026-07-20T10-00-00.000Z--iteration-1.jsonl.gz",
  );
  const newFailure = join(
    failures,
    "LFI-2--2026-07-29T10-00-00.000Z--iteration-2.jsonl.gz",
  );
  await writeFile(oldFailure, "old");
  await writeFile(newFailure, "new");
  await utimes(oldFailure, new Date("2026-07-20T10:00:00.000Z"), new Date("2026-07-20T10:00:00.000Z"));
  await utimes(newFailure, new Date("2026-07-29T10:00:00.000Z"), new Date("2026-07-29T10:00:00.000Z"));

  await pruneExpiredRunLogs(root, {
    retentionDays: 3,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });

  const retained = await readFile(taskLog, "utf8");
  assert.doesNotMatch(retained, /old command/u);
  assert.match(retained, /new message/u);
  await assert.rejects(stat(oldFailure));
  assert.equal(await readFile(newFailure, "utf8"), "new");

  await pruneExpiredRunLogs(root, {
    retentionDays: 3,
    now: new Date("2026-08-10T12:00:00.000Z"),
  });
  await assert.rejects(stat(failures));
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
  assert.equal(config.LIGHT_MODEL, "gpt-test");
  assert.equal(config.STANDARD_MODEL, "gpt-test");
  assert.equal(config.DEEP_MODEL, "gpt-test");
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
  assert.match(githubGuide, /lfi:tier:light/u);
  assert.match(githubGuide, /lfi:tier:standard/u);
  assert.match(githubGuide, /lfi:tier:deep/u);
  assert.doesNotMatch(githubGuide, /ready-for-agent|model:sol|\.scratch/u);
  const calls = await readFile(ghCalls, "utf8");
  assert.match(calls, /label create lfi:spec/u);
  assert.match(calls, /label create lfi:task/u);
  assert.match(calls, /label create lfi:tier:light/u);
  assert.match(calls, /label create lfi:tier:standard/u);
  assert.match(calls, /label create lfi:tier:deep/u);
  const agentInstructions = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.match(agentInstructions, /GitHub Issues/u);
  assert.doesNotMatch(agentInstructions, /use LFI Local Markdown/u);
});

test("tracker contract upgrades preserve text around the legacy marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-guide-upgrade-"));
  const directory = join(root, "docs", "agents");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "issue-tracker.md"),
    `User preface.

<!-- lfi:tracker-contract -->
# Issue tracker: LFI

Old managed contract. Specifications are never executable.

User appendix.
`,
  );

  await configureTrackerContract(root, "en", "local");
  const guide = await readFile(join(directory, "issue-tracker.md"), "utf8");
  assert.match(guide, /^User preface\./u);
  assert.match(guide, /User appendix\.\s*$/u);
  assert.match(guide, /lfi:tracker-contract:begin/u);

  await configureTrackerContract(root, "en", "github");
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /GitHub Issues/u);
  await configureTrackerContract(root, "en", "local");
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /LFI Local Markdown/u);
  assert.doesNotMatch(agents, /Tasks and specs use GitHub Issues/u);
});

test("tracker contract replaces a previous managed block with the spec-scoped layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-guide-managed-upgrade-"));
  const directory = join(root, "docs", "agents");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "issue-tracker.md"),
    `User preface.

<!-- lfi:tracker-contract:begin -->
<!-- lfi:tracker-contract -->
# Issue tracker: LFI

Specifications are flat files in \`.lfi/specs/\`; completed tasks move to
\`.lfi/tasks/completed/\`.
<!-- lfi:tracker-contract:end -->

User appendix.
`,
  );

  await configureTrackerContract(root, "en", "local");

  const guide = await readFile(join(directory, "issue-tracker.md"), "utf8");
  assert.equal((guide.match(/lfi:tracker-contract:begin/gu) ?? []).length, 1);
  assert.match(guide, /\.lfi\/tasks\/<specification-slug>\//u);
  assert.match(guide, /\.lfi\/tasks\/<specification-slug>\/tasks\//u);
  assert.match(guide, /without a specification.*\.lfi\/tasks\//su);
  assert.doesNotMatch(guide, /\.lfi\/(?:specs|tasks\/completed)/u);
  assert.match(guide, /^User preface\./u);
  assert.match(guide, /User appendix\.\s*$/u);
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
  assert.equal(config.LIGHT_MODEL, "");
  assert.equal(config.STANDARD_MODEL, "");
  assert.equal(config.DEEP_MODEL, "");
  assert.equal(await stat(join(root, ".lfi", "tasks")).then((item) => item.isDirectory()), true);
  await assert.rejects(stat(join(root, ".lfi", "tasks", "completed")));
  await assert.rejects(stat(join(root, ".lfi", "specs")));
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^# custom\n\nbuild\//u);
  assert.match(gitignore, /\.lfi\/\*/u);
  assert.match(gitignore, /!\.lfi\/tasks\//u);
  assert.match(gitignore, /!\.lfi\/tasks\/\*\*/u);
  assert.doesNotMatch(gitignore, /\.lfi\/(?:specs|tasks\/completed)/u);

  await writeFile(
    join(root, ".gitignore"),
    `# custom

build/
# LFI local tracker: begin
.lfi/*
!.lfi/tasks/
!.lfi/tasks/*.md
!.lfi/tasks/completed/
!.lfi/tasks/completed/*.md
!.lfi/specs/
!.lfi/specs/*.md
# LFI local tracker: end
`,
  );
  assert.equal(
    await initializeProject({
      cwd: root,
      language: "ru",
      retentionDays: 3,
      yes: true,
      taskSource: "local",
    }),
    "exists",
  );
  const upgradedGitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(upgradedGitignore, /!\.lfi\/tasks\/\*\*/u);
  assert.doesNotMatch(upgradedGitignore, /\.lfi\/(?:specs|tasks\/completed)/u);
  const localGuide = await readFile(
    join(root, "docs", "agents", "issue-tracker.md"),
    "utf8",
  );
  assert.match(localGuide, /^custom tracker guide/mu);
  assert.match(localGuide, /\.lfi\/tasks\/<specification-slug>\//u);
  assert.doesNotMatch(localGuide, /\.lfi\/(?:specs|tasks\/completed)/u);
  assert.match(localGuide, /lfi:spec/u);
  assert.match(localGuide, /lfi:task/u);
  assert.match(localGuide, /execution_tier/u);
  assert.doesNotMatch(localGuide, /ready-for-agent|model:sol|\.scratch/u);
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /Трекер задач/u);
  await assert.rejects(stat(ghMarker));
});
