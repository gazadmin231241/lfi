import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { DEFAULT_CONFIG, parseEnvConfig, serializeEnvConfig } from "../src/config.js";
import { migrateToLocal } from "../src/migrate.js";

const exec = promisify(execFile);

test("migration imports open GitHub work and switches source after checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-migrate-"));
  await exec("git", ["init", "-b", "main"], { cwd: root });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await exec("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "README.md"), "test\n");
  await exec("git", ["add", "README.md"], { cwd: root });
  await exec("git", ["commit", "-m", "initial"], { cwd: root });
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
