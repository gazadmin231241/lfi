import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { DEFAULT_CONFIG, serializeEnvConfig } from "../src/config.js";
import { serializeTrackerDocument } from "../src/local-tracker.js";
import {
  syncGithubMirror,
  type GithubMirrorAdapter,
  type MirrorIssue,
} from "../src/sync.js";

const exec = promisify(execFile);

test("sync publishes specs, tasks, mappings, parents, and dependencies without duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-sync-"));
  await exec("git", ["init", "-b", "main"], { cwd: root });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await exec("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "README.md"), "test\n");
  await exec("git", ["add", "README.md"], { cwd: root });
  await exec("git", ["commit", "-m", "initial"], { cwd: root });
  const lfiRoot = join(root, ".lfi");
  await mkdir(join(lfiRoot, "tasks"), { recursive: true });
  await mkdir(join(lfiRoot, "specs"));
  await writeFile(
    join(lfiRoot, "config.env"),
    serializeEnvConfig({
      ...DEFAULT_CONFIG,
      TASK_SOURCE: "local",
      GITHUB_REPO: "acme/widgets",
    }),
  );
  const document = (
    id: string,
    type: "task" | "spec",
    status: "ready" | "completed",
    extra: { spec?: string; blockedBy?: string[] } = {},
  ) => ({
    id,
    number: Number(id.slice(4)),
    type,
    title: `${type} ${id}`,
    status,
    ...(extra.spec ? { spec: extra.spec } : {}),
    blockedBy: extra.blockedBy ?? [],
    body: `Body for ${id}.\n`,
    path: join(
      lfiRoot,
      type === "task" ? "tasks" : "specs",
      `${id}-document.md`,
    ),
  });
  for (const item of [
    document("LFI-1", "spec", "ready"),
    document("LFI-2", "task", "completed", { spec: "LFI-1" }),
    document("LFI-3", "task", "ready", {
      spec: "LFI-1",
      blockedBy: ["LFI-2"],
    }),
  ]) {
    await writeFile(item.path, serializeTrackerDocument(item));
  }

  const issues = new Map<number, MirrorIssue>();
  const parents: Array<[number, number]> = [];
  const dependencies: Array<[number, number[]]> = [];
  let next = 100;
  const adapter: GithubMirrorAdapter = {
    findByLfiId: async () => undefined,
    getIssue: async (number) => issues.get(number),
    createIssue: async (title, body, state) => {
      const issue = { number: next++, title, body, state };
      issues.set(issue.number, issue);
      return issue;
    },
    updateIssue: async (issue) => {
      issues.set(issue.number, issue);
    },
    setParent: async (child, parent) => {
      parents.push([child, parent]);
    },
    setBlockers: async (child, blockers) => {
      dependencies.push([child, [...blockers]]);
    },
  };

  const first = await syncGithubMirror(root, { adapter });
  assert.deepEqual(first.created, ["LFI-1", "LFI-2", "LFI-3"]);
  assert.deepEqual(parents, [[101, 100], [102, 100]]);
  assert.deepEqual(dependencies, [[102, [101]]]);
  assert.match(
    await readFile(join(lfiRoot, "tasks", "LFI-2-document.md"), "utf8"),
    /github_issue: 101/u,
  );

  adapter.findByLfiId = async (id) =>
    [...issues.values()].find((issue) => issue.title.includes(id));
  const second = await syncGithubMirror(root, { adapter });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.failed, []);
});
