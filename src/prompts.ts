import type { Language } from "./i18n.js";
import type { WorkItem } from "./runner-types.js";

export const defaultTaskPrompt = (language: "en" | "ru"): string =>
  language === "ru"
    ? `Приступай к реализации: {{TASK_ID}}\n\nИспользуй $implement.\n\nВсе необходимые локальные изменения в рамках задачи заранее разрешены. Работай только в текущем worktree. Production deploy и SSH запрещены.\n`
    : `Start implementing: {{TASK_ID}}\n\nUse $implement.\n\nAll local changes required by the task are pre-approved. Work only in the current worktree. Production deploy and SSH are forbidden.\n`;

export const renderWorkerPrompt = (
  template: string,
  issue: WorkItem,
  language: Language = "en",
): string => {
  const identifier = issue.id;
  const constraints = workerConstraints(identifier, language);
  const taskHeading = language === "ru" ? "Задача" : "Task";
  const constraintsHeading =
    language === "ru" ? "Ограничения LFI" : "LFI constraints";
  return `${template
  .replaceAll("{{ISSUE_URL}}", issue.url)
  .replaceAll("{{ISSUE_NUMBER}}", String(issue.number))
  .replaceAll("{{ISSUE_TITLE}}", issue.title)
  .replaceAll("{{TASK_ID}}", identifier)}

# ${taskHeading}

${issue.body}

# ${constraintsHeading}

${constraints}
`;
};

interface LocalizedConstraint {
  en: string;
  ru: string;
}

