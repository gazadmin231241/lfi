import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  agentModelKey,
  parseAgentModel,
  parseEnvConfig,
  resolveIntegrationModel,
  resolveWorkerModel,
  serializeEnvConfig,
  validateConfig,
} from "../src/config.js";
import { initializeProject } from "../src/init.js";
import { runDoctor } from "../src/doctor.js";
import { configureTrackerContract } from "../src/local-setup.js";
import { pruneExpiredRunLogs } from "../src/logs.js";
import { runCommand } from "../src/process.js";

test("config round-trips defaults", () => {
  const serialized = serializeEnvConfig(DEFAULT_CONFIG);
  const parsed = parseEnvConfig(serialized);

  assert.equal(parsed.REASONING_EFFORT, "medium");
  assert.equal(parsed.LIGHT_MODEL, "");
  assert.equal(parsed.STANDARD_MODEL, "");
  assert.equal(parsed.DEEP_MODEL, "");
  assert.equal(parsed.MAX_PARALLEL, 3);
  assert.equal(parsed.MAX_STAGES, 10);
  assert.equal(parsed.LOG_RETENTION_DAYS, 3);
  assert.equal(parsed.ISOLATION_PROVIDER, "local");
  assert.equal("TASK_SOURCE" in parsed, false);
  assert.equal("GITHUB_REPO" in parsed, false);
});

test("configuration ignores whitespace-prefixed trailing comments", () => {
  const withoutComments = parseEnvConfig(
    "DEFAULT_MODEL=codex:gpt-test\nMAX_PARALLEL=7\n",
  );
  const withComments = parseEnvConfig(
    "DEFAULT_MODEL=codex:gpt-test # shared model\nMAX_PARALLEL=7 # tasks at once\n",
  );

  assert.equal(withComments.DEFAULT_MODEL, withoutComments.DEFAULT_MODEL);
  assert.equal(withComments.MAX_PARALLEL, withoutComments.MAX_PARALLEL);
  assert.equal(Number.isNaN(withComments.MAX_PARALLEL), false);
});

test("configuration preserves hashes inside values and trims comment-adjacent whitespace", () => {
  const config = parseEnvConfig(
    "VALIDATE_COMMAND=pnpm validate#ci   # run before merge\n",
  );

  assert.equal(config.VALIDATE_COMMAND, "pnpm validate#ci");
});

test("configuration round-trips non-default values", () => {
  const config = {
    ...DEFAULT_CONFIG,
    DEFAULT_MODEL: "codex:default",
    LIGHT_MODEL: "codex:light",
    STANDARD_MODEL: "codex:standard",
    DEEP_MODEL: "codex:deep",
    REASONING_EFFORT: "high" as const,
    MERGER_MODEL: "codex:merger",
    MERGER_REASONING_EFFORT: "xhigh" as const,
    MAX_PARALLEL: 7,
    MAX_STAGES: 12,
    LOG_RETENTION_DAYS: 9,
    IDLE_TIMEOUT_MINUTES: 30,
    BASE_BRANCH: "trunk",
    VALIDATE_COMMAND: "pnpm validate#ci",
    WORKTREE_SETUP_COMMAND: "pnpm install --frozen-lockfile",
    ISOLATION_PROVIDER: "none" as const,
  };

  assert.deepEqual(parseEnvConfig(serializeEnvConfig(config)), config);
});

test("isolation defaults to local and supports an explicit opt-out", () => {
  assert.equal(parseEnvConfig("").ISOLATION_PROVIDER, "local");
  assert.equal(
    parseEnvConfig("ISOLATION_PROVIDER=none\n").ISOLATION_PROVIDER,
    "none",
  );
  assert.throws(
    () => parseEnvConfig("ISOLATION_PROVIDER=container\n"),
    /ISOLATION_PROVIDER/u,
  );
});

