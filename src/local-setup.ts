import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";

const IGNORE_BEGIN = "# LFI local tracker: begin";
const IGNORE_END = "# LFI local tracker: end";
const RUNTIME_IGNORE_RULE = ".lfi/*\n";
export const TRACKER_CONTRACT_MARKER = "<!-- lfi:tracker-contract -->";
const TRACKER_CONTRACT_BEGIN = "<!-- lfi:tracker-contract:begin -->";
const TRACKER_CONTRACT_END = "<!-- lfi:tracker-contract:end -->";
const AGENT_TRACKER_BEGIN = "<!-- lfi:agent-tracker:begin -->";
const AGENT_TRACKER_END = "<!-- lfi:agent-tracker:end -->";

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const configureAgentInstructions = async (
  cwd: string,
  language: Language,
): Promise<void> => {
  const claude = join(cwd, "CLAUDE.md");
  const agents = join(cwd, "AGENTS.md");
  const path = (await exists(claude)) ? claude : agents;
  const source = await readFile(path, "utf8").catch(() => "");
  const storage = localize(
    language,
    "Tasks and specs use LFI Local Markdown.",
    "Задачи и спецификации используют LFI Local Markdown.",
  );
  const block = localize(language, `${AGENT_TRACKER_BEGIN}
## Agent skills

### Issue tracker

${storage} See \`docs/agents/issue-tracker.md\`.
${AGENT_TRACKER_END}
`,
  `${AGENT_TRACKER_BEGIN}
## Навыки агентов

### Трекер задач

${storage} См. \`docs/agents/issue-tracker.md\`.
${AGENT_TRACKER_END}
`);
  const managed = new RegExp(
    `${AGENT_TRACKER_BEGIN}[\\s\\S]*?${AGENT_TRACKER_END}\\r?\\n?`,
    "u",
  );
  const legacyManaged =
    /## (?:Agent skills|Навыки агентов)\s+### (?:Issue tracker|Трекер задач)\s+(?:Tasks and specs use|Задачи и спецификации используют)[^\n]*\s+(?:See|См\.) `docs\/agents\/issue-tracker\.md`\.\r?\n?/u;
  if (
    !managed.test(source) &&
    !legacyManaged.test(source) &&
    (
      source.includes("docs/agents/issue-tracker.md") ||
      source.includes("### Issue tracker") ||
      source.includes("### Трекер задач")
    )
  ) {
    return;
  }
  const updated = managed.test(source)
    ? source.replace(managed, block)
    : legacyManaged.test(source)
      ? source.replace(legacyManaged, block.trimEnd())
      : `${source}${source && !source.endsWith("\n") ? "\n" : ""}${source ? "\n" : ""}${block}`;
  await writeFile(
    path,
    updated,
  );
};

const updateGitignore = (source: string): string => {
  const managed = new RegExp(
    `${IGNORE_BEGIN}[\\s\\S]*?${IGNORE_END}\\r?\\n?`,
    "u",
  );
  if (managed.test(source)) {
    return source.replace(managed, RUNTIME_IGNORE_RULE);
  }
  const withoutLegacyRules = source
    .split(/\r?\n/u)
    .filter(
      (line) =>
        line !== "!.lfi/tasks/" &&
        line !== "!.lfi/tasks/*.md" &&
        line !== "!.lfi/tasks/completed/" &&
        line !== "!.lfi/tasks/completed/*.md" &&
        line !== "!.lfi/specs/" &&
        line !== "!.lfi/specs/*.md",
    )
    .join("\n");
  const separator =
    withoutLegacyRules.length > 0 && !withoutLegacyRules.endsWith("\n")
      ? "\n"
      : "";
  const runtimeIgnored = [".lfi/", ".lfi/*"].some((rule) =>
    withoutLegacyRules.split(/\r?\n/u).includes(rule)
  );
  return `${withoutLegacyRules}${separator}${runtimeIgnored ? "" : RUNTIME_IGNORE_RULE}`;
};

