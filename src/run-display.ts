import { access } from "node:fs/promises";
import { join } from "node:path";

import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";
import type { RunOutput } from "./logs.js";
import type { ExecutionTier } from "./execution-tier.js";
import type { ReasoningEffort } from "./config.js";

const majorRule = "=".repeat(50);
const minorRule = "-".repeat(50);

const section = (rule: string, title: string, body: string): string =>
  `\n${rule}\n${title}\n${rule}\n\n${body}`;

export const printIteration = (
  output: RunOutput,
  language: Language,
  stage: number,
  ids: readonly string[],
): void => {
  const title = `${localize(language, "Iteration", "Итерация")} ${stage}`;
  const runnable = localize(language, "Runnable", "Доступны");
  output.log(section(majorRule, title, `  ${runnable}: ${ids.join(", ")}`));
};

export const printWorkStarted = (
  output: RunOutput,
  language: Language,
  id: string,
  model: string,
  reasoning: ReasoningEffort,
): void => {
  const modelName =
    model || localize(language, "Codex default", "по умолчанию Codex");
  output.log(
    `\n  ${id}\n    ${localize(language, "Work started", "Работа началась")}\n    ${modelName} · ${reasoning}`,
  );
};

export const printWorkFinished = (
  output: RunOutput,
  language: Language,
  id: string,
  accepted: boolean,
): void => {
  output.log(
    `\n  ${id}\n    ${localize(
      language,
      accepted ? "Implementation completed" : "Implementation incomplete",
      accepted ? "Реализация завершена" : "Реализация не завершена",
    )}`,
  );
};

export const printIntegrationStarted = (
  output: RunOutput,
  language: Language,
  branches: readonly { id: string; branch: string }[],
): void => {
  const title = localize(language, "Integration", "Интеграция");
  output.log(
    section(
      minorRule,
      title,
      `${branches
        .map(
          ({ id, branch }) =>
            `    ${localize(language, "Merging branch", "Объединение ветки")}: ${branch} (${id})`,
        )
        .join("\n")}`,
    ),
  );
};

export const printValidationStarted = (
  output: RunOutput,
  language: Language,
): void => {
  output.log(
    `    ${localize(
      language,
      "Validating combined changes...",
      "Проверяются объединённые изменения...",
    )}`,
  );
};

export const printIntegrationCompleted = (
  output: RunOutput,
  language: Language,
  branch: string,
): void => {
  output.log(
    `    ${localize(
      language,
      "Combined validation passed",
      "Проверка объединённых изменений пройдена",
    )}\n    ${localize(
      language,
      `Changes merged into ${branch}`,
      `Изменения добавлены в ${branch}`,
    )}`,
  );
};

export const printIntegrationFailed = async (
  output: RunOutput,
  language: Language,
  reason: string,
  validationCommand: string | undefined,
  logsRoot: string,
): Promise<void> => {
  const detail = reason
    .split("\n")
    .filter((line) => line.trim())
    .slice(-20)
    .map((line) => `      ${line}`)
    .join("\n");
  const command = validationCommand
    ? `\n    ${localize(language, "Validation command", "Команда проверки")}: ${validationCommand}`
    : "";
  const fullOutput = await access(join(logsRoot, "integration.log"))
    .then(
      () =>
        `\n    ${localize(
          language,
          "Full output",
          "Полный вывод",
        )}: .lfi/logs/integration.log`,
    )
    .catch(() => "");
  output.error(
    `    ${localize(
      language,
      "Integration failed",
      "Интеграция завершилась с ошибкой",
    )}${command}\n${detail}${fullOutput}`,
  );
};

const taskLogName = (id: string): string =>
  id.startsWith("#") ? `issue-${id.slice(1)}` : id;

export const reportUnavailableModelSkip = (
  output: RunOutput,
  language: Language,
  reportedIds: Set<string>,
  id: string,
  tier: ExecutionTier,
  model: string,
): string => {
  const summary = localize(
    language,
    `${id} was skipped because the configured ${tier} tier model ${model} is unavailable.`,
    `${id} пропущена: настроенная модель ${model} уровня ${tier} недоступна.`,
  );
  if (!reportedIds.has(id)) {
    output.error(summary);
    reportedIds.add(id);
  }
  return summary;
};

export const printRunSummary = async (
  output: RunOutput,
  language: Language,
  completed: readonly string[],
  unresolved: readonly [string, string][],
  logsRoot: string,
): Promise<void> => {
  const title = localize(language, "Summary", "Итог");
  const lines: string[] = [];
  if (completed.length > 0) {
    lines.push(
      `  ${localize(language, "Completed", "Завершено")}: ${completed.join(", ")}`,
    );
  }
  if (unresolved.length > 0) {
    lines.push(
      `  ${localize(language, "Incomplete", "Не завершено")}: ${unresolved
        .map(([id]) => id)
        .join(", ")}`,
    );
    for (const [id, reason] of unresolved) {
      const firstLine = reason.split("\n").find((line) => line.trim()) ?? reason;
      lines.push(`    ${id}: ${firstLine}`);
      const name = taskLogName(id);
      const taskLog = `${name}.log`;
      if (await access(join(logsRoot, taskLog)).then(() => true).catch(() => false)) {
        lines.push(
          `      ${localize(language, "Log", "Лог")}: .lfi/logs/${taskLog}`,
        );
      }
    }
  }
  if (lines.length === 0) {
    lines.push(
      `  ${localize(language, "No runnable tasks", "Нет доступных задач")}`,
    );
  }
  output.log(section(minorRule, title, lines.join("\n")));
};