test("execution tiers resolve worker and integration agent-model pairs without changing reasoning", () => {
  const config = {
    ...DEFAULT_CONFIG,
    DEFAULT_MODEL: "legacy",
    LIGHT_MODEL: "luna",
    STANDARD_MODEL: "terra",
    DEEP_MODEL: "sol",
    REASONING_EFFORT: "low" as const,
  };

  assert.deepEqual(resolveWorkerModel(config, "light"), { agent: "codex", model: "luna" });
  assert.deepEqual(resolveWorkerModel(config, "standard"), { agent: "codex", model: "terra" });
  assert.deepEqual(resolveWorkerModel(config, "deep"), { agent: "codex", model: "sol" });
  assert.deepEqual(resolveWorkerModel({ ...config, LIGHT_MODEL: "" }, "light"), {
    agent: "codex",
    model: "legacy",
  });
  assert.deepEqual(resolveIntegrationModel(config), { agent: "codex", model: "terra" });
  assert.deepEqual(
    resolveIntegrationModel({ ...config, MERGER_MODEL: "integrator" }),
    { agent: "codex", model: "integrator" },
  );
  assert.equal(config.REASONING_EFFORT, "low");
});

test("configuration reads agent prefixes, preserves model syntax, and rewrites deprecated keys", () => {
  assert.deepEqual(parseAgentModel("gpt-5.6"), {
    agent: "codex",
    model: "gpt-5.6",
  });
  assert.deepEqual(parseAgentModel("codex:gpt-5.6:high"), {
    agent: "codex",
    model: "gpt-5.6:high",
  });
  assert.deepEqual(parseAgentModel("pi:openai/gpt-5.6:high"), {
    agent: "pi",
    model: "openai/gpt-5.6:high",
  });
  assert.deepEqual(
    resolveWorkerModel(
      parseEnvConfig("LIGHT_MODEL=codex:provider:model:thinking \n"),
      "light",
    ),
    { agent: "codex", model: "provider:model:thinking" },
  );
  assert.equal(
    agentModelKey({ agent: "codex", model: "gpt-5.6:high" }),
    "codex\0gpt-5.6:high",
  );
  const parsed = parseEnvConfig(
    "CODEX_MODEL=legacy\nCODEX_REASONING_EFFORT=low\n",
  );
  assert.equal(parsed.DEFAULT_MODEL, "legacy");
  assert.equal(parsed.REASONING_EFFORT, "low");
  const rewritten = serializeEnvConfig(parsed);
  assert.match(rewritten, /^DEFAULT_MODEL=legacy$/mu);
  assert.match(rewritten, /^REASONING_EFFORT=low$/mu);
  assert.doesNotMatch(rewritten, /CODEX_(?:MODEL|REASONING_EFFORT)/u);
  assert.throws(
    () => parseEnvConfig("LIGHT_MODEL=unknown:model\n"),
    /Unknown agent.*unknown:model/u,
  );
});

test("configuration rejects reasoning Pi does not accept", () => {
  assert.throws(
    () => parseEnvConfig("LIGHT_MODEL=pi:openai/gpt-test\nREASONING_EFFORT=ultra\n"),
    /Agent pi cannot honour REASONING_EFFORT=ultra/u,
  );
  assert.equal(
    parseEnvConfig("LIGHT_MODEL=pi:openai/gpt-test\nREASONING_EFFORT=xhigh\n").REASONING_EFFORT,
    "xhigh",
  );
});

test("doctor requires the commands used by GitHub code delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-doctor-codex-"));
  const tools = join(root, "bin");
  await mkdir(tools);
  for (const command of ["git", "gh", "codex"]) {
    const path = join(tools, command);
    await writeFile(path, "#!/bin/sh\nprintf 'SECRET_TOKEN\n'\n");
    await chmod(path, 0o755);
  }
  const checks = await runDoctor(process.cwd(), "en", {
    ...DEFAULT_CONFIG,
    ISOLATION_PROVIDER: "none",
  }, {
    ...process.env,
    PATH: tools,
  });
  const commands = checks.filter((check) => !check.name.startsWith("$"));

  assert.deepEqual(commands.map((check) => check.name), ["git", "gh", "codex"]);
  assert.equal(commands.every((check) => check.required), true);
});

