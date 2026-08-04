import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readAcceptedAttempt } from "../src/accepted-attempts.js";
import { attemptWork } from "../src/attempt-work.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { loadPromptTemplates } from "../src/prompts.js";
import { runCommand } from "../src/process.js";
import {
  codexCompletionEvent,
  completeReviewWithNoFindings,
} from "./helpers/agent-events.js";

test("a completed execution is committed and reviewed in a fresh session", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-reviewed-attempt-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const worktree = join(worktreesRoot, "lfi-1");
  const logs = join(root, ".lfi", "logs");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  const args = join(root, "codex-args");
  const prompts = join(root, "codex-prompt");
  const runLog: string[] = [];
  await mkdir(tools, { recursive: true });
  await mkdir(join(root, ".lfi", "prompts"), { recursive: true });
  await writeFile(
    join(root, ".lfi", "prompts", "review.md"),
    "CUSTOM REVIEW for {{BASE_REF}} via {{SKILL:code-review}}.\n",
  );
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
printf '%s\n' "$*" >> "${args}"
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
      config: {
        ...DEFAULT_CONFIG,
        ISOLATION_PROVIDER: "none",
        STANDARD_MODEL: "codex:worker:low",
        REVIEWER_MODEL: "codex:reviewer:high",
      },
      gitDirectory: join(root, ".git"),
      log: {
        directory: logs,
        startedAt: new Date().toISOString(),
        iteration: 1,
        output: {
          log: (message) => runLog.push(message),
          error: (message) => runLog.push(message),
          flush: async () => undefined,
        },
      },
      taskTemplate: "Implement {{TASK_ID}}.",
      promptTemplates: await loadPromptTemplates(join(root, ".lfi"), "en"),
      language: "en",
    });

    assert.equal(result.accepted, true, result.summary);
    assert.equal(result.summary, "implemented task");
    assert.equal(result.logName, "LFI-1");
    assert.equal(await readFile(calls, "utf8"), "1\n2\n");
    const invocationArgs = await readFile(args, "utf8");
    assert.match(invocationArgs, /--model worker\b/u);
    assert.match(invocationArgs, /--model reviewer\b/u);
    assert.match(invocationArgs, /model_reasoning_effort="low"/u);
    assert.match(invocationArgs, /model_reasoning_effort="high"/u);
    assert.equal(await git(worktree, "rev-list", "--count", "main..HEAD"), "1");
    const reviewPrompt = await readFile(`${prompts}.2`, "utf8");
    assert.match(reviewPrompt, /CUSTOM REVIEW for main via \$code-review/u);
    const findingsPath = /^Findings file: (.+)$/mu.exec(reviewPrompt)?.[1];
    assert.ok(findingsPath);
    assert.equal(findingsPath.startsWith(`${worktree}/`), false);
    assert.match(await readFile(join(logs, "LFI-1.log"), "utf8"), /implemented task/u);
    assert.match(await readFile(join(logs, "LFI-1-review.log"), "utf8"), /implemented task/u);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("review-disabled attempts execute and validate without review sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-without-review-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  const validationMarker = join(root, "validation-ran");
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
  await writeFile(join(tools, "codex"), `#!/bin/sh
printf 'called\\n' >> "${calls}"
printf 'implemented\\n' > result.txt
${codexCompletionEvent("completed", "implemented task")}
`);
  await chmod(join(tools, "codex"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const result = await attemptWork({
      cwd: root,
      worktreesRoot,
      baseRef: "main",
      task: { id: "LFI-4", number: 4, title: "Skip review", sourcePath: ".scratch/[READY] LFI-4 — skip-review.md", body: "Implement it." },
      config: {
        ...DEFAULT_CONFIG,
        ISOLATION_PROVIDER: "none",
        REVIEW_ENABLED: false,
        VALIDATE_COMMAND: `printf validated > "${validationMarker}"`,
      },
      gitDirectory: join(root, ".git"),
      log: { directory: join(root, ".lfi", "logs"), startedAt: new Date().toISOString(), iteration: 1 },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });

    assert.equal(result.accepted, true, result.summary);
    assert.equal(await readFile(calls, "utf8"), "called\n");
    assert.equal(await readFile(validationMarker, "utf8"), "validated");
    await assert.rejects(readFile(join(root, ".lfi", "logs", "LFI-4-review.log"), "utf8"));
    await assert.rejects(readFile(join(root, ".lfi", "logs", "LFI-4-remediation.log"), "utf8"));
    await assert.rejects(readFile(join(root, ".lfi", "logs", "LFI-4-verification.log"), "utf8"));
  } finally {
    process.env.PATH = originalPath;
  }
});

