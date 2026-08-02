import { isAbsolute } from "node:path";

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

export const reviewPrompt = (
  baseRef: string,
  findingsPath: string,
  agent: AgentProvider,
  language: Language = "en",
): string => {
  if (!isAbsolute(findingsPath)) {
    throw new Error("The review findings file path must be absolute.");
  }
  const prompt = language === "ru"
    ? `Проведи независимое ревью уже зафиксированных изменений в текущем worktree.

Используй ${skillPlaceholder("code-review")} для проверки diff относительно указанного base ref. Не сообщай LFI замечания в свободной форме: единственный канал замечаний — указанный JSON-файл.

Base ref: ${baseRef}
Findings file: ${findingsPath}

До завершения запиши в Findings file JSON-массив. Каждый элемент должен быть объектом ровно с тремя полями: "axis" ("standards" или "spec"), "severity" ("blocking" или "advisory") и строковым "description". Если замечаний нет, запиши []. Не изменяй worktree и не создавай commit.

${completionContractCopy.ru}
`
    : `Review the committed changes in the current worktree independently.

Use ${skillPlaceholder("code-review")} to review the diff against the specified base ref. Do not report findings to LFI in prose: the findings file is the only findings channel.

Base ref: ${baseRef}
Findings file: ${findingsPath}

Before completing, write a JSON array to the Findings file. Every item must be an object with exactly three fields: "axis" ("standards" or "spec"), "severity" ("blocking" or "advisory"), and a string "description". Write [] when there are no findings. Do not modify the worktree or create a commit.

${completionContractCopy.en}
`;
  return expandSkillPlaceholders(agent, prompt);
};

export const remediationPrompt = (
  findings: string,
  language: Language = "en",
): string => language === "ru"
  ? `Исправь блокирующие замечания независимого ревью в текущем worktree. Не создавай commit: LFI зафиксирует исправления перед повторным ревью.

Замечания ниже переданы дословно:
${findings}

${completionContractCopy.ru}
`
  : `Remediate the blocking findings from an independent review in the current worktree. Do not create a commit: LFI will commit the remediation before re-review.

The findings below are passed verbatim:
${findings}

${completionContractCopy.en}
`;

export const reReviewPrompt = (
  baseRef: string,
  findingsPath: string,
  originalFindings: string,
  agent: AgentProvider,
  language: Language = "en",
): string => {
  if (!isAbsolute(findingsPath)) {
    throw new Error("The review findings file path must be absolute.");
  }
  const prompt = language === "ru"
    ? `Проведи одно точечное повторное ревью зафиксированного исправления. Проверь только исходные замечания ниже и риск регрессии в исправленной области; не расширяй ревью.

Base ref: ${baseRef}
Findings file: ${findingsPath}

Исходные замечания (дословно):
${originalFindings}

До завершения запиши в Findings file JSON-массив с объектами ровно из полей "axis" ("standards" или "spec"), "severity" ("blocking" или "advisory") и "description". Запиши [] при отсутствии замечаний. Не изменяй worktree и не создавай commit.

${completionContractCopy.ru}
`
    : `Perform one targeted re-review of the committed remediation. Check only the original findings below and regression risk in the remediated area; do not broaden the review.

Base ref: ${baseRef}
Findings file: ${findingsPath}

Original findings (verbatim):
${originalFindings}

Before completing, write a JSON array to the Findings file. Every item must have exactly the fields "axis" ("standards" or "spec"), "severity" ("blocking" or "advisory"), and "description". Write [] when there are no findings. Do not modify the worktree or create a commit.

${completionContractCopy.en}
`;
  return expandSkillPlaceholders(agent, prompt);
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
    en: "Do not include secrets, credentials, tokens, prompts containing them, or process environments in logs.",
    ru: "Не включай в логи секреты, учётные данные, токены, содержащие их prompts или окружение процессов.",
  },
  {
    en: "Before reporting that a command is blocked or failed, actually run the command and cite its observed stderr or exit code. Do not infer filesystem restrictions from sandbox descriptions or permission metadata.",
    ru: "Перед сообщением, что команда заблокирована или завершилась ошибкой, фактически выполни команду и приведи наблюдаемый stderr или exit code. Не делай вывод об ограничениях файловой системы из описания sandbox или метаданных разрешений.",
  },
  {
    en: "Do not stage or commit changes yourself. LFI records the final worktree after you report successful completion.",
    ru: "Не добавляй изменения в индекс и не создавай commit самостоятельно. LFI зафиксирует итоговый worktree после сообщения об успешном завершении.",
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
не используй SSH, не делай force-push и не затрагивай production. Не добавляй
изменения в индекс и не создавай commit: после успешного завершения это сделает LFI.

Контекст:
${context}
${scope}
${completionContractCopy.ru}
`);
  }
  return expandSkillPlaceholders(agent, `Resolve the current integration problem in this worktree.

Use ${skillPlaceholder("resolving-merge-conflicts")} when a merge is in progress. Preserve both
intents, run validation, and never abort the merge, deploy, use SSH, force-push,
or touch production. Do not stage or commit the resolution; LFI records it after
you report successful completion.

Context:
${context}
${scope}
${completionContractCopy.en}
`);
};
