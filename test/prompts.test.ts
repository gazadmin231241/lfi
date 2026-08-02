import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoDirectInstalledSkillReference,
  defaultTaskPrompt,
  mergerPrompt,
  reReviewPrompt,
  remediationPrompt,
  reviewPrompt,
  renderWorkerPrompt,
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

  assert.match(prompt, /Use \$implement and TDD where appropriate/u);
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
  assert.match(prompt, /Используй \$implement и TDD, где это уместно/u);
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
    assert.match(prompt, /\{\{SKILL:implement\}\}/u);
    assert.doesNotMatch(prompt, /\$implement/u);
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
  assert.match(codex, /<lfi:completion>/u);
  assert.match(pi, /Use \/skill:code-review/u);
  assert.match(pi, /Base ref: origin\/main/u);
  assert.match(russian, /Используй \$code-review/u);
  assert.match(russian, /единственный канал замечаний/u);
  assert.match(russian, /Заверши финальный ответ этим блоком завершения LFI/u);
});

test("review prompt requires an absolute findings path", () => {
  assert.throws(
    () => reviewPrompt("main", "findings.json", "codex", "en"),
    /absolute/u,
  );
});

test("remediation and targeted re-review prompts preserve bounded findings context", () => {
  const findings = '[{ "axis": "spec", "severity": "blocking", "description": "Missing behavior." }]';
  assert.match(remediationPrompt(findings, "en"), new RegExp(findings.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  const prompt = reReviewPrompt("main", "/var/tmp/re-review.json", findings, "codex", "en");
  assert.match(prompt, /only the original findings/u);
  assert.match(prompt, /regression risk/u);
  assert.match(prompt, new RegExp(findings.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
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