const runAttemptWithReviewOutput = async (
  reviewOutput?: string,
  remediationCommits = false,
  config: Partial<typeof DEFAULT_CONFIG> = {},
  verificationOutput = JSON.stringify([{
    verdict: "unresolved",
    rationale: "The failure scenario still reproduces.",
  }]),
  language: "en" | "ru" = "en",
  verificationSummary = "phase completed",
) => {
  const root = await mkdtemp(join(tmpdir(), "lfi-review-outcome-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const worktree = join(worktreesRoot, "lfi-2");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  const logs = join(root, ".lfi", "logs");
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
    ? ":"
    : `printf '%s' '${reviewOutput}' > "$findings_path"`;
  const remediationAction = remediationCommits
    ? `if [ "$call" -eq 3 ]; then printf 'unowned\\n' > remediation.txt; git add remediation.txt; git commit -m 'agent: remediation fixture'; fi`
    : "";
  await writeFile(
    join(tools, "codex"),
    `#!/bin/sh
prompt=$(cat)
call=1
if [ -f "${calls}" ]; then call=$(( $(wc -l < "${calls}") + 1 )); fi
printf '%s\n' "$call" >> "${calls}"
if [ "$call" -eq 1 ]; then
  printf 'implemented\n' > result.txt
  ${codexCompletionEvent("completed", "phase completed")}
else
  findings_path=$(printf '%s\n' "$prompt" | sed -n 's/^Findings file: //p')
  if [ -n "$findings_path" ]; then ${writeFindings}; fi
  verdicts_path=$(printf '%s\n' "$prompt" | sed -n 's/^Verdicts file: //p')
  if [ -n "$verdicts_path" ]; then
    printf '%s' '${verificationOutput}' > "$verdicts_path"
    ${codexCompletionEvent("completed", verificationSummary)}
  else
    ${codexCompletionEvent("completed", "phase completed")}
  fi
fi
${remediationAction}
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
      config: { ...DEFAULT_CONFIG, ISOLATION_PROVIDER: "none", ...config },
      gitDirectory: join(root, ".git"),
      log: {
        directory: logs,
        startedAt: new Date().toISOString(),
        iteration: 1,
      },
      taskTemplate: "Implement {{TASK_ID}}.",
      language,
    });
    return { result, worktree, calls, logs };
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

test("a blocking finding without a failure scenario is logged and does not start remediation", async () => {
  const { result, calls, logs } = await runAttemptWithReviewOutput(JSON.stringify([{
    axis: "spec",
    severity: "blocking",
    description: "A required behavior is absent.",
  }]));

  assert.equal(result.accepted, true, result.summary);
  assert.equal(await readFile(calls, "utf8"), "1\n2\n");
  assert.match(
    await readFile(join(logs, "LFI-2-review.log"), "utf8"),
    /downgraded 1 blocking finding to advisory.*failure scenario/u,
  );
});

test("remediation and verification receive original blockers and a resolved verdict accepts the attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-remediated-attempt-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const worktree = join(worktreesRoot, "lfi-2");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  const args = join(root, "codex-args");
  const prompts = join(root, "codex-prompts");
  const findings = '[{ "axis":"spec", "severity":"blocking", "description":"A required behavior is absent.", "failureScenario":"Submitting an empty value reports success." }, { "axis":"standards", "severity":"blocking", "description":"An unsupported style is used." }]';
  const remediableFindings = JSON.stringify([{
    axis: "spec",
    severity: "blocking",
    description: "A required behavior is absent.",
    failureScenario: "Submitting an empty value reports success.",
  }]);
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
  await writeFile(join(tools, "codex"), `#!/bin/sh
prompt=$(cat)
call=1
if [ -f "${calls}" ]; then call=$(( $(wc -l < "${calls}") + 1 )); fi
printf '%s\\n' "$call" >> "${calls}"
printf '%s\\n' "$*" >> "${args}"
printf '%s' "$prompt" > "${prompts}.$call"
case "$call" in
  1) printf 'implemented\\n' > result.txt ;;
  2) findings_path=$(printf '%s\\n' "$prompt" | sed -n 's/^Findings file: //p'); printf '%s' '${findings}' > "$findings_path" ;;
  3) printf 'remediated\\n' > remediation.txt ;;
  4) test "$(git status --porcelain)" = ""; verdicts_path=$(printf '%s\\n' "$prompt" | sed -n 's/^Verdicts file: //p'); printf '[{"verdict":"resolved","rationale":"The empty value is rejected now."}]' > "$verdicts_path" ;;
