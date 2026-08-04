import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertNoDirectInstalledSkillReference,
  defaultMergePrompt,
  defaultRemediationPrompt,
  defaultReReviewPrompt,
  defaultReviewPrompt,
  defaultTaskPrompt,
  loadPromptTemplates,
  mergerPrompt,
  reReviewPrompt,
  remediationPrompt,
  reviewPrompt,
  renderWorkerPrompt,
  validatePromptTemplates,
} from "../src/prompts.js";
import type { WorkItem } from "../src/runner-types.js";

const task: WorkItem = {
  id: "LFI-3",
  number: 3,
  title: "Bound autonomous review convergence",
  sourcePath: ".scratch/review/issues/[READY] LFI-3 — convergence.md",
  body: "Implement the review-convergence contract.",
};

test("English worker prompt contains implementation, safety, and completion constraints", () => {
  const prompt = renderWorkerPrompt(
    "Start {{TASK_ID}}.",
    task,
    "codex",
    "en",
  );

  assert.match(prompt, /Use \$tdd where appropriate/u);
  assert.match(prompt, /focused tests and typechecking/u);
  assert.match(prompt, /Never deploy, use production SSH/u);
  assert.match(prompt, /force-push/u);
  assert.match(prompt, /Do not stage or commit changes yourself/u);
  assert.match(prompt, /actually run the command/u);
  assert.match(prompt, /stderr or exit code/u);
  assert.match(
    prompt,
    /End your final response with this LFI completion block/u,
  );
  assert.match(prompt, /<lfi:completion>/u);
  assert.match(prompt, /<\/lfi:completion>/u);
  assert.match(prompt, /LFI records the final worktree/u);
});