test("doctor checks only configured agents and never reports command output", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-doctor-tools-"));
  const tools = join(root, "bin");
  await mkdir(tools);
  for (const command of ["git", "gh", "pi", "which"]) {
    const path = join(tools, command);
    await writeFile(path, "#!/bin/sh\nprintf 'SECRET_TOKEN\n'\n");
    await chmod(path, 0o755);
  }
  const config = {
    ...DEFAULT_CONFIG,
    LIGHT_MODEL: "pi:cheap",
    STANDARD_MODEL: "pi:standard",
    DEEP_MODEL: "pi:deep",
    MERGER_MODEL: "pi:merge",
    ISOLATION_PROVIDER: "none" as const,
  };

  const checks = await runDoctor(process.cwd(), "en", config, {
    ...process.env,
    PATH: tools,
  });
  const required = checks.filter((check) => check.required);

  assert.deepEqual(required.map((check) => check.name), ["git", "gh", "pi"]);
  assert.equal(checks.some((check) => check.name === "$implement"), false);
  assert.equal(checks.some((check) => check.detail.includes("SECRET_TOKEN")), false);
  assert.equal(required.every((check) => check.ok), true);
});

test("doctor checks local isolation and keeps its message actionable", async () => {
  const checks = await runDoctor(process.cwd(), "en", DEFAULT_CONFIG);
  const isolation = checks.find((check) => check.name === "bwrap");

  assert.ok(isolation);
  assert.equal(isolation.required, true);
  assert.match(isolation.detail, /bwrap/u);
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
  const ghMarker = join(root, "gh-called");
  await mkdir(bin);
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf '%s\n' "$*" > "${ghMarker}"
printf '%s\n' '{"nameWithOwner":"acme/widgets","defaultBranchRef":{"name":"trunk"}}'
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  await runCommand("git", ["init", "-b", "main"], { cwd: root });
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
  assert.equal(config.DEFAULT_MODEL, "gpt-test");
  assert.equal(config.LIGHT_MODEL, "gpt-test");
  assert.equal(config.STANDARD_MODEL, "gpt-test");
  assert.equal(config.DEEP_MODEL, "gpt-test");
  assert.equal(config.REASONING_EFFORT, "high");
  assert.equal(config.LOG_RETENTION_DAYS, 7);
  assert.equal(config.VALIDATE_COMMAND, "pnpm validate:all");
  assert.equal(config.WORKTREE_SETUP_COMMAND, "pnpm install --frozen-lockfile");
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.lfi\/\*$/mu);
  assert.doesNotMatch(gitignore, /!\.lfi\/tasks/u);
  assert.match(
    await readFile(join(root, ".lfi", "task-prompt.md"), "utf8"),
    /Use \{\{SKILL:implement\}\}/u,
  );
  const trackerGuide = await readFile(
    join(root, "docs", "agents", "issue-tracker.md"),
    "utf8",
  );
  assert.match(trackerGuide, /Type: spec/u);
  assert.match(trackerGuide, /Type: task/u);
  assert.match(trackerGuide, /Tier: light/u);
  assert.match(trackerGuide, /missing `Type:` line is an error/u);
  assert.match(trackerGuide, /## Wayfinding operations/u);
  assert.match(trackerGuide, /\.scratch\/<effort-slug>\/\[STATUS\] LFI-N — map-<slug>\.md/u);
  assert.match(trackerGuide, /\.scratch\/<effort-slug>\/issues\/\[STATUS\] LFI-N — <slug>\.md/u);
  assert.match(trackerGuide, /<!-- lfi:tracker-contract -->/u);
  assert.doesNotMatch(trackerGuide, /GitHub Issues|lfi:(?:spec|task|tier)/u);
  assert.match(await readFile(ghMarker, "utf8"), /repo view/u);
  const agentInstructions = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.match(agentInstructions, /LFI Local Markdown/u);
  assert.equal((agentInstructions.match(/lfi:agent-tracker:begin/gu) ?? []).length, 1);
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
  await writeFile(join(root, "AGENTS.md"), "User agent instructions.\n");

  await configureTrackerContract(root, "en");
  const guide = await readFile(join(directory, "issue-tracker.md"), "utf8");
  assert.match(guide, /^User preface\./u);
  assert.match(guide, /User appendix\.\s*$/u);
  assert.match(guide, /lfi:tracker-contract:begin/u);

  await configureTrackerContract(root, "en");
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /^User agent instructions\./u);
  assert.match(agents, /LFI Local Markdown/u);
  assert.equal((agents.match(/lfi:agent-tracker:begin/gu) ?? []).length, 1);
  assert.doesNotMatch(agents, /Tasks and specs use GitHub Issues/u);
});

