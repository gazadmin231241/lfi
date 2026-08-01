import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";

const IGNORE_BEGIN = "# LFI local tracker: begin";
const IGNORE_END = "# LFI local tracker: end";
export const LOCAL_IGNORE_BLOCK = `${IGNORE_BEGIN}
.lfi/*
!.lfi/tasks/
!.lfi/tasks/**
${IGNORE_END}
`;
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
    return source.replace(managed, LOCAL_IGNORE_BLOCK);
  }
  const withoutLegacyRules = source
    .split(/\r?\n/u)
    .filter(
      (line) =>
        line !== ".lfi/" &&
        line !== ".lfi/*" &&
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
  return `${withoutLegacyRules}${separator}${LOCAL_IGNORE_BLOCK}`;
};

export const configureTrackerContract = async (
  cwd: string,
  language: Language,
): Promise<void> => {
  await mkdir(join(cwd, "docs", "agents"), { recursive: true });
  const guidePath = join(cwd, "docs", "agents", "issue-tracker.md");
  const storage = localize(
          language,
          `Each specification has its own directory at
\`.lfi/tasks/<specification-slug>/\`. It contains one \`type: spec\` document
and a \`tasks/\` subdirectory for its executable \`type: task\` documents.
Tasks without a specification are files directly in \`.lfi/tasks/\`. Completed
tasks stay beside their specification; there is no archive directory. All
documents share one monotonically increasing \`LFI-N\` ID sequence, including
IDs found in Git history. A task links to its specification with \`spec: LFI-N\`
and to blockers with \`blocked_by\`. Executable tasks store exactly one
\`execution_tier\` value: \`light\`, \`standard\`, or \`deep\`. LFI also renders
clickable \`Specification\` and \`Blocked by\` sections at the end of each task
and keeps their file links current. Approved tasks use \`status: ready\`.

\`$to-spec\` creates \`.lfi/tasks/<specification-slug>/\` and publishes one
\`type: spec\` document there. \`$to-tickets\` publishes one \`type: task\`
document per ticket in \`.lfi/tasks/<specification-slug>/tasks/\` and records
its \`spec\` relationship; tickets without a specification go directly in
\`.lfi/tasks/\`. Filenames start with the derived status, then the stable ID:
\`[READY] LFI-N — slug.md\`. LFI renames them when status changes.`,
          `Каждая спецификация хранится в собственном каталоге
\`.lfi/tasks/<specification-slug>/\`. В нём находится один документ \`type: spec\`
и подкаталог \`tasks/\` для её исполняемых документов \`type: task\`. Задачи без
спецификации хранятся файлами непосредственно в \`.lfi/tasks/\`. Завершённые
задачи остаются рядом со своей спецификацией; каталога архива нет. Все документы
используют одну монотонно возрастающую последовательность \`LFI-N\`, включая ID
из истории Git. Задача ссылается на спецификацию через \`spec: LFI-N\`, а на
блокеры — через \`blocked_by\`. Исполняемая задача хранит ровно один
\`execution_tier\`: \`light\`, \`standard\` или \`deep\`. В конце каждой задачи
LFI также отображает кликабельные разделы \`Specification\` и \`Blocked by\` и
обновляет ссылки при переименовании файлов. Утверждённые задачи используют
\`status: ready\`.

\`$to-spec\` создаёт \`.lfi/tasks/<specification-slug>/\` и публикует в нём один
документ \`type: spec\`. \`$to-tickets\` публикует по одному документу
\`type: task\` на задачу в \`.lfi/tasks/<specification-slug>/tasks/\` и
записывает связь \`spec\`; задачи без спецификации идут непосредственно в
\`.lfi/tasks/\`.
Имя файла начинается с вычисленного статуса, затем идёт стабильный ID:
\`[READY] LFI-N — slug.md\`. При изменении статуса LFI переименовывает файл.`,
        );
  const contract = localize(
      language,
      `${TRACKER_CONTRACT_BEGIN}
${TRACKER_CONTRACT_MARKER}
# Issue tracker: LFI

${storage}

Task creation assigns an abstract execution tier from required judgment and
cost of error; it never chooses a concrete model. LFI configuration maps tiers
to models.

Use \`[SPEC]\`, \`[READY]\`, \`[RUNNING]\`, \`[BLOCKED]\`, and \`[DONE]\` for
local filenames and status output. Specifications are never executable.
${TRACKER_CONTRACT_END}
`,
      `${TRACKER_CONTRACT_BEGIN}
${TRACKER_CONTRACT_MARKER}
# Трекер задач: LFI

${storage}

При создании задачи назначается абстрактный уровень выполнения по требуемому
качеству суждения и цене ошибки; конкретная модель не выбирается. Конфигурация
LFI сопоставляет уровни моделям.

Используйте \`[SPEC]\`, \`[READY]\`, \`[RUNNING]\`, \`[BLOCKED]\` и \`[DONE]\`
в именах локальных файлов и выводе статуса. Спецификации никогда не исполняются.
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
  const lfiRoot = join(cwd, ".lfi");
  await mkdir(join(lfiRoot, "tasks"), { recursive: true });
  const gitignorePath = join(cwd, ".gitignore");
  const source = await readFile(gitignorePath, "utf8").catch(() => "");
  const updated = updateGitignore(source);
  if (updated !== source) await writeFile(gitignorePath, updated);
};
