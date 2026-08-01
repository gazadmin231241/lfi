import assert from "node:assert/strict";
import test from "node:test";

import { renderWorkerPrompt } from "../src/prompts.js";
import type { WorkItem } from "../src/runner-types.js";

const task: WorkItem = {
  id: "LFI-3",
  number: 3,
  title: "Bound autonomous review convergence",
  sourcePath: ".lfi/tasks/review/tasks/[READY] LFI-3 — convergence.md",
  body: "Implement the review-convergence contract.",
};

test("English worker prompt bounds complete review and validation", () => {
  const prompt = renderWorkerPrompt(
    "Start {{TASK_ID}}.",
    task,
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
});

test("Russian worker prompt bounds complete review and validation", () => {
  const prompt = renderWorkerPrompt(
    "Начни {{TASK_ID}}.",
    task,
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
});

test("worker prompt defines axis-scoped confirmation paths", () => {
  const english = renderWorkerPrompt("Implement.", task, "en");
  const russian = renderWorkerPrompt("Реализуй.", task, "ru");

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