test("tracker contract replaces a previous managed block with the scratch-hosted layout", async () => {
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

  await configureTrackerContract(root, "en");

  const guide = await readFile(join(directory, "issue-tracker.md"), "utf8");
  assert.equal((guide.match(/lfi:tracker-contract:begin/gu) ?? []).length, 1);
  assert.match(guide, /\.scratch\/<feature-slug>\//u);
  assert.match(guide, /\.scratch\/<feature-slug>\/issues\//u);
  assert.match(guide, /without a specification.*\.scratch\//su);
  assert.doesNotMatch(guide, /\.lfi\/(?:specs|tasks)/u);
  assert.match(guide, /^User preface\./u);
  assert.match(guide, /User appendix\.\s*$/u);
});

test("init uses GitHub only for repository detection and tracks tasks locally", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-local-init-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const ghMarker = join(root, "gh-called");
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf '%s\n' "$*" > '${ghMarker}'
printf '%s\n' '{"nameWithOwner":"acme/widgets","defaultBranchRef":{"name":"main"}}'
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
    });
  } finally {
    process.env.PATH = previousPath;
  }

  const config = parseEnvConfig(
    await readFile(join(root, ".lfi", "config.env"), "utf8"),
  );
  assert.equal(config.BASE_BRANCH, "main");
  assert.equal(config.LIGHT_MODEL, "");
  assert.equal(config.STANDARD_MODEL, "");
  assert.equal(config.DEEP_MODEL, "");
  assert.equal(await stat(join(root, ".scratch")).then((item) => item.isDirectory()), true);
  await assert.rejects(stat(join(root, ".lfi", "tasks")));
  await assert.rejects(stat(join(root, ".lfi", "specs")));
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^# custom\n\nbuild\//u);
  assert.match(gitignore, /\.lfi\/\*/u);
  assert.doesNotMatch(gitignore, /!\.lfi\/(?:specs|tasks)/u);

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
    }),
    "exists",
  );
  const upgradedGitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(upgradedGitignore, /\.lfi\/\*/u);
  assert.doesNotMatch(upgradedGitignore, /!\.lfi\/(?:specs|tasks)/u);
  const localGuide = await readFile(
    join(root, "docs", "agents", "issue-tracker.md"),
    "utf8",
  );
  assert.match(localGuide, /^custom tracker guide/mu);
  assert.match(localGuide, /\.scratch\/<feature-slug>\//u);
  assert.doesNotMatch(localGuide, /\.lfi\/(?:specs|tasks)/u);
  assert.doesNotMatch(localGuide, /GitHub Issues|lfi:(?:spec|task|tier)/u);
  assert.match(localGuide, /Tier: standard/u);
  assert.doesNotMatch(localGuide, /ready-for-agent|model:sol/u);
  assert.match(await readFile(join(root, "AGENTS.md"), "utf8"), /Трекер задач/u);
  assert.match(await readFile(ghMarker, "utf8"), /repo view/u);
});
