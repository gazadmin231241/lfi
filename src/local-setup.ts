import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  const guidePath = join(cwd, "docs", "agents", "issue-tracker.md");
  if (!(await exists(guidePath))) {
    await writeFile(
      guidePath,
      localize(
        language,
        `# Issue tracker: LFI Local Markdown

Specifications live as flat Markdown files in \`.lfi/specs/\`. Runnable tasks
live as \`.lfi/tasks/LFI-N-informative-slug.md\`; specs use the same filename
pattern in \`.lfi/specs/\`. Use one shared,
monotonically increasing \`LFI-N\` identifier sequence across both directories.
Tasks created from an approved breakdown use \`status: ready\`.
Before allocating an ID, include IDs from Git history; never reuse an ID from
a deleted file.
When completing a task by hand, add an ISO-8601 UTC \`completed_at\`; LFI adds
it automatically after integration.

When a skill publishes or reads tracker work, it must use these files rather
than GitHub or \`.scratch/\`. GitHub is only an explicit mirror managed by
\`lfi sync\`.
`,
        `# Трекер задач: LFI Local Markdown

Спецификации хранятся плоским списком Markdown-файлов в \`.lfi/specs/\`, а
исполняемые задачи — как \`.lfi/tasks/LFI-N-информативное-название.md\`;
спецификации используют тот же шаблон в \`.lfi/specs/\`. Используйте общую,
монотонно возрастающую последовательность идентификаторов \`LFI-N\` для обеих
папок. Задачи из утверждённой декомпозиции создаются со \`status: ready\`.
Перед выделением ID учитывайте ID из истории Git и не переиспользуйте номер
удалённого файла.
При ручном завершении добавляйте UTC-время \`completed_at\` в формате ISO-8601;
после интеграции LFI добавляет его автоматически.

При публикации и чтении задач навыки должны использовать эти файлы вместо
GitHub или \`.scratch/\`. GitHub — только явное зеркало, управляемое
командой \`lfi sync\`.
`,
      ),
    );
  }
  await configureAgentInstructions(cwd, language);
};
