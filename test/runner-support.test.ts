import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/config.js";
import {
  validateIntegration,
  ValidationFailure,
} from "../src/runner-support.js";

test("baseline validation failure does not invoke repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-baseline-validation-"));
  const logs = join(root, "logs");
  await mkdir(logs);
  let repairCalls = 0;

  await assert.rejects(
    validateIntegration({
      cwd: root,
      config: {
        ...DEFAULT_CONFIG,
        VALIDATE_COMMAND: "printf 'baseline is broken\\n' >&2; exit 1",
      },
      gitDirectory: root,
      language: "en",
      log: {
        directory: logs,
        startedAt: "2026-07-30T13:44:12.749Z",
        iteration: 1,
      },
      phase: "baseline",
      repair: async () => {
        repairCalls += 1;
      },
    }),
    (error: unknown) =>
      error instanceof ValidationFailure &&
      /Baseline validation failed; combined repair was skipped/u.test(
        error.message,
      ),
  );

  assert.equal(repairCalls, 0);
});

test("combined validation repair receives exact redacted diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-combined-validation-"));
  const logs = join(root, "logs");
  await mkdir(logs);
  const command =
    "printf 'stdout github_pat_EXAMPLE_SECRET_123456\\n'; printf 'stderr detail\\n' >&2; exit 7";
  let received: unknown;

  await assert.rejects(
    validateIntegration({
      cwd: root,
      config: {
        ...DEFAULT_CONFIG,
        VALIDATE_COMMAND: command,
      },
      gitDirectory: root,
      language: "en",
      log: {
        directory: logs,
        startedAt: "2026-07-30T13:44:12.749Z",
        iteration: 1,
      },
      phase: "combined",
      repair: async (diagnostic: unknown) => {
        received = diagnostic;
      },
    }),
    ValidationFailure,
  );

  assert.deepEqual(received, {
    command:
      "printf 'stdout [REDACTED]\\n'; printf 'stderr detail\\n' >&2; exit 7",
    exitCode: 7,
    stdout: "stdout [REDACTED]\n",
    stderr: "stderr detail\n",
  });
  const integrationLog = await readFile(
    join(logs, "integration.log"),
    "utf8",
  );
  assert.match(integrationLog, /\[REDACTED\]/u);
  assert.doesNotMatch(
    integrationLog,
    /github_pat_EXAMPLE_SECRET_123456/u,
  );
});

test("worktree setup and validation honour the isolation opt-out", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-validation-opt-out-"));
  const logs = join(root, "logs");
  await mkdir(logs);

  await validateIntegration({
    cwd: root,
    config: {
      ...DEFAULT_CONFIG,
      ISOLATION_PROVIDER: "none",
      WORKTREE_SETUP_COMMAND: "printf 'setup\\n' > setup.txt",
      VALIDATE_COMMAND: "test -f setup.txt",
    },
    gitDirectory: root,
    language: "en",
    log: {
      directory: logs,
      startedAt: "2026-07-30T13:44:12.749Z",
      iteration: 1,
    },
    phase: "combined",
    repair: async () => undefined,
  });

  assert.equal(await readFile(join(root, "setup.txt"), "utf8"), "setup\n");
});
