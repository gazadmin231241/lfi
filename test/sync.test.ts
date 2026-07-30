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
  await mkdir(join(lfiRoot, "state"));
  await writeFile(
    join(lfiRoot, "state", "current-run.json"),
    JSON.stringify({ activeIssues: ["LFI-3"] }),
  );
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
    ...(status === "completed"
      ? { completedAt: "2026-01-01T00:00:00.000Z" }
      : {}),
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
  const parents: Array<[number, number | undefined]> = [];
  const dependencies: Array<[number, number[]]> = [];
  const closingComments: string[] = [];
  const parentState = new Map<number, number>();
  const blockerState = new Map<number, number[]>();
  let labelPreparations = 0;
  let next = 100;
  const adapter: GithubMirrorAdapter = {
    ensureTypeLabels: async () => {
      labelPreparations++;
    },
    findByLfiId: async () => undefined,
    getIssue: async (number) => issues.get(number),
    createIssue: async (desired) => {
      const issue = { number: next++, ...desired };
      issues.set(issue.number, issue);
      return issue;
    },
    updateIssue: async (issue, closingComment) => {
      issues.set(issue.number, issue);
      if (closingComment) closingComments.push(closingComment);
    },
    reconcileParent: async (child, parent) => {
      if (parentState.get(child) === parent) return;
      parents.push([child, parent]);
      if (parent === undefined) parentState.delete(child);
      else parentState.set(child, parent);
    },
    reconcileBlockers: async (child, blockers) => {
      if (
        JSON.stringify(blockerState.get(child) ?? []) ===
        JSON.stringify(blockers)
      ) {
        return;
      }
      dependencies.push([child, [...blockers]]);
      blockerState.set(child, [...blockers]);
    },
  };

  const preview = await syncGithubMirror(root, { adapter, dryRun: true });
  assert.deepEqual(preview.created, ["LFI-1", "LFI-2", "LFI-3"]);
  assert.equal(labelPreparations, 0);

  const first = await syncGithubMirror(root, { adapter });
  assert.equal(labelPreparations, 1);
  assert.deepEqual(first.created, ["LFI-1", "LFI-2", "LFI-3"]);
  assert.equal(issues.get(100)?.title, "[SPEC] LFI-1 — spec LFI-1");
  assert.equal(issues.get(101)?.title, "[DONE] LFI-2 — task LFI-2");
  assert.equal(issues.get(102)?.title, "[RUNNING] LFI-3 — task LFI-3");
  assert.deepEqual(issues.get(100)?.labels, ["lfi:spec"]);
  assert.deepEqual(issues.get(101)?.labels, ["lfi:task"]);
  assert.deepEqual(issues.get(102)?.labels, ["lfi:task"]);
  assert.deepEqual(parents, [[101, 100], [102, 100]]);
  assert.deepEqual(dependencies, [[102, [101]]]);
  assert.match(
    await readFile(join(lfiRoot, "tasks", "LFI-2-document.md"), "utf8"),
    /github_issue: 101/u,
  );

  adapter.findByLfiId = async (id) =>
    [...issues.values()].find((issue) => issue.title.includes(id));
  issues.set(102, {
    ...issues.get(102)!,
    labels: ["lfi:spec", "documentation"],
  });
  const second = await syncGithubMirror(root, { adapter });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.failed, []);
  assert.deepEqual(second.skipped, ["LFI-1", "LFI-2"]);
  assert.deepEqual(second.updated, ["LFI-3"]);
  assert.deepEqual(issues.get(102)?.labels, ["documentation", "lfi:task"]);
  assert.deepEqual(parents, [[101, 100], [102, 100]]);
  assert.deepEqual(dependencies, [[102, [101]]]);

  await writeFile(
    ready.path,
    serializeTrackerDocument({
      ...ready,
      status: "completed",
      completedAt: "2026-02-01T00:00:00.000Z",
    }),
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

  await writeFile(
    ready.path,
    serializeTrackerDocument({ ...ready, blockedBy: [] }),
  );
  await syncGithubMirror(root, { adapter });
  assert.deepEqual(dependencies.at(-1), [102, []]);
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
    createIssue: async (desired) => {
      if (desired.title.includes("LFI-2") && failCreate) {
        throw new Error("i/o timeout");
      }
      const issue = { number: next++, ...desired };
      issues.set(issue.number, issue);
      return issue;
    },
    updateIssue: async (issue) => {
      issues.set(issue.number, issue);
    },
    reconcileParent: async () => undefined,
    reconcileBlockers: async (_child, blockers) => {
      if (failRelationship && blockers.length > 0) {
        throw new Error("HTTP 403 forbidden");
      }
    },
  };

  const partial = await syncGithubMirror(root, { adapter });
  assert.deepEqual(partial.created, ["LFI-1"]);
  assert.equal(issues.get(50)?.title, "[READY] LFI-1 — Task LFI-1");
  assert.deepEqual(partial.failed.map((item) => item.id), ["LFI-2"]);
  assert.match(await readFile(firstTask.path, "utf8"), /github_issue: 50/u);
  assert.doesNotMatch(await readFile(secondTask.path, "utf8"), /github_issue/u);

  failCreate = false;
  const resumed = await syncGithubMirror(root, { adapter });
  assert.deepEqual(resumed.created, ["LFI-2"]);
  assert.deepEqual(resumed.failed, []);
  assert.equal(issues.get(51)?.title, "[BLOCKED] LFI-2 — Task LFI-2");
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
      printf '%s\\n' '[{"number":77,"title":"[READY] LFI-7 — Task","body":"Body","state":"OPEN","labels":[{"name":"lfi:task"}]}]'
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
    ).createIssue({
      title: "[READY] LFI-7 — Task",
      body: "Body",
      state: "open",
      labels: ["lfi:task"],
    });
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
    await assert.rejects(adapter.reconcileParent(7, 6), /403/u);
    await writeFile(behavior, "unsupported");
    await adapter.reconcileParent(7, 6);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("GitHub adapter reconciles changed and removed native relationships", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-sync-reconcile-"));
  const tools = join(root, "tools");
  const calls = join(root, "calls");
  await mkdir(tools);
  await writeFile(
    join(tools, "gh"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
case "$*" in
  *"issues/7/parent"*) printf '5\\n' ;;
  *"issues/7/dependencies/blocked_by"*"--jq .[].number"*)
    printf '8\\n9\\n'
    ;;
  *"issues/7 --jq .id"*) printf '700\\n' ;;
  *"issues/8 --jq .id"*) printf '800\\n' ;;
  *"issues/10 --jq .id"*) printf '1000\\n' ;;
esac
`,
  );
  await chmod(join(tools, "gh"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const adapter = createGhMirrorAdapter(root, "acme/widgets");
    await adapter.reconcileParent(7, 6);
    await adapter.reconcileBlockers(7, [9, 10]);
  } finally {
    process.env.PATH = originalPath;
  }
  const log = await readFile(calls, "utf8");
  assert.match(log, /--method DELETE repos\/acme\/widgets\/issues\/5\/sub_issue/u);
  assert.match(log, /--method POST repos\/acme\/widgets\/issues\/6\/sub_issues/u);
  assert.match(
    log,
    /--method DELETE repos\/acme\/widgets\/issues\/7\/dependencies\/blocked_by\/800/u,
  );
  assert.match(
    log,
    /--method POST repos\/acme\/widgets\/issues\/7\/dependencies\/blocked_by -F issue_id=1000/u,
  );
});