const workerConstraintCopy: readonly LocalizedConstraint[] = [
  {
    en: "Read the applicable AGENTS.md files and use installed user skills.",
    ru: "Прочитай применимые файлы AGENTS.md и используй установленные пользовательские skills.",
  },
  {
    en: "Schema changes, non-destructive migrations, dependencies, lockfile edits, root configuration, and file moves required by this issue are pre-approved.",
    ru: "Изменения схемы, неразрушительные миграции, зависимости, lockfile, корневая конфигурация и перемещения файлов, необходимые для этой задачи, заранее разрешены.",
  },
  {
    en: "Never deploy, use production SSH, modify production data, delete database volumes, expose secrets, or force-push.",
    ru: "Никогда не выполняй deploy, не используй production SSH, не изменяй production-данные, не удаляй тома баз данных, не раскрывай секреты и не делай force-push.",
  },
  {
    en: "Use $implement and TDD where appropriate. During implementation, use focused tests and typechecking as feedback.",
    ru: "Используй $implement и TDD, где это уместно. Во время реализации используй узкие тесты и typecheck как быструю обратную связь.",
  },
  {
    en: "After implementation, invoke $code-review exactly once. This is one complete two-axis review with the Standards and Spec reviewers in parallel.",
    ru: "После реализации вызови $code-review ровно один раз. Это одно полное двухосевое ревью: запусти reviewer-ов Standards и Spec параллельно.",
  },
  {
    en: "Aggregate the review findings before editing, then fix all blocking findings and only local, in-scope advisory findings as one coherent remediation batch.",
    ru: "Перед изменениями собери все замечания, затем исправь одним связным пакетом все блокирующие замечания и только локальные advisory-замечания в рамках задачи.",
  },
  {
    en: "Classify findings involving specification compliance, user-visible correctness, security, data integrity, mandatory repository rules, or other confirmed contracts as blocking. Code smells and preferences are advisory unless they expose one of those risks.",
    ru: "Считай блокирующими замечания, затрагивающие соответствие спецификации, видимую пользователю корректность, безопасность, целостность данных, обязательные правила репозитория или другие подтверждённые контракты. Запахи кода и предпочтения являются advisory, если только они не выявляют один из этих рисков.",
  },
  {
    en: "If remediation substantively changes behavior, contracts, data, security, concurrency, process execution, or test semantics, request targeted confirmation from only the review axes whose findings caused those changes. Documentation, comments, and unambiguous local naming changes do not require confirmation unless the originating finding was blocking. Reuse the original reviewer when possible; otherwise provide a replacement verifier the exact findings, remediation, affected areas, and focused test evidence.",
    ru: "Если исправления существенно меняют поведение, контракты, данные, безопасность, конкурентность, запуск процессов или семантику тестов, запроси точечное подтверждение только от тех направлений ревью, чьи замечания привели к этим изменениям. Изменения документации, комментариев и однозначных локальных имён не требуют подтверждения, если только исходное замечание не было блокирующим. По возможности используй исходного reviewer-а; иначе передай заменяющему verifier-у точные замечания, исправления, затронутые области и результаты узких тестов.",
  },
  {
    en: `Apply this confirmation matrix:
  - No relevant findings: do not run confirmation.
  - Standards findings only: confirm with the Standards reviewer only.
  - Spec findings only: confirm with the Spec reviewer only.
  - Findings from both axes: confirm both in parallel.`,
    ru: `Используй эту матрицу подтверждения:
  - Нет релевантных замечаний: не запускай подтверждение.
  - Замечания только от Standards: подтверждает только reviewer Standards.
  - Замечания только от Spec: подтверждает только reviewer Spec.
  - Замечания от обоих направлений: оба подтверждения запускаются параллельно.`,
  },
  {
    en: "Targeted confirmation checks the original findings, remediation, nearby regression risk, and supporting evidence. For each original finding, report whether it is resolved, unresolved, or replaced by a regression caused by remediation, and include its review axis and outcome in the agent message. Confirmation must not restart discovery over the complete diff or create a new advisory-refactoring cycle.",
    ru: "Точечное подтверждение проверяет исходные замечания, исправления, риск ближайших регрессий и подтверждающие результаты. Для каждого исходного замечания укажи результат: устранено, не устранено или заменено регрессией из-за исправления; добавь направление ревью и результат в сообщение агента. Подтверждение не должно заново исследовать весь diff или запускать новый цикл advisory-рефакторинга.",
  },
  {
    en: 'Do not invoke $code-review a second time. A new blocker found inside the remediation scope must still be resolved; if it cannot be resolved and evidenced within this bounded protocol, return status "incomplete" and preserve the worktree.',
    ru: 'Не вызывай $code-review второй раз. Новый blocker внутри области исправлений всё равно должен быть устранён; если его нельзя устранить и подтвердить в рамках этого ограниченного протокола, верни статус "incomplete" и сохрани worktree.',
  },
  {
    en: "Never report completion with a known blocking finding. When no finding requires confirmation under the rules above, skip confirmation.",
    ru: "Никогда не сообщай о завершении задачи с известным блокирующим замечанием. Если по правилам выше ни одно замечание не требует подтверждения, пропусти подтверждение.",
  },
  {
    en: "Run the full repository validation after review remediation and any targeted confirmation, so it checks the final code. Do not repeat an unchanged successful validation; after a failure, diagnose or change code before rerunning it.",
    ru: "Запусти полную проверку репозитория после исправлений по ревью и всех точечных подтверждений, чтобы проверить финальный код. Не повторяй неизменившуюся успешную проверку; после ошибки сначала проведи диагностику или измени код.",
  },
  {
    en: "Make the stages legible in your agent messages: complete review, remediation, targeted confirmation by axis when required, and final validation. Do not include secrets, credentials, tokens, prompts containing them, or process environments in logs.",
    ru: "Явно отмечай этапы в сообщениях агента: полное ревью, исправления, точечное подтверждение по направлениям, когда оно требуется, и финальная проверка. Не включай в логи секреты, учётные данные, токены, содержащие их prompts или окружение процессов.",
  },
  {
    en: "Do not run git add or git commit. The Codex sandbox intentionally protects Git metadata; after a successful response, the LFI host stages and commits the worktree.",
    ru: "Не запускай git add или git commit. Sandbox Codex намеренно защищает Git metadata; после успешного ответа host-процесс LFI сам добавит изменения и создаст commit.",
  },
  {
    en: 'Your final response must conform to the output schema. Use status "completed" only when the entire issue is implemented, reviewed, and tested. Otherwise use "incomplete" and explain the remaining work.',
    ru: 'Финальный ответ должен соответствовать output schema. Используй статус "completed", только если задача полностью реализована, прошла ревью и тесты. Иначе используй "incomplete" и объясни, что осталось сделать.',
  },
];

const workerConstraints = (
  identifier: string,
  language: Language,
): string =>
  [
    language === "ru"
      ? `Работай только над ${identifier}.`
      : `Work only on ${identifier}.`,
    ...workerConstraintCopy.map((copy) => copy[language]),
  ]
    .map((constraint) => `- ${constraint}`)
    .join("\n");

export const mergerPrompt = (
  context: string,
): string => `Resolve the current integration problem in this worktree.

Use $resolving-merge-conflicts when a merge is in progress.
Read the relevant issue bodies and commit history, preserve both intents, and run the configured validation.
Do not run git add or git commit; the LFI host commits a successful resolution because the Codex sandbox protects Git metadata.
Never abort the merge, deploy, use SSH, force-push, or touch production.

Context:
${context}
`;
