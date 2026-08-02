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

test("English worker prompt bounds complete review and validation", () => {
  const prompt = renderWorkerPrompt(
    "Start {{TASK_ID}}.",
    task,
    "codex",
    "en",
  );

  assert.match(prompt, /one complete two-axis review/u);
  assert.match(prompt, /Standards and Spec reviewers in parallel/u);
  assert.match(prompt, /Do not invoke \$code-review a second time/u);
  assert.match(prompt, /targeted confirmation/u);
  assert.match(prompt, /only the review axes/u);
  assert.match(prompt, /known blocking finding/u);
  assert.match(prompt, /specification compliance, user-visible correctness/u);
  assert.match(prompt, /Code smells and preferences are advisory/u);
  assert.match(
    prompt,
    /Documentation, comments, and unambiguous local naming changes do not require confirmation unless the originating finding was blocking/u,
  );
  assert.match(prompt, /resolved, unresolved, or replaced by a regression/u);
  assert.match(prompt, /status "incomplete"/u);
  assert.match(prompt, /full repository validation after review remediation/u);
  assert.match(prompt, /Do not repeat an unchanged successful validation/u);
  assert.match(
    prompt,
    /End your final response with this LFI completion block/u,
  );
  assert.match(prompt, /<lfi:completion>/u);
  assert.match(prompt, /<\/lfi:completion>/u);
  assert.match(prompt, /Do not stage or commit changes yourself/u);
  assert.match(prompt, /LFI records the final worktree/u);
});

test("Russian worker prompt bounds complete review and validation", () => {
  const prompt = renderWorkerPrompt(
    "Начни {{TASK_ID}}.",
    task,
    "codex",
    "ru",
  );

  assert.match(prompt, /# Задача/u);
  assert.match(prompt, /# Ограничения LFI/u);
  assert.match(prompt, /одно полное двухосевое ревью/u);
  assert.match(prompt, /Standards и Spec параллельно/u);
  assert.match(prompt, /Не вызывай \$code-review второй раз/u);
  assert.match(prompt, /точечное подтверждение/u);
  assert.match(prompt, /только от тех направлений ревью/u);
  assert.match(prompt, /известным блокирующим замечанием/u);
  assert.match(
    prompt,
    /соответствие спецификации, видимую пользователю корректность/u,
  );
  assert.match(prompt, /Запахи кода и предпочтения являются advisory/u);
  assert.match(
    prompt,
    /Изменения документации, комментариев и однозначных локальных имён не требуют подтверждения, если только исходное замечание не было блокирующим/u,
  );
  assert.match(
    prompt,
    /устранено, не устранено или заменено регрессией/u,
  );
  assert.match(prompt, /статус "incomplete"/u);
  assert.match(prompt, /полную проверку репозитория после исправлений/u);
  assert.match(prompt, /Не повторяй неизменившуюся успешную проверку/u);
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

test("English worker prompt requires command evidence before reporting a failure", () => {
  const prompt = renderWorkerPrompt("Start {{TASK_ID}}.", task, "codex", "en");

  assert.match(prompt, /actually run the command/u);
  assert.match(prompt, /stderr or exit code/u);
  assert.match(prompt, /full-history fork, omit agent_type/u);
});

test("Pi worker prompt does not receive Codex subagent invocation syntax", () => {
  const prompt = renderWorkerPrompt("Start {{TASK_ID}}.", task, "pi", "en");

  assert.doesNotMatch(prompt, /full-history fork, omit agent_type/u);
});

test("worker prompt defines axis-scoped confirmation paths", () => {
  const english = renderWorkerPrompt("Implement.", task, "codex", "en");
  const russian = renderWorkerPrompt("Реализуй.", task, "codex", "ru");

  assert.match(english, /No relevant findings: do not run confirmation/u);
  assert.match(
    english,
    /Standards findings only: confirm with the Standards reviewer only/u,
  );
  assert.match(
    english,
    /Spec findings only: confirm with the Spec reviewer only/u,
  );
  assert.match(
    english,
    /Findings from both axes: confirm both in parallel/u,
  );
  assert.match(
    russian,
    /Нет релевантных замечаний: не запускай подтверждение/u,
  );
  assert.match(
    russian,
    /Замечания только от Standards: подтверждает только reviewer Standards/u,
  );
  assert.match(
    russian,
    /Замечания только от Spec: подтверждает только reviewer Spec/u,
  );
  assert.match(
    russian,
    /Замечания от обоих направлений: оба подтверждения запускаются параллельно/u,
  );
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
