import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, parseEnvConfig, serializeEnvConfig } from "../src/config.js";
import { migrateToLocal } from "../src/migrate.js";
import { runCommand } from "../src/process.js";

const git = async (cwd: string, ...args: string[]): Promise<void> => {
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
};

test("migration preserves LFI document types and native relationships", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-migrate-"));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "test\n");
  await git(root, "add", "README.md");
  await git(root, "commit", "-m", "initial");
  await mkdir(join(root, ".lfi"), { recursive: true });
  await writeFile(
    join(root, ".lfi", "config.env"),
    serializeEnvConfig({ ...DEFAULT_CONFIG, TASK_SOURCE: "github" }),
  );
  await mkdir(join(root, ".lfi", "specs"));

  const result = await migrateToLocal(root, {
    source: {
      listOpenLfiIssues: async () => [
        {
          number: 10,
          title: "[SPEC] LFI-20 — Feature specification",
          url: "https://github.test/10",
          body: `Specify the feature.

## Заблокировано задачами

Нет — можно начинать сразу.

---
Управляется LFI из LFI-20.
`,
          labels: ["lfi:spec"],
        },
        {
          number: 11,
          title: "[READY] LFI-21 — First task",
          url: "https://github.test/11",
          body: `Build first.

## Родитель

LFI-20

## Заблокировано задачами

Нет — можно начинать сразу.

---
Управляется LFI из LFI-21.
`,
          labels: ["lfi:task", "lfi:tier:light"],
        },
        {
          number: 12,
          title: "Second task",
          url: "https://github.test/12",
          body: "Build second.\n\n- #11\n",
          labels: ["lfi:task", "lfi:tier:deep"],
        },
        {
          number: 13,
          title: "Legacy task",
          url: "https://github.test/13",
          body: "Do not import.\n",
          labels: ["ready-for-agent"],
        },
      ],
      parents: async () => new Map([[11, 10], [12, 10]]),
      blockers: async () => new Map([[12, [11]]]),
    },
  });

  assert.deepEqual(result, ["LFI-1", "LFI-2", "LFI-3"]);
  assert.match(
    await readFile(
      join(
        root,
        ".lfi",
        "tasks",
        "feature-specification",
        "[SPEC] LFI-1 — feature-specification.md",
      ),
      "utf8",
    ),
    /type: spec[\s\S]*title: "Feature specification"[\s\S]*github_issue: 10/u,
  );
  assert.doesNotMatch(
    await readFile(
      join(root, ".lfi", "tasks", "feature-specification", "tasks", "[READY] LFI-2 — first-task.md"),
      "utf8",
    ),
    /\[READY\]|## Родитель|## Заблокировано|Управляется LFI/u,
  );
  assert.match(
    await readFile(
      join(root, ".lfi", "tasks", "feature-specification", "tasks", "[BLOCKED] LFI-3 — second-task.md"),
      "utf8",
    ),
    /type: task[\s\S]*spec: LFI-1[\s\S]*blocked_by:\n  - LFI-2[\s\S]*github_issue: 12/u,
  );
  assert.match(
    await readFile(
      join(root, ".lfi", "tasks", "feature-specification", "tasks", "[BLOCKED] LFI-3 — second-task.md"),
      "utf8",
    ),
    /execution_tier: deep/u,
  );
  assert.doesNotMatch(
    await readFile(
      join(root, ".lfi", "tasks", "feature-specification", "tasks", "[BLOCKED] LFI-3 — second-task.md"),
      "utf8",
    ),
    /- #11/u,
  );
  assert.equal(
    parseEnvConfig(await readFile(join(root, ".lfi", "config.env"), "utf8"))
      .TASK_SOURCE,
    "local",
  );
  assert.match(
    await readFile(join(root, "docs", "agents", "issue-tracker.md"), "utf8"),
    /\.lfi\/tasks\/<specification-slug>\/[\s\S]*lfi:spec/u,
  );
});