export const configureTrackerContract = async (
  cwd: string,
  language: Language,
): Promise<void> => {
  await mkdir(join(cwd, "docs", "agents"), { recursive: true });
  const guidePath = join(cwd, "docs", "agents", "issue-tracker.md");
  const contract = localize(
    language,
    `${TRACKER_CONTRACT_BEGIN}
${TRACKER_CONTRACT_MARKER}
# Issue tracker: LFI

## Documents

Tracker documents live in \`.scratch/\`. A feature has one \`Type: spec\` document in
\`.scratch/<feature-slug>/\` and its tasks in
\`.scratch/<feature-slug>/issues/\`; a task without a specification is directly
in \`.scratch/\`. LFI preserves the feature directory name chosen at creation;
renaming a specification document does not rename or replace its directory.
Completed documents stay in place; there is no archive.

Every tracker document uses the filename
\`[STATUS] LFI-N — <slug>.md\`. \`[SPEC]\`, \`[READY]\`, \`[RUNNING]\`,
\`[BLOCKED]\`, and \`[DONE]\` are the status values; this filename is the only
place status is recorded. \`LFI-N\` is the stable, repository-wide identifier,
allocated monotonically even across identifiers found only in Git history. LFI
renames a document when its status changes.

## Language

Write the content of every tracker document — specifications, tasks, and every
other type — in English: titles, body text, acceptance criteria, and notes.
The contract's own vocabulary stays as defined here regardless of language:
the \`[STATUS]\` prefix, the \`LFI-N\` identifier, the \`Type:\`, \`Blocked by:\`,
and \`Tier:\` marker lines, and their values. Keep \`<slug>\` in filenames Latin
kebab-case.

## Marker lines

Every document has a mandatory \`Type:\` line: \`spec\`, \`task\`, \`research\`,
\`prototype\`, or \`grilling\`. Only \`Type: task\` is executable; every other
type is non-executable. A missing \`Type:\` line is an error.

\`Blocked by:\` lists comma-separated blocking \`LFI-N\` identifiers, or \`None\`
when there are none. A \`Type: task\` document also has \`Tier: light\`,
\`Tier: standard\`, or \`Tier: deep\`; the tier expresses required judgment and
cost of error, and LFI configuration maps it to a model.

## Wayfinding operations

Used by \`$wayfinder\`. A wayfinding map is a tracker document at
\`.scratch/<effort-slug>/[STATUS] LFI-N — map-<slug>.md\`; its decision tickets
are tracker documents at
\`.scratch/<effort-slug>/issues/[STATUS] LFI-N — <slug>.md\`. The map uses a
non-task \`Type:\`; a decision ticket uses \`Type: research\`, \`prototype\`,
\`grilling\`, or \`task\`. A ticket changed to \`Type: task\` becomes executable
without moving it. Blocking and the frontier use the \`Blocked by:\` and status
rules above.
${TRACKER_CONTRACT_END}
`,
    `${TRACKER_CONTRACT_BEGIN}
${TRACKER_CONTRACT_MARKER}
# Трекер задач: LFI

## Документы

Документы трекера находятся в \`.scratch/\`. У функции один документ \`Type: spec\` в
\`.scratch/<feature-slug>/\`, а её задачи — в
\`.scratch/<feature-slug>/issues/\`; задача без спецификации находится прямо в
\`.scratch/\`. LFI сохраняет имя каталога функции, выбранное при создании;
переименование документа спецификации не переименовывает и не заменяет его
каталог. Завершённые документы остаются на месте; каталога архива нет.

Каждый документ трекера использует имя
\`[STATUS] LFI-N — <slug>.md\`. \`[SPEC]\`, \`[READY]\`, \`[RUNNING]\`,
\`[BLOCKED]\` и \`[DONE]\` — значения статуса; статус записывается только в имени
файла. \`LFI-N\` — стабильный идентификатор в масштабе репозитория, который
монотонно выделяется с учётом ID, встречающихся только в истории Git. При
смене статуса LFI переименовывает документ.

## Язык

Содержимое каждого документа трекера — спецификаций, задач и всех остальных
типов — пиши на русском: заголовки, тело, критерии приёмки и заметки.
Собственные обозначения контракта остаются такими, как определены здесь,
независимо от языка: префикс \`[STATUS]\`, идентификатор \`LFI-N\`, строки-маркеры
\`Type:\`, \`Blocked by:\`, \`Tier:\` и их значения. \`<slug>\` в именах файлов
записывай латиницей в kebab-case.

## Строки-маркеры

В каждом документе обязательна строка \`Type:\`: \`spec\`, \`task\`,
\`research\`, \`prototype\` или \`grilling\`. Исполняется только \`Type: task\`;
все остальные типы неисполнимы. Отсутствующая строка \`Type:\` — ошибка.

\`Blocked by:\` содержит разделённые запятыми идентификаторы блокирующих
\`LFI-N\` или \`None\`, если их нет. Документ \`Type: task\` также содержит
\`Tier: light\`, \`Tier: standard\` или \`Tier: deep\`; уровень выражает
требуемое качество суждения и цену ошибки, а конфигурация LFI сопоставляет его
с моделью.

## Операции wayfinding

Используются \`$wayfinder\`. Карта wayfinding — это документ трекера в
\`.scratch/<effort-slug>/[STATUS] LFI-N — map-<slug>.md\`; её билеты-решения —
документы трекера в
\`.scratch/<effort-slug>/issues/[STATUS] LFI-N — <slug>.md\`. У карты
неисполняемый \`Type:\`; билет-решение использует \`Type: research\`,
\`prototype\`, \`grilling\` или \`task\`. Билет, изменённый на \`Type: task\`,
становится исполняемым без перемещения. Блокировки и frontier используют
указанные выше правила \`Blocked by:\` и статуса.
${TRACKER_CONTRACT_END}
`,
  );
  const source = await readFile(guidePath, "utf8").catch(() => "");
  const managed = new RegExp(
    `${TRACKER_CONTRACT_BEGIN}[\\s\\S]*?${TRACKER_CONTRACT_END}\\r?\\n?`,
    "u",
  );
  const legacyManaged = new RegExp(
    `${TRACKER_CONTRACT_MARKER}[\\s\\S]*?(?:Specifications are never executable\\.|Спецификации никогда не исполняются\\.)\\r?\\n?`,
    "u",
  );
  const updated = managed.test(source)
    ? source.replace(managed, contract)
    : legacyManaged.test(source)
      ? source.replace(legacyManaged, contract.trimEnd())
      : `${source}${source && !source.endsWith("\n") ? "\n" : ""}${source ? "\n" : ""}${contract}`;
  await writeFile(guidePath, updated);
  await configureAgentInstructions(cwd, language);
};

export const configureLocalTracker = async (
  cwd: string,
  language: Language = "en",
): Promise<void> => {
  await configureLocalTrackerStorage(cwd);
  await mkdir(join(cwd, "docs", "agents"), { recursive: true });
  await configureTrackerContract(cwd, language);
};

export const configureLocalTrackerStorage = async (
  cwd: string,
): Promise<void> => {
  await mkdir(join(cwd, ".scratch"), { recursive: true });
  const gitignorePath = join(cwd, ".gitignore");
  const source = await readFile(gitignorePath, "utf8").catch(() => "");
  const updated = updateGitignore(source);
  if (updated !== source) await writeFile(gitignorePath, updated);
};
