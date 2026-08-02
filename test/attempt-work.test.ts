import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { attemptWork } from "../src/attempt-work.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { runCommand } from "../src/process.js";
import { codexCompletionEvent } from "./helpers/agent-events.js";

test("a completed execution is committed and reviewed in a fresh session", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-reviewed-attempt-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const worktree = join(worktreesRoot, "lfi-1");
  const logs = join(root, ".lfi", "logs");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  const prompts = join(root, "codex-prompt");
  await mkdir(tools, { recursive: true });
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runCommand("git", args, { cwd });
    assert.equal(result.exitCode, 0, result.stderr);
    return result.stdout.trim();
  };
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "LFI Test");
  await git(root, "config", "user.email", "lfi@example.test");
  await writeFile(join(root, "README.md"), "base\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test: initialize repository");
  await writeFile(
    join(tools, "codex"),
    `#!/bin/sh
prompt=$(cat)
call=1
if [ -f "${calls}" ]; then call=$(( $(wc -l < "${calls}") + 1 )); fi
printf '%s\n' "$call" >> "${calls}"
printf '%s' "$prompt" > "${prompts}.$call"
if [ "$call" -eq 1 ]; then
  printf 'implemented\n' > result.txt
else
  test "$(git status --porcelain)" = ""
  findings_path=$(printf '%s\n' "$prompt" | sed -n 's/^Findings file: //p')
  printf '[]' > "$findings_path"
fi
${codexCompletionEvent("completed", "implemented task")}
`,
  );
  await chmod(join(tools, "codex"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const result = await attemptWork({
      cwd: root,
      worktreesRoot,
      baseRef: "main",
      task: {
        id: "LFI-1",
        number: 1,
        title: "Review committed work",
        sourcePath: ".scratch/[READY] LFI-1 — review.md",
        body: "Implement the task, then review it.",
      },
      config: { ...DEFAULT_CONFIG, ISOLATION_PROVIDER: "none" },
      gitDirectory: join(root, ".git"),
      log: {
        directory: logs,
        startedAt: new Date().toISOString(),
        iteration: 1,
      },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });

    assert.equal(result.accepted, true, result.summary);
    assert.equal(result.summary, "implemented task");
    assert.equal(result.logName, "LFI-1");
    assert.equal(await readFile(calls, "utf8"), "1\n2\n");
    assert.equal(await git(worktree, "rev-list", "--count", "main..HEAD"), "1");
    const reviewPrompt = await readFile(`${prompts}.2`, "utf8");
    assert.match(reviewPrompt, /Use \$code-review/u);
    assert.match(reviewPrompt, /^Base ref: main$/mu);
    const findingsPath = /^Findings file: (.+)$/mu.exec(reviewPrompt)?.[1];
    assert.ok(findingsPath);
    assert.equal(findingsPath.startsWith(`${worktree}/`), false);
    assert.match(await readFile(join(logs, "LFI-1.log"), "utf8"), /implemented task/u);
    assert.match(await readFile(join(logs, "LFI-1-review.log"), "utf8"), /implemented task/u);
  } finally {
    process.env.PATH = originalPath;
  }
});