esac
${codexCompletionEvent("completed", "phase completed")}
`);
  await chmod(join(tools, "codex"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const result = await attemptWork({
      cwd: root,
      worktreesRoot,
      baseRef: "main",
      task: { id: "LFI-2", number: 2, title: "Remediate findings", sourcePath: ".scratch/[READY] LFI-2 — remediation.md", body: "Fix it." },
      config: {
        ...DEFAULT_CONFIG,
        ISOLATION_PROVIDER: "none",
        STANDARD_MODEL: "codex:worker:low",
        REVIEWER_MODEL: "codex:reviewer:high",
      },
      gitDirectory: join(root, ".git"),
      log: { directory: join(root, ".lfi", "logs"), startedAt: new Date().toISOString(), iteration: 1 },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });
    assert.equal(result.accepted, true, result.summary);
    assert.equal(await readFile(calls, "utf8"), "1\n2\n3\n4\n");
    const invocationArgs = (await readFile(args, "utf8")).trim().split("\n");
    assert.match(invocationArgs[0] ?? "", /(?=.*--model worker\b)(?=.*model_reasoning_effort="low")/u);
    assert.match(invocationArgs[1] ?? "", /(?=.*--model reviewer\b)(?=.*model_reasoning_effort="high")/u);
    assert.match(invocationArgs[2] ?? "", /(?=.*--model worker\b)(?=.*model_reasoning_effort="low")/u);
    assert.match(invocationArgs[3] ?? "", /(?=.*--model reviewer\b)(?=.*model_reasoning_effort="high")/u);
    const remediationPrompt = await readFile(`${prompts}.3`, "utf8");
    const reReviewPrompt = await readFile(`${prompts}.4`, "utf8");
    assert.match(remediationPrompt, new RegExp(remediableFindings.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.match(reReviewPrompt, new RegExp(remediableFindings.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(remediationPrompt, /An unsupported style is used\./u);
    assert.doesNotMatch(reReviewPrompt, /An unsupported style is used\./u);
    assert.match(reReviewPrompt, /Verify whether .* resolved each original blocking finding/u);
    assert.match(reReviewPrompt, /Verdicts file:/u);
    assert.equal(await readFile(join(worktree, "remediation.txt"), "utf8"), "remediated\n");
  } finally {
    process.env.PATH = originalPath;
  }
});

test("an unresolved verification verdict rejects the attempt without another round", async () => {
  const { result, worktree, calls } = await runAttemptWithReviewOutput(
    JSON.stringify([{ axis: "spec", severity: "blocking", description: "A required behavior is absent.", failureScenario: "Submitting an empty value reports success." }]),
  );

  assert.equal(result.accepted, false);
  assert.match(result.summary, /Verification phase exhausted 1 remediation round with unresolved findings:/u);
  assert.match(result.summary, /A required behavior is absent\./u);
  assert.match(result.summary, /Rationale: The failure scenario still reproduces\./u);
  assert.equal(result.worktreePath, worktree);
  assert.equal(await readFile(calls, "utf8"), "1\n2\n3\n4\n");
});

test("verification exhaustion summary follows the configured language", async () => {
  const { result } = await runAttemptWithReviewOutput(
    JSON.stringify([{
      axis: "spec",
      severity: "blocking",
      description: "Обязательное поведение отсутствует.",
      failureScenario: "Пустое значение принимается.",
    }]),
    false,
    {},
    JSON.stringify([{
      verdict: "unresolved",
      rationale: "Пустое значение по-прежнему принимается.",
    }]),
    "ru",
  );

  assert.equal(result.accepted, false);
  assert.match(result.summary, /Этап верификации исчерпал 1 раунд исправления/u);
  assert.match(result.summary, /- Обязательное поведение отсутствует\./u);
  assert.match(result.summary, /Обоснование: Пустое значение по-прежнему принимается\./u);
});

test("verifier advisory notes are logged without affecting acceptance", async () => {
  const { result, logs } = await runAttemptWithReviewOutput(
    JSON.stringify([{
      axis: "spec",
      severity: "blocking",
      description: "A required behavior is absent.",
      failureScenario: "Submitting an empty value reports success.",
    }]),
    false,
    {},
    JSON.stringify([{
      verdict: "resolved",
      rationale: "The empty value is rejected now.",
    }]),
    "en",
    "Advisory: a neighboring cleanup could improve readability.",
  );

  assert.equal(result.accepted, true, result.summary);
  assert.match(
    await readFile(join(logs, "LFI-2-verification.log"), "utf8"),
    /Advisory: a neighboring cleanup could improve readability\./u,
  );
});

test("zero remediation rounds reject blocking review findings without remediation", async () => {
  const { result, worktree, calls } = await runAttemptWithReviewOutput(
    JSON.stringify([{ axis: "spec", severity: "blocking", description: "A required behavior is absent.", failureScenario: "Submitting an empty value reports success." }]),
    false,
    { MAX_REMEDIATION_ROUNDS: 0 },
  );

  assert.equal(result.accepted, false);
  assert.match(result.summary, /Review phase found blocking findings/u);
  assert.equal(result.worktreePath, worktree);
  assert.equal(await readFile(calls, "utf8"), "1\n2\n");
});

test("unresolved verdicts narrow the next remediation round and exhaustion lists verdict rationales", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-narrowed-remediation-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
  const prompts = join(root, "codex-prompts");
  const firstFinding = {
    axis: "spec",
    severity: "blocking",
    description: "The empty value is accepted.",
    failureScenario: "Submitting an empty value reports success.",
  };
  const secondFinding = {
    axis: "standards",
    severity: "blocking",
    description: "The required test is absent.",
    failureScenario: "A regression reaches the changed branch without a test.",
  };
  const findings = JSON.stringify([firstFinding, secondFinding]);
  const unresolvedFindings = JSON.stringify([secondFinding]);
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
  await writeFile(join(tools, "codex"), `#!/bin/sh
