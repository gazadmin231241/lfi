import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TaskSource } from "./config.js";
import type { Language } from "./i18n.js";
import { localize } from "./i18n.js";

const IGNORE_BEGIN = "# LFI local tracker: begin";
const IGNORE_END = "# LFI local tracker: end";
export const LOCAL_IGNORE_BLOCK = `${IGNORE_BEGIN}
.lfi/*
!.lfi/tasks/
!.lfi/tasks/*.md
!.lfi/specs/
!.lfi/specs/*.md
${IGNORE_END}
`;
export const TRACKER_CONTRACT_MARKER = "<!-- lfi:tracker-contract -->";

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
  if (
    source.includes("docs/agents/issue-tracker.md") ||
    source.includes("### Issue tracker") ||
    source.includes("### Трекер задач")
  ) {
    return;
  }
  const block = localize(
    language,
    `## Agent skills

### Issue tracker

Tasks and specs use LFI Local Markdown. See \`docs/agents/issue-tracker.md\`.
`,
    `## Навыки агентов

### Трекер задач

Задачи и спецификации используют LFI Local Markdown. См. \`docs/agents/issue-tracker.md\`.
`,
  );
  await writeFile(
    path,
    `${source}${source && !source.endsWith("\n") ? "\n" : ""}${source ? "\n" : ""}${block}`,
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
  taskSource: TaskSource,
): Promise<void> => {
  await mkdir(join(cwd, "docs", "agents"), { recursive: true });
  const guidePath = join(cwd, "docs", "agents", "issue-tracker.md");
  const storage =
    taskSource === "local"
      ? localize(
          language,
          `Specifications are flat files in \`.lfi/specs/\`; executable tasks are
flat files in \`.lfi/tasks/\`. Both collections share one monotonically
increasing \`LFI-N\` ID sequence, including IDs found in Git history. A task
links to its specification with \`spec: LFI-N\` and to blockers with
\`blocked_by\`. Approved tasks use \`status: ready\`.

\`$to-spec\` publishes one \`type: spec\` document in \`.lfi/specs/\`.
\`$to-tickets\` publishes one \`type: task\` document per ticket in
\`.lfi/tasks/\` and records its \`spec\` relationship.`,
          `Спецификации хранятся плоскими файлами в \`.lfi/specs/\`, исполняемые
задачи — в \`.lfi/tasks/\`. Обе коллекции используют одну монотонно
возрастающую последовательность \`LFI-N\`, включая ID из истории Git. Задача
ссылается на спецификацию через \`spec: LFI-N\`, а на блокеры — через
\`blocked_by\`. Утверждённые задачи используют \`status: ready\`.

\`$to-spec\` публикует один документ \`type: spec\` в \`.lfi/specs/\`.
\`$to-tickets\` публикует по одному документу \`type: task\` на задачу в
\`.lfi/tasks/\` и записывает связь \`spec\`.`,
        )
      : localize(
          language,
          `Specifications are GitHub Issues labelled \`lfi:spec\`; executable tasks
are GitHub Issues labelled \`lfi:task\`. \`$to-spec\` publishes only
\`lfi:spec\`. \`$to-tickets\` publishes \`lfi:task\` Issues and uses native
parent and dependency relationships.`,
          `Спецификации — GitHub Issues с меткой \`lfi:spec\`, исполняемые задачи —
GitHub Issues с меткой \`lfi:task\`. \`$to-spec\` публикует только
\`lfi:spec\`. \`$to-tickets\` публикует Issues с \`lfi:task\` и использует
нативные родительские связи и зависимости.`,
        );
  await writeFile(
    guidePath,
    localize(
      language,
      `${TRACKER_CONTRACT_MARKER}
# Issue tracker: LFI

${storage}

Local \`type: spec\` and \`type: task\` map exactly to GitHub \`lfi:spec\` and
\`lfi:task\`. Skills never choose an execution model or assign model labels;
LFI configuration chooses models.

Use \`[SPEC]\`, \`[READY]\`, \`[RUNNING]\`, \`[BLOCKED]\`, and \`[DONE]\` as
the title/status prefixes. Specifications are never executable.
`,
      `${TRACKER_CONTRACT_MARKER}
# Трекер задач: LFI

${storage}

Локальные \`type: spec\` и \`type: task\` точно соответствуют GitHub
\`lfi:spec\` и \`lfi:task\`. Навыки не выбирают модель выполнения и не
назначают модельные метки; модели выбирает конфигурация LFI.

Используйте \`[SPEC]\`, \`[READY]\`, \`[RUNNING]\`, \`[BLOCKED]\` и \`[DONE]\`
как префиксы названия и статуса. Спецификации никогда не исполняются.
`,
    ),
  );
  await configureAgentInstructions(cwd, language);
};

export const configureLocalTracker = async (
  cwd: string,
  language: Language = "en",
): Promise<void> => {
  const lfiRoot = join(cwd, ".lfi");
  await Promise.all([
    mkdir(join(lfiRoot, "tasks"), { recursive: true }),
    mkdir(join(lfiRoot, "specs"), { recursive: true }),
    mkdir(join(cwd, "docs", "agents"), { recursive: true }),
  ]);
  const gitignorePath = join(cwd, ".gitignore");
  const source = await readFile(gitignorePath, "utf8").catch(() => "");
  await writeFile(gitignorePath, updateGitignore(source));
  await configureTrackerContract(cwd, language, "local");
};