const runAttemptWithReviewOutput = async (reviewOutput?: string) => {
  const root = await mkdtemp(join(tmpdir(), "lfi-review-outcome-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const worktree = join(worktreesRoot, "lfi-2");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  await mkdir(tools, { recursive: true });
  const git = async (...args: string[]) => {
    const result = await runCommand("git", args, { cwd: root });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git("init", "-b", "main");
  await git("config", "user.name", "LFI Test");
  await git("config", "user.email", "lfi@example.test");
  await writeFile(join(root, "README.md"), "base\n");
  await git("add", ".");
  await git("commit", "-m", "test: initialize repository");
  const writeFindings = reviewOutput === undefined
    ? ""
    : `printf '%s' '${reviewOutput}' > "$findings_path"`;
  await writeFile(
    join(tools, "codex"),
    `#!/bin/sh
prompt=$(cat)
call=1
if [ -f "${calls}" ]; then call=$(( $(wc -l < "${calls}") + 1 )); fi
printf '%s\n' "$call" >> "${calls}"
if [ "$call" -eq 1 ]; then
  printf 'implemented\n' > result.txt
else
  findings_path=$(printf '%s\n' "$prompt" | sed -n 's/^Findings file: //p')
  ${writeFindings}
fi
${codexCompletionEvent("completed", "phase completed")}
`,
  );
  await chmod(join(tools, "codex"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const result = await attemptWork({
      cwd: root,
      worktreesRoot,
      baseRef: "main",
      task: {
        id: "LFI-2",
        number: 2,
        title: "Classify review findings",
        sourcePath: ".scratch/[READY] LFI-2 — findings.md",
        body: "Accept or reject the reviewed implementation.",
      },
      config: { ...DEFAULT_CONFIG, ISOLATION_PROVIDER: "none" },
      gitDirectory: join(root, ".git"),
      log: {
        directory: join(root, ".lfi", "logs"),
        startedAt: new Date().toISOString(),
        iteration: 1,
      },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });
    return { result, worktree, calls };
  } finally {
    process.env.PATH = originalPath;
  }
};

test("advisory-only review findings do not change acceptance", async () => {
  const { result } = await runAttemptWithReviewOutput(JSON.stringify([{
    axis: "standards",
    severity: "advisory",
    description: "A local name could be clearer.",
  }]));

  assert.equal(result.accepted, true, result.summary);
  assert.equal(result.summary, "phase completed");
  assert.equal(result.logName, "LFI-2");
});

test("a blocking review finding rejects and preserves the committed worktree", async () => {
  const { result, worktree, calls } = await runAttemptWithReviewOutput(
    JSON.stringify([{
      axis: "spec",
      severity: "blocking",
      description: "A required behavior is absent.",
    }]),
  );

  assert.equal(result.accepted, false);
  assert.match(result.summary, /Review phase/u);
  assert.equal(result.worktreePath, worktree);
  assert.equal(await readFile(join(worktree, "result.txt"), "utf8"), "implemented\n");
  assert.equal(await readFile(calls, "utf8"), "1\n2\n");
});

test("a completed review without a findings file is a review failure", async () => {
  const { result, worktree } = await runAttemptWithReviewOutput();

  assert.equal(result.accepted, false);
  assert.match(result.summary, /Review phase failed/u);
  assert.equal(result.worktreePath, worktree);
});

test("a completed review with unparsable findings is a review failure", async () => {
  const { result } = await runAttemptWithReviewOutput("not json");

  assert.equal(result.accepted, false);
  assert.match(result.summary, /Review phase failed: the findings file is missing or invalid/u);
});

test("a merger that commits reused dirty work does not start a second worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-reused-dirty-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const worktree = join(worktreesRoot, "lfi-1");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  await mkdir(worktreesRoot, { recursive: true });
  await mkdir(tools);
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runCommand("git", args, { cwd });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "LFI Test");
  await git(root, "config", "user.email", "lfi@example.test");
  await writeFile(join(root, "result.txt"), "base\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "test: initialize repository");
  await git(root, "worktree", "add", "-b", "lfi/lfi-1", worktree, "main");
  await writeFile(join(worktree, "result.txt"), "task\n");
  await writeFile(join(root, "result.txt"), "main\n");
  await git(root, "commit", "-am", "fix: update main");
  await writeFile(
    join(tools, "codex"),
    `#!/bin/sh
printf 'called\\n' >> "${calls}"
printf 'combined\\n' > result.txt
${codexCompletionEvent("completed", "resolved existing work")}
`,
  );
  await chmod(join(tools, "codex"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const result = await attemptWork({
      cwd: root,
      worktreesRoot,
      baseRef: "main",
      task: {
        id: "LFI-1",
        number: 1,
        title: "Reuse existing work",
        sourcePath: ".scratch/[READY] LFI-1 — reuse.md",
        body: "Preserve the existing implementation.",
      },
      config: { ...DEFAULT_CONFIG, ISOLATION_PROVIDER: "none" },
      gitDirectory: join(root, ".git"),
      log: {
        directory: join(root, ".lfi", "logs"),
        startedAt: new Date().toISOString(),
        iteration: 1,
      },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });
    assert.equal(result.accepted, true, result.summary);
    assert.equal(await readFile(calls, "utf8"), "called\n");
    assert.equal(await readFile(join(worktree, "result.txt"), "utf8"), "combined\n");
  } finally {
    process.env.PATH = originalPath;
  }
});
