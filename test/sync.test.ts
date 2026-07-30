import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, serializeEnvConfig } from "../src/config.js";
import { serializeTrackerDocument } from "../src/local-tracker.js";
import {
  syncGithubMirror,
  type GithubMirrorAdapter,
  type MirrorIssue,
} from "../src/sync.js";
import { runCommand } from "../src/process.js";
import { createGhMirrorAdapter } from "../src/github-mirror-adapter.js";

const git = async (cwd: string, ...args: string[]): Promise<void> => {
  const result = await runCommand("git", args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
};

test("sync publishes specs, tasks, mappings, parents, and dependencies without duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-sync-"));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  await writeFile(join(root, "README.md"), "test\n");
  await git(root, "add", "README.md");
  await git(root, "commit", "-m", "initial");
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
  const spec = document("LFI-1", "spec", "ready");
  const completed = document("LFI-2", "task", "completed", {
    spec: "LFI-1",
  });
  const ready = document("LFI-3", "task", "ready", {
      spec: "LFI-1",
      blockedBy: ["LFI-2"],
    });
  for (const item of [spec, completed, ready]) {
    await writeFile(item.path, serializeTrackerDocument(item));
  }

  const issues = new Map<number, MirrorIssue>();
  const parents: Array<[number, number]> = [];
  const dependencies: Array<[number, number[]]> = [];
  const closingComments: string[] = [];
  let next = 100;
  const adapter: GithubMirrorAdapter = {
    findByLfiId: async () => undefined,
    getIssue: async (number) => issues.get(number),
    createIssue: async (title, body, state) => {
      const issue = { number: next++, title, body, state };
      issues.set(issue.number, issue);
      return issue;
    },
    updateIssue: async (issue, closingComment) => {
      issues.set(issue.number, issue);
      if (closingComment) closingComments.push(closingComment);
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
  assert.deepEqual(second.skipped, ["LFI-1", "LFI-2", "LFI-3"]);

  await writeFile(
    ready.path,
    serializeTrackerDocument({ ...ready, status: "completed" }),
  );
  const closed = await syncGithubMirror(root, { adapter });
  assert.deepEqual(closed.updated, ["LFI-1", "LFI-3"]);
  assert.equal(issues.get(100)?.state, "closed");
  assert.equal(issues.get(102)?.state, "closed");

  await writeFile(
    ready.path,
    serializeTrackerDocument({ ...ready, status: "cancelled" }),
  );
  const cancelled = await syncGithubMirror(root, { adapter });
  assert.deepEqual(cancelled.updated, ["LFI-3"]);
  assert.deepEqual(closingComments, ["Cancelled in the local LFI tracker."]);

  await writeFile(ready.path, serializeTrackerDocument(ready));
  const reopened = await syncGithubMirror(root, { adapter });
  assert.deepEqual(reopened.updated, ["LFI-1", "LFI-3"]);
  assert.equal(issues.get(100)?.state, "open");
  assert.equal(issues.get(102)?.state, "open");
});

test("sync persists partial progress, resumes, and reports relationship failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-sync-resume-"));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
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
  const task = (id: string, blockedBy: string[] = []) => ({
    id,
    number: Number(id.slice(4)),
    type: "task" as const,
    title: `Task ${id}`,
    status: "ready" as const,
    blockedBy,
    body: `Build ${id}.\n`,
    path: join(lfiRoot, "tasks", `${id}-task.md`),
  });
  const firstTask = task("LFI-1");
  const secondTask = task("LFI-2", ["LFI-1"]);
  await writeFile(firstTask.path, serializeTrackerDocument(firstTask));
  await writeFile(secondTask.path, serializeTrackerDocument(secondTask));
  await git(root, "add", ".");
  await git(root, "commit", "-m", "initial");

  const issues = new Map<number, MirrorIssue>();
  let failCreate = true;
  let failRelationship = false;
  let next = 50;
  const adapter: GithubMirrorAdapter = {
    findByLfiId: async () => undefined,
    getIssue: async (number) => issues.get(number),
    createIssue: async (title, body, state) => {
      if (title.includes("LFI-2") && failCreate) {
        throw new Error("i/o timeout");
      }
      const issue = { number: next++, title, body, state };
      issues.set(issue.number, issue);
      return issue;
    },
    updateIssue: async (issue) => {
      issues.set(issue.number, issue);
    },
    setParent: async () => undefined,
    setBlockers: async () => {
      if (failRelationship) throw new Error("HTTP 403 forbidden");
    },
  };

  const partial = await syncGithubMirror(root, { adapter });
  assert.deepEqual(partial.created, ["LFI-1"]);
  assert.deepEqual(partial.failed.map((item) => item.id), ["LFI-2"]);
  assert.match(await readFile(firstTask.path, "utf8"), /github_issue: 50/u);
  assert.doesNotMatch(await readFile(secondTask.path, "utf8"), /github_issue/u);

  failCreate = false;
  const resumed = await syncGithubMirror(root, { adapter });
  assert.deepEqual(resumed.created, ["LFI-2"]);
  assert.deepEqual(resumed.failed, []);
  assert.equal(next, 52);

  failRelationship = true;
  const failedEdge = await syncGithubMirror(root, { adapter });
  assert.deepEqual(failedEdge.failed.map((item) => item.id), ["LFI-2"]);
});

test("GitHub adapter recovers an uncertain create without duplicating the issue", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-sync-uncertain-"));
  const tools = join(root, "tools");
  const created = join(root, "created");
  const calls = join(root, "create-calls");
  await mkdir(tools);
  await writeFile(
    join(tools, "gh"),
    `#!/bin/sh
case "$*" in
  *"issue create"*)
    printf 'called\\n' >> "${calls}"
    touch "${created}"
    printf 'i/o timeout\\n' >&2
    exit 1
    ;;
  *"issue list"*)
    if [ -f "${created}" ]; then
      printf '%s\\n' '[{"number":77,"title":"🟢 LFI-7 — Task","body":"Body","state":"OPEN"}]'
    else
      printf '%s\\n' '[]'
    fi
    ;;
esac
`,
  );
  await chmod(join(tools, "gh"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const issue = await createGhMirrorAdapter(
      root,
      "acme/widgets",
    ).createIssue("🟢 LFI-7 — Task", "Body", "open");
    assert.equal(issue.number, 77);
  } finally {
    process.env.PATH = originalPath;
  }
  assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 1);
});

test("GitHub adapter falls back only for unsupported native relationships", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-sync-edge-"));
  const tools = join(root, "tools");
  const behavior = join(root, "behavior");
  await mkdir(tools);
  await writeFile(behavior, "forbidden");
  await writeFile(
    join(tools, "gh"),
    `#!/bin/sh
case "$*" in
  *"--method POST"*)
    if [ "$(cat "${behavior}")" = "unsupported" ]; then
      printf 'sub-issues are not supported\\n' >&2
    else
      printf 'HTTP 403 forbidden\\n' >&2
    fi
    exit 1
    ;;
  *)
    printf '123\\n'
    ;;
esac
`,
  );
  await chmod(join(tools, "gh"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const adapter = createGhMirrorAdapter(root, "acme/widgets");
    await assert.rejects(adapter.setParent(7, 6), /403/u);
    await writeFile(behavior, "unsupported");
    await adapter.setParent(7, 6);
  } finally {
    process.env.PATH = originalPath;
  }
});
