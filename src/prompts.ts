import {
  completionBlockClose,
  completionBlockOpen,
} from "./completion-result.js";
import {
  expandSkillPlaceholders,
  skillPlaceholder,
  type AgentProvider,
} from "./agent-provider.js";
import type { Language } from "./i18n.js";
import type { WorkItem } from "./runner-types.js";

const completionContractCopy: Record<Language, string> = {
  en: `End your final response with this LFI completion block, using exactly these tags and a JSON object with exactly the two fields shown:
${completionBlockOpen}
{"status":"completed","summary":"Briefly describe the completed work."}
${completionBlockClose}
Use status "incomplete" and explain what remains in the summary when the task is not fully complete.`,
  ru: `Заверши финальный ответ этим блоком завершения LFI, используя в точности эти теги и JSON-объект ровно с двумя показанными полями:
${completionBlockOpen}
{"status":"completed","summary":"Кратко опиши выполненную работу."}
${completionBlockClose}
Если задача завершена не полностью, используй статус "incomplete" и объясни в summary, что осталось сделать.`,
};

export const defaultTaskPrompt = (language: "en" | "ru"): string =>
  language === "ru"
    ? `Приступай к реализации: {{TASK_ID}}\n\nИспользуй ${skillPlaceholder("implement")}.\n\nВсе необходимые локальные изменения в рамках задачи заранее разрешены. Работай только в текущем worktree. Production deploy и SSH запрещены.\n`
    : `Start implementing: {{TASK_ID}}\n\nUse ${skillPlaceholder("implement")}.\n\nAll local changes required by the task are pre-approved. Work only in the current worktree. Production deploy and SSH are forbidden.\n`;

const directSkillReference = /\$([A-Za-z0-9][A-Za-z0-9-]*)/gu;

export const assertNoDirectInstalledSkillReference = (
  template: string,
  installedSkills: ReadonlySet<string>,
  language: Language = "en",
): void => {
  for (const match of template.matchAll(directSkillReference)) {
    const skill = match[1];
    if (!skill || !installedSkills.has(skill)) continue;
    const placeholder = skillPlaceholder(skill);
    throw new Error(
      language === "ru"
        ? `Шаблон prompt напрямую ссылается на установленный skill $${skill}. Используйте вместо него ${placeholder}.`
        : `Prompt template directly references installed skill $${skill}. Use ${placeholder} instead.`,
    );
  }
};

export const renderWorkerPrompt = (
  template: string,
  task: WorkItem,
  agent: AgentProvider,
  language: Language = "en",
): string => {
  const identifier = task.id;
  const constraints = workerConstraints(identifier, agent, language);
  const taskHeading = language === "ru" ? "Задача" : "Task";
  const constraintsHeading =
    language === "ru" ? "Ограничения LFI" : "LFI constraints";
  return `${expandSkillPlaceholders(agent, template
  .replaceAll("{{ISSUE_URL}}", task.sourcePath)
  .replaceAll("{{ISSUE_NUMBER}}", String(task.number))
  .replaceAll("{{ISSUE_TITLE}}", task.title)
  .replaceAll("{{TASK_ID}}", identifier))}

# ${taskHeading}

${task.body}

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
    en: "Schema changes, non-destructive migrations, dependencies, lockfile edits, root configuration, and file moves required by this task are pre-approved.",
    ru: "Изменения схемы, неразрушительные миграции, зависимости, lockfile, корневая конфигурация и перемещения файлов, необходимые для этой задачи, заранее разрешены.",
  },
  {
    en: "Never deploy, use production SSH, modify production data, delete database volumes, expose secrets, or force-push.",
    ru: "Никогда не выполняй deploy, не используй production SSH, не изменяй production-данные, не удаляй тома баз данных, не раскрывай секреты и не делай force-push.",
  },
  {
    en: `Use ${skillPlaceholder("implement")} and TDD where appropriate. During implementation, use focused tests and typechecking as feedback.`,
    ru: `Используй ${skillPlaceholder("implement")} и TDD, где это уместно. Во время реализации используй узкие тесты и typecheck как быструю обратную связь.`,
  },
  {
    en: `After implementation, invoke ${skillPlaceholder("code-review")} exactly once. This is one complete two-axis review with the Standards and Spec reviewers in parallel.`,
    ru: `После реализации вызови ${skillPlaceholder("code-review")} ровно один раз. Это одно полное двухосевое ревью: запусти reviewer-ов Standards и Spec параллельно.`,
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
    en: `Do not invoke ${skillPlaceholder("code-review")} a second time. A new blocker found inside the remediation scope must still be resolved; if it cannot be resolved and evidenced within this bounded protocol, return status "incomplete" and preserve the worktree.`,
    ru: `Не вызывай ${skillPlaceholder("code-review")} второй раз. Новый blocker внутри области исправлений всё равно должен быть устранён; если его нельзя устранить и подтвердить в рамках этого ограниченного протокола, верни статус "incomplete" и сохрани worktree.`,
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
    en: "Before reporting completion, stage and commit all task changes. LFI accepts only agent-created commits and a clean worktree.",
    ru: "Перед сообщением о завершении добавь изменения в индекс и создай commit. LFI принимает только commits, созданные агентом, и чистый worktree.",
  },
  {
    en: completionContractCopy.en,
    ru: completionContractCopy.ru,
  },
];

const workerConstraints = (
  identifier: string,
  agent: AgentProvider,
  language: Language,
): string =>
  [
    language === "ru"
      ? `Работай только над ${identifier}.`
      : `Work only on ${identifier}.`,
    ...workerConstraintCopy.map((copy) => expandSkillPlaceholders(agent, copy[language])),
  ]
    .map((constraint) => `- ${constraint}`)
    .join("\n");

export const mergerPrompt = (
  context: string,
  agent: AgentProvider,
  language: Language = "en",
  allowedPaths?: readonly string[],
): string => {
  const scope = allowedPaths
    ? language === "ru"
      ? `
Область исправления проверки:
${allowedPaths.map((path) => `- ${path}`).join("\n")}

Не изменяй пути вне этого списка.
`
      : `
Validation repair scope:
${allowedPaths.map((path) => `- ${path}`).join("\n")}

Do not modify paths outside this list.
`
    : "";
  if (language === "ru") {
    return expandSkillPlaceholders(agent, `Разреши текущую проблему интеграции в этом worktree.

Используй ${skillPlaceholder("resolving-merge-conflicts")}, когда выполняется merge. Сохрани оба
намерения, запусти проверку и никогда не прерывай merge, не выполняй deploy,
не используй SSH, не делай force-push и не затрагивай production. Добавь
разрешение в индекс и создай commit самостоятельно; LFI не создаёт commit за
агента.

Контекст:
${context}
${scope}
${completionContractCopy.ru}
`);
  }
  return expandSkillPlaceholders(agent, `Resolve the current integration problem in this worktree.

Use ${skillPlaceholder("resolving-merge-conflicts")} when a merge is in progress. Preserve both
intents, run validation, and never abort the merge, deploy, use SSH, force-push,
or touch production. Stage the resolution and create the commit yourself; LFI
does not commit for the agent.

Context:
${context}
${scope}
${completionContractCopy.en}
`);
};
