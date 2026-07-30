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

  const result = await migrateToLocal(root, {
    source: {
      listOpenLfiIssues: async () => [
        {
          number: 10,
          title: "Feature specification",
          url: "https://github.test/10",
          body: "Specify the feature.\n",
          labels: ["lfi:spec"],
        },
        {
          number: 11,
          title: "First task",
          url: "https://github.test/11",
          body: "Build first.\n",
          labels: ["lfi:task"],
        },
        {
          number: 12,
          title: "Second task",
          url: "https://github.test/12",
          body: "Build second.\n",
          labels: ["lfi:task"],
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
      join(root, ".lfi", "specs", "LFI-1-feature-specification.md"),
      "utf8",
    ),
    /type: spec[\s\S]*github_issue: 10/u,
  );
  assert.match(
    await readFile(join(root, ".lfi", "tasks", "LFI-3-second-task.md"), "utf8"),
    /type: task[\s\S]*spec: LFI-1[\s\S]*blocked_by:\n  - LFI-2[\s\S]*github_issue: 12/u,
  );
  assert.equal(
    parseEnvConfig(await readFile(join(root, ".lfi", "config.env"), "utf8"))
      .TASK_SOURCE,
    "local",
  );
  assert.match(
    await readFile(join(root, "docs", "agents", "issue-tracker.md"), "utf8"),
    /\.lfi\/specs[\s\S]*lfi:spec/u,
  );
});
