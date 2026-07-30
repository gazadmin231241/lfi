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

test("migration imports open GitHub work and switches source after checkpoint", async () => {
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
      listOpenAgentIssues: async () => [
        {
          number: 10,
          title: "First task",
          url: "https://github.test/10",
          body: "Build first.\n",
          labels: ["ready-for-agent"],
        },
        {
          number: 11,
          title: "Second task",
          url: "https://github.test/11",
          body: "Build second.\n",
          labels: ["ready-for-agent"],
        },
      ],
      blockers: async () => new Map([[11, [10]]]),
    },
  });

  assert.deepEqual(result, ["LFI-1", "LFI-2"]);
  assert.match(
    await readFile(join(root, ".lfi", "tasks", "LFI-2-second-task.md"), "utf8"),
    /blocked_by:\n  - LFI-1[\s\S]*github_issue: 11/u,
  );
  assert.equal(
    parseEnvConfig(await readFile(join(root, ".lfi", "config.env"), "utf8"))
      .TASK_SOURCE,
    "local",
  );
});