prompt=$(cat)
call=1
if [ -f "${calls}" ]; then call=$(( $(wc -l < "${calls}") + 1 )); fi
printf '%s\\n' "$call" >> "${calls}"
printf '%s' "$prompt" > "${prompts}.$call"
case "$call" in
  1) printf 'implemented\\n' > result.txt ;;
  2) findings_path=$(printf '%s\\n' "$prompt" | sed -n 's/^Findings file: //p'); printf '%s' '${findings}' > "$findings_path" ;;
  3|5) printf 'remediated\\n' > remediation.txt ;;
  4) verdicts_path=$(printf '%s\\n' "$prompt" | sed -n 's/^Verdicts file: //p'); printf '%s' '[{"verdict":"resolved","rationale":"The empty value is rejected now."},{"verdict":"unresolved","rationale":"The regression test remains absent."}]' > "$verdicts_path" ;;
  6) verdicts_path=$(printf '%s\\n' "$prompt" | sed -n 's/^Verdicts file: //p'); printf '%s' '[{"verdict":"unresolved","rationale":"The regression test is still absent."}]' > "$verdicts_path" ;;
esac
${codexCompletionEvent("completed", "phase completed")}
`);
  await chmod(join(tools, "codex"), 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${tools}:${originalPath ?? ""}`;
  try {
    const result = await attemptWork({
      cwd: root,
      worktreesRoot,
      baseRef: "main",
      task: { id: "LFI-2", number: 2, title: "Narrow remediation", sourcePath: ".scratch/[READY] LFI-2 — narrow.md", body: "Fix it." },
      config: { ...DEFAULT_CONFIG, ISOLATION_PROVIDER: "none", MAX_REMEDIATION_ROUNDS: 2 },
      gitDirectory: join(root, ".git"),
      log: { directory: join(root, ".lfi", "logs"), startedAt: new Date().toISOString(), iteration: 1 },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });

    assert.equal(result.accepted, false);
    assert.equal(await readFile(calls, "utf8"), "1\n2\n3\n4\n5\n6\n");
    const firstRemediationPrompt = await readFile(`${prompts}.3`, "utf8");
    const secondRemediationPrompt = await readFile(`${prompts}.5`, "utf8");
    assert.match(firstRemediationPrompt, new RegExp(findings.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.match(secondRemediationPrompt, new RegExp(unresolvedFindings.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(secondRemediationPrompt, /The empty value is accepted\./u);
    assert.match(result.summary, /The required test is absent\./u);
    assert.match(result.summary, /Rationale: The regression test is still absent\./u);
    assert.doesNotMatch(result.summary, /The empty value is accepted\./u);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("verification verdicts with the wrong count or shape fail the phase clearly", async () => {
  const finding = JSON.stringify([{
    axis: "spec",
    severity: "blocking",
    description: "A required behavior is absent.",
    failureScenario: "Submitting an empty value reports success.",
  }]);
  for (const invalidVerdicts of [
    "[]",
    '[{"verdict":"resolved","reason":"Wrong field."}]',
  ]) {
    const { result } = await runAttemptWithReviewOutput(
      finding,
      false,
      {},
      invalidVerdicts,
    );

    assert.equal(result.accepted, false);
    assert.match(
      result.summary,
      /Verification phase failed: the verdicts file is missing, invalid, or does not match the original findings/u,
    );
  }
});

test("verification failure summaries follow the configured language", async () => {
  const { result } = await runAttemptWithReviewOutput(
    JSON.stringify([{
      axis: "spec",
      severity: "blocking",
      description: "Поведение отсутствует.",
      failureScenario: "Пустое значение принимается.",
    }]),
    false,
    {},
    "[]",
    "ru",
  );

  assert.match(result.summary, /Этап верификации завершился ошибкой: файл вердиктов/u);
});

test("a remediation-created commit is rejected before verification", async () => {
  const { result, calls } = await runAttemptWithReviewOutput(
    JSON.stringify([{ axis: "spec", severity: "blocking", description: "A required behavior is absent.", failureScenario: "Submitting an empty value reports success." }]),
    true,
  );

  assert.equal(result.accepted, false);
  assert.match(result.summary, /Remediation phase failed.*created a commit/u);
  assert.equal(await readFile(calls, "utf8"), "1\n2\n3\n");
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

const resumableAttemptFixture = async (prefix: string) => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const stateRoot = join(root, ".lfi", "state");
  const worktree = join(worktreesRoot, "lfi-7");
  const tools = join(root, "tools");
  const calls = join(root, "codex-calls");
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
  // Phases are told apart by their prompt, not by a call counter, so the
  // fixture behaves the same across repeated attempts.
  await writeFile(join(tools, "codex"), `#!/bin/sh
prompt=$(cat)
printf 'called\\n' >> "${calls}"
findings_path=$(printf '%s\\n' "$prompt" | sed -n 's/^Findings file: //p')
if [ -n "$findings_path" ]; then
  printf '[]' > "$findings_path"
else
  printf 'implemented\\n' >> result.txt
fi
${codexCompletionEvent("completed", "implemented task")}
`);
  await chmod(join(tools, "codex"), 0o755);
  const callCount = async (): Promise<number> =>
    (await readFile(calls, "utf8").catch(() => "")).split("\n").filter(Boolean)
      .length;
  const attempt = () =>
    attemptWork({
      cwd: root,
      worktreesRoot,
      baseRef: "main",
      task: {
        id: "LFI-7",
        number: 7,
        title: "Resume an accepted attempt",
        sourcePath: ".scratch/[READY] LFI-7 — resume.md",
        body: "Implement it once.",
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
      stateRoot,
    });
  return { root, stateRoot, worktree, git, attempt, callCount };
};

test("an accepted attempt is recorded and reused without running agents again", async () => {
  const fixture = await resumableAttemptFixture("lfi-resume-accepted-");
  const originalPath = process.env.PATH;
  process.env.PATH = `${join(fixture.root, "tools")}:${originalPath ?? ""}`;
  try {
    const first = await fixture.attempt();
    assert.equal(first.accepted, true, first.summary);
    const callsAfterFirst = await fixture.callCount();
    assert.equal(callsAfterFirst, 2);
    const head = await fixture.git(fixture.worktree, "rev-parse", "HEAD");
    const record = await readAcceptedAttempt(fixture.stateRoot, "LFI-7");
    assert.equal(record?.commit, head);
    assert.equal(record?.baseRef, "main");
    assert.equal(
      record?.baseCommit,
      await fixture.git(fixture.root, "rev-parse", "main"),
    );

    const second = await fixture.attempt();

    assert.equal(second.accepted, true, second.summary);
    assert.match(second.summary, /Reused the attempt accepted earlier/u);
    assert.equal(second.worktreePath, fixture.worktree);
    assert.equal(second.branch, "lfi/lfi-7");
    assert.equal(await fixture.callCount(), callsAfterFirst);
    assert.equal(
      (await readAcceptedAttempt(fixture.stateRoot, "LFI-7"))?.commit,
      head,
    );
  } finally {
    process.env.PATH = originalPath;
  }
});

test("a dirty worktree invalidates the recorded acceptance and attempts again", async () => {
  const fixture = await resumableAttemptFixture("lfi-resume-dirty-");
  const originalPath = process.env.PATH;
  process.env.PATH = `${join(fixture.root, "tools")}:${originalPath ?? ""}`;
  try {
    const first = await fixture.attempt();
    assert.equal(first.accepted, true, first.summary);
    const callsAfterFirst = await fixture.callCount();
    await writeFile(join(fixture.worktree, "stray.txt"), "unowned\n");

    const second = await fixture.attempt();

    assert.equal(second.accepted, true, second.summary);
    assert.equal(second.summary, "implemented task");
    assert.equal(await fixture.callCount(), callsAfterFirst + 2);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("a moved worktree head invalidates the recorded acceptance and attempts again", async () => {
  const fixture = await resumableAttemptFixture("lfi-resume-moved-head-");
  const originalPath = process.env.PATH;
  process.env.PATH = `${join(fixture.root, "tools")}:${originalPath ?? ""}`;
  try {
    const first = await fixture.attempt();
    assert.equal(first.accepted, true, first.summary);
    const callsAfterFirst = await fixture.callCount();
    await writeFile(join(fixture.worktree, "later.txt"), "later\n");
    await fixture.git(fixture.worktree, "add", ".");
    await fixture.git(fixture.worktree, "commit", "-m", "test: move the head");
    const movedHead = await fixture.git(fixture.worktree, "rev-parse", "HEAD");

    const second = await fixture.attempt();

    assert.equal(second.accepted, true, second.summary);
    assert.equal(second.summary, "implemented task");
    assert.equal(await fixture.callCount(), callsAfterFirst + 2);
    const record = await readAcceptedAttempt(fixture.stateRoot, "LFI-7");
    assert.notEqual(record?.commit, movedHead);
    assert.equal(
      record?.commit,
      await fixture.git(fixture.worktree, "rev-parse", "HEAD"),
    );
  } finally {
    process.env.PATH = originalPath;
  }
});

test("attempt validation gates acceptance and records its observed result", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-attempt-validation-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const tools = join(root, "tools");
  const logs = join(root, ".lfi", "logs");
  await mkdir(tools);
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runCommand("git", args, { cwd });
    assert.equal(result.exitCode, 0, result.stderr);
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
${completeReviewWithNoFindings(codexCompletionEvent("completed", "reviewed"))}
printf 'implemented\n' > implemented.txt
git add implemented.txt
git commit -m 'agent: implement fixture'
${codexCompletionEvent("completed", "implemented")}
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
        title: "Validate attempt",
        sourcePath: ".scratch/[READY] LFI-2 — validate.md",
        body: "Create implemented.txt.",
      },
      config: {
        ...DEFAULT_CONFIG,
        ISOLATION_PROVIDER: "none",
        VALIDATE_COMMAND: "test -f implemented.txt; printf 'attempt validation output\\n'",
      },
      gitDirectory: join(root, ".git"),
      log: { directory: logs, startedAt: new Date().toISOString(), iteration: 1 },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });
    assert.equal(result.accepted, true, result.summary);
    const log = await readFile(join(logs, "LFI-2-validation.log"), "utf8");
    assert.match(log, /\$ test -f implemented\.txt/u);
    assert.match(log, /attempt validation output/u);
    assert.match(log, /exit=0/u);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("a failing observed validation rejects an agent-reported success and preserves the worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-attempt-validation-failure-"));
  const worktreesRoot = join(root, ".lfi", "worktrees");
  const tools = join(root, "tools");
  const logs = join(root, ".lfi", "logs");
  await mkdir(tools);
  const git = async (cwd: string, ...args: string[]) => {
    const result = await runCommand("git", args, { cwd });
    assert.equal(result.exitCode, 0, result.stderr);
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
${completeReviewWithNoFindings(codexCompletionEvent("completed", "reviewed"))}
printf 'implemented\n' > implemented.txt
git add implemented.txt
git commit -m 'agent: implement fixture'
${codexCompletionEvent("completed", "validation passed")}
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
        id: "LFI-3",
        number: 3,
        title: "Reject failed validation",
        sourcePath: ".scratch/[READY] LFI-3 — reject.md",
        body: "Create implemented.txt.",
      },
      config: {
        ...DEFAULT_CONFIG,
        ISOLATION_PROVIDER: "none",
        VALIDATE_COMMAND: "printf 'validation failure output\\n' >&2; exit 7",
      },
      gitDirectory: join(root, ".git"),
      log: { directory: logs, startedAt: new Date().toISOString(), iteration: 1 },
      taskTemplate: "Implement {{TASK_ID}}.",
      language: "en",
    });
    assert.equal(result.accepted, false);
    assert.match(result.summary, /Validation failed/u);
    assert.match(result.summary, /validation failure output/u);
    assert.equal(await readFile(join(result.worktreePath, "implemented.txt"), "utf8"), "implemented\n");
    const log = await readFile(join(logs, "LFI-3-validation.log"), "utf8");
    assert.match(log, /validation failure output/u);
    assert.match(log, /exit=7/u);
  } finally {
    process.env.PATH = originalPath;
  }
});