test("Russian worker prompt contains implementation, safety, and completion constraints", () => {
  const prompt = renderWorkerPrompt(
    "Начни {{TASK_ID}}.",
    task,
    "codex",
    "ru",
  );

  assert.match(prompt, /# Задача/u);
  assert.match(prompt, /# Ограничения LFI/u);
  assert.match(prompt, /Используй \$tdd, где это уместно/u);
  assert.match(prompt, /узкие тесты и typecheck/u);
  assert.match(prompt, /Никогда не выполняй deploy, не используй production SSH/u);
  assert.match(prompt, /force-push/u);
  assert.match(prompt, /Не добавляй изменения в индекс и не создавай commit/u);
  assert.match(prompt, /фактически выполни команду/u);
  assert.match(prompt, /stderr или exit code/u);
  assert.match(
    prompt,
    /Заверши финальный ответ этим блоком завершения LFI/u,
  );
  assert.match(prompt, /<lfi:completion>/u);
  assert.match(prompt, /<\/lfi:completion>/u);
});

test("English and Russian merger prompts require the completion block", () => {
  const english = mergerPrompt("Resolve integration.", "codex", "en");
  const russian = mergerPrompt("Разреши интеграцию.", "codex", "ru");

  assert.match(english, /End your final response with this LFI completion block/u);
  assert.match(english, /"status":"completed"/u);
  assert.match(english, /status "incomplete"/u);
  assert.match(russian, /Заверши финальный ответ этим блоком завершения LFI/u);
  assert.match(russian, /"status":"completed"/u);
  assert.match(russian, /статус "incomplete"/u);
  for (const prompt of [english, russian]) {
    assert.match(prompt, /<lfi:completion>/u);
    assert.match(prompt, /<\/lfi:completion>/u);
  }
});

test("Russian worker prompt delegates commit creation to LFI", () => {
  const prompt = renderWorkerPrompt("Начни {{TASK_ID}}.", task, "codex", "ru");

  assert.match(prompt, /Не добавляй изменения в индекс и не создавай commit/u);
  assert.match(prompt, /LFI зафиксирует итоговый worktree/u);
  assert.match(prompt, /фактически выполни команду/u);
  assert.match(prompt, /stderr или exit code/u);
});

test("worker prompts contain no provider-specific review protocol", () => {
  const customizedTemplate = "Custom task template for {{TASK_ID}}. Keep this text.";
  const prompts = [
    renderWorkerPrompt(customizedTemplate, task, "codex", "en"),
    renderWorkerPrompt(customizedTemplate, task, "pi", "en"),
    renderWorkerPrompt("Пользовательский шаблон для {{TASK_ID}}.", task, "codex", "ru"),
    renderWorkerPrompt("Пользовательский шаблон для {{TASK_ID}}.", task, "pi", "ru"),
  ];

  for (const prompt of prompts) {
    assert.doesNotMatch(prompt, /code-review/u);
    assert.doesNotMatch(prompt, /confirmation|подтвержден/u);
    assert.doesNotMatch(prompt, /known blocking finding|известным блокирующим замечанием/u);
    assert.doesNotMatch(prompt, /full-history fork/u);
  }
  assert.match(prompts[0] ?? "", /Custom task template for LFI-3\. Keep this text\./u);
});

test("built-in templates name skills through placeholders", () => {
  const english = defaultTaskPrompt("en");
  const russian = defaultTaskPrompt("ru");

  for (const prompt of [english, russian]) {
    assert.match(prompt, /\{\{SKILL:tdd\}\}/u);
    assert.doesNotMatch(prompt, /\$tdd/u);
  }
});

test("review prompt identifies the diff and external findings channel per provider", () => {
  const findingsPath = "/var/tmp/lfi-3-review-findings.json";
  const codex = reviewPrompt("main", findingsPath, "codex", "en");
  const pi = reviewPrompt("origin/main", findingsPath, "pi", "en");
  const russian = reviewPrompt("main", findingsPath, "codex", "ru");

  assert.match(codex, /Use \$code-review/u);
  assert.match(codex, /Base ref: main/u);
  assert.match(codex, /Findings file: \/var\/tmp\/lfi-3-review-findings\.json/u);
  assert.match(codex, /JSON array/u);
  assert.match(codex, /"standards" or "spec"/u);
  assert.match(codex, /"blocking" or "advisory"/u);
  assert.match(codex, /"failureScenario"/u);
  assert.match(codex, /blocking finding must provide a non-empty "failureScenario"/u);
  assert.match(codex, /concrete input or state and the incorrect behavior/u);
  assert.match(codex, /<lfi:completion>/u);
  assert.match(pi, /Use \/skill:code-review/u);
  assert.match(pi, /Base ref: origin\/main/u);
  assert.match(russian, /Используй \$code-review/u);
  assert.match(russian, /единственный канал замечаний/u);
  assert.match(russian, /"failureScenario"/u);
  assert.match(russian, /блокирующего замечания обязательно непустое поле "failureScenario"/u);
  assert.match(russian, /конкретным входом или состоянием и неверным поведением/u);
  assert.match(russian, /Заверши финальный ответ этим блоком завершения LFI/u);
});

test("review prompt requires an absolute findings path", () => {
  assert.throws(
    () => reviewPrompt("main", "findings.json", "codex", "en"),
    /absolute/u,
  );
});

test("remediation and verification prompts preserve bounded findings context", () => {
  const findings = '[{ "axis": "spec", "severity": "blocking", "description": "Missing behavior." }]';
  assert.match(remediationPrompt(findings, "en"), new RegExp(findings.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  const prompt = reReviewPrompt("main", "/var/tmp/re-review.json", findings, "codex", "en");
  assert.match(prompt, /resolved each original blocking finding/u);
  assert.match(prompt, /Do not search for new problems/u);
  assert.match(prompt, new RegExp(findings.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("verification prompt appends a localized verdict contract to the existing re-review template", () => {
  const findings = '[{"axis":"spec","severity":"blocking","description":"Exact original.","failureScenario":"Input fails."}]';
  const english = reReviewPrompt(
    "main",
    "/var/tmp/verdicts.json",
    findings,
    "codex",
    "en",
    "CUSTOM RE-REVIEW WITHOUT FINDINGS PLACEHOLDER",
  );
  const russian = reReviewPrompt(
    "main",
    "/var/tmp/verdicts-ru.json",
    findings,
    "codex",
    "ru",
    "СВОЯ ПРОВЕРКА БЕЗ PLACEHOLDER",
  );

  assert.match(english, /CUSTOM RE-REVIEW WITHOUT FINDINGS PLACEHOLDER/u);
  assert.match(english, /Original findings \(verbatim\):\n.*Exact original/u);
  assert.match(english, /Verdicts file: \/var\/tmp\/verdicts\.json/u);
  assert.match(english, /"verdict" \("resolved" or "unresolved"\).*"rationale"/u);
  assert.match(english, /Do not modify the worktree or create a commit/u);
  assert.match(russian, /СВОЯ ПРОВЕРКА БЕЗ PLACEHOLDER/u);
  assert.match(russian, /Исходные замечания \(дословно\):\n.*Exact original/u);
  assert.match(russian, /Verdicts file: \/var\/tmp\/verdicts-ru\.json/u);
  assert.match(russian, /"verdict" \("resolved" или "unresolved"\).*"rationale"/u);
  assert.match(russian, /Не изменяй worktree и не создавай commit/u);
});

test("direct installed skill references are refused with their placeholder", () => {
  assert.throws(
    () => assertNoDirectInstalledSkillReference("Use $implement.", new Set(["implement"])),
    /Use \{\{SKILL:implement\}\} instead/u,
  );
  assert.throws(
    () => assertNoDirectInstalledSkillReference("Используй $implement.", new Set(["implement"]), "ru"),
    /\{\{SKILL:implement\}\}/u,
  );
});

test("direct references that are not installed skills are allowed", () => {
  assert.doesNotThrow(() =>
    assertNoDirectInstalledSkillReference("The shell expands $HOME.", new Set(["implement"])),
  );
});

test("phase template validation rejects unknown scoped placeholders before rendering", async () => {
  const lfiRoot = await mkdtemp(join(tmpdir(), "lfi-invalid-placeholder-"));
  await mkdir(join(lfiRoot, "prompts"));
  await writeFile(join(lfiRoot, "prompts", "review.md"), "Review {{TASK_ID}}.\n");

  await assert.rejects(
    async () => validatePromptTemplates(await loadPromptTemplates(lfiRoot, "en"), new Set()),
    /\.lfi\/prompts\/review\.md.*\{\{TASK_ID\}\}/u,
  );
});

test("phase template validation rejects empty placeholders", async () => {
  const lfiRoot = await mkdtemp(join(tmpdir(), "lfi-empty-placeholder-"));
  await mkdir(join(lfiRoot, "prompts"));
  await writeFile(join(lfiRoot, "prompts", "review.md"), "Review {{}}.\n");

  await assert.rejects(
    async () => validatePromptTemplates(await loadPromptTemplates(lfiRoot, "en"), new Set()),
    /\.lfi\/prompts\/review\.md.*\{\{\}\}/u,
  );
});

test("phase template validation rejects empty custom and legacy files", async () => {
  const customRoot = await mkdtemp(join(tmpdir(), "lfi-empty-custom-prompt-"));
  await mkdir(join(customRoot, "prompts"));
  await writeFile(join(customRoot, "prompts", "merge.md"), " \n\t");
  const legacyRoot = await mkdtemp(join(tmpdir(), "lfi-empty-legacy-prompt-"));
  await writeFile(join(legacyRoot, "task-prompt.md"), "\n \t");

  await assert.rejects(
    async () => validatePromptTemplates(await loadPromptTemplates(customRoot, "en"), new Set()),
    /\.lfi\/prompts\/merge\.md.*empty/u,
  );
  await assert.rejects(
    async () => validatePromptTemplates(await loadPromptTemplates(legacyRoot, "en"), new Set()),
    /\.lfi\/task-prompt\.md.*empty/u,
  );
});

test("phase template validation rejects installed skill references in every phase", async () => {
  const lfiRoot = await mkdtemp(join(tmpdir(), "lfi-direct-skill-phase-"));
  await mkdir(join(lfiRoot, "prompts"));
  await writeFile(join(lfiRoot, "prompts", "re-review.md"), "Use $implement.\n");

  await assert.rejects(
    async () => validatePromptTemplates(await loadPromptTemplates(lfiRoot, "en"), new Set(["implement"])),
    /Use \{\{SKILL:implement\}\} instead/u,
  );
});

test("valid phase templates pass validation", async () => {
  const lfiRoot = await mkdtemp(join(tmpdir(), "lfi-valid-phase-prompts-"));
  await mkdir(join(lfiRoot, "prompts"));
  await writeFile(join(lfiRoot, "prompts", "task.md"), "Do {{TASK_ID}} with {{SKILL:implement}}.\n");
  await writeFile(join(lfiRoot, "prompts", "review.md"), "Check {{BASE_REF}} at {{FINDINGS_FILE}}.\n");
  await writeFile(join(lfiRoot, "prompts", "remediation.md"), "Fix {{FINDINGS}}.\n");
  await writeFile(join(lfiRoot, "prompts", "re-review.md"), "Recheck {{BASE_REF}} {{FINDINGS_FILE}} {{FINDINGS}}.\n");
  await writeFile(join(lfiRoot, "prompts", "merge.md"), "Merge {{INTEGRATION_CONTEXT}} {{ALLOWED_PATHS}}.\n");

  await assert.doesNotReject(
    async () => validatePromptTemplates(await loadPromptTemplates(lfiRoot, "en"), new Set(["implement"])),
  );
});

test("phase templates resolve custom files, legacy task fallback, and built-in defaults", async () => {
  const lfiRoot = await mkdtemp(join(tmpdir(), "lfi-prompts-"));
  await mkdir(join(lfiRoot, "prompts"));
  await writeFile(join(lfiRoot, "task-prompt.md"), "Legacy task {{TASK_ID}}.\n");
  await writeFile(join(lfiRoot, "prompts", "review.md"), "Custom review {{BASE_REF}}.\n");

  const templates = await loadPromptTemplates(lfiRoot, "en");

  assert.equal(templates.task.content, "Legacy task {{TASK_ID}}.\n");
  assert.equal(templates.task.source.kind, "legacy");
  assert.equal(templates.review.content, "Custom review {{BASE_REF}}.\n");
  assert.deepEqual(templates.review.source, {
    kind: "custom",
    path: join(".lfi", "prompts", "review.md"),
  });
  assert.equal(templates.remediation.source.kind, "built-in");
  assert.equal(templates["re-review"].source.kind, "built-in");
  assert.equal(templates.merge.source.kind, "built-in");
});

test("a phase file takes precedence over the legacy task template", async () => {
  const lfiRoot = await mkdtemp(join(tmpdir(), "lfi-task-prompt-"));
  await mkdir(join(lfiRoot, "prompts"));
  await writeFile(join(lfiRoot, "task-prompt.md"), "Legacy task.\n");
  await writeFile(join(lfiRoot, "prompts", "task.md"), "Custom task.\n");

  const templates = await loadPromptTemplates(lfiRoot, "en");

  assert.equal(templates.task.content, "Custom task.\n");
  assert.equal(templates.task.source.kind, "custom");
});

test("a missing prompts directory resolves every phase to stock behavior", async () => {
  const lfiRoot = await mkdtemp(join(tmpdir(), "lfi-stock-prompts-"));

  const templates = await loadPromptTemplates(lfiRoot, "ru");

  assert.equal(templates.task.content, defaultTaskPrompt("ru"));
  for (const phase of ["task", "review", "remediation", "re-review", "merge"] as const) {
    assert.equal(templates[phase].source.kind, "built-in");
  }
});

test("built-in editable substance excludes runner-owned protocols", () => {
  const editable = [
    defaultReviewPrompt("en"),
    defaultRemediationPrompt("en"),
    defaultReReviewPrompt("en"),
    defaultMergePrompt("en"),
  ];

  for (const template of editable) {
    assert.doesNotMatch(template, /<lfi:completion>/u);
    assert.doesNotMatch(template, /Do not (?:stage|modify the worktree)/u);
  }
  assert.doesNotMatch(defaultReviewPrompt("en"), /Findings file:/u);
  assert.doesNotMatch(defaultReviewPrompt("en"), /only findings channel/u);
  assert.doesNotMatch(defaultReReviewPrompt("en"), /Findings file:/u);
});

test("custom phase substance receives scoped placeholders while runner protocols remain appended", () => {
  const findings = '[{"axis":"spec","severity":"blocking","description":"Fix this."}]';
  const review = reviewPrompt(
    "main",
    "/var/tmp/review.json",
    "pi",
    "en",
    "Review {{BASE_REF}} at {{FINDINGS_FILE}} with {{SKILL:code-review}}.",
  );
  const taskPrompt = renderWorkerPrompt(
    "Do {{TASK_ID}} / {{ISSUE_NUMBER}} / {{ISSUE_TITLE}} / {{ISSUE_URL}} with {{SKILL:implement}}.",
    task,
    "pi",
    "en",
  );
  const remediation = remediationPrompt(
    findings,
    "en",
    "pi",
    "Repair verbatim: {{FINDINGS}} using {{SKILL:implement}}.",
  );
  const reReview = reReviewPrompt(
    "origin/main",
    "/var/tmp/re-review.json",
    findings,
    "pi",
    "en",
    "Recheck {{BASE_REF}} at {{FINDINGS_FILE}}: {{FINDINGS}} {{SKILL:code-review}}.",
  );
  const merge = mergerPrompt(
    "Resolve conflict A.",
    "pi",
    "en",
    ["one.ts", "two.ts"],
    "Integrate {{INTEGRATION_CONTEXT}}\n{{ALLOWED_PATHS}}\n{{SKILL:resolving-merge-conflicts}}",
  );

  assert.match(taskPrompt, /Do LFI-3 \/ 3 \/ Bound autonomous review convergence/u);
  assert.match(taskPrompt, /\/skill:implement/u);
  assert.match(review, /Review main at \/var\/tmp\/review\.json with \/skill:code-review/u);
  assert.match(review, /JSON array/u);
  assert.match(review, /findings file is the only findings channel/u);
  assert.match(review, /Do not modify the worktree or create a commit/u);
  assert.match(remediation, /Repair verbatim: \[\{"axis"/u);
  assert.match(remediation, /\/skill:implement/u);
  assert.match(remediation, /Do not stage or commit/u);
  assert.match(reReview, /Recheck origin\/main at \/var\/tmp\/re-review\.json/u);
  assert.match(reReview, /Fix this/u);
  assert.match(reReview, /JSON array/u);
  assert.match(merge, /Integrate Resolve conflict A\./u);
  assert.match(merge, /- one\.ts\n- two\.ts/u);
  assert.match(merge, /\/skill:resolving-merge-conflicts/u);
  assert.match(merge, /Do not stage or commit/u);
  for (const prompt of [review, remediation, reReview, merge]) {
    assert.match(prompt, /<lfi:completion>/u);
    assert.match(prompt, /<\/lfi:completion>/u);
  }
});
