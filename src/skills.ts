import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";

import { requireCommand, runCommand } from "./process.js";
import { localize, type Language } from "./i18n.js";

export const SKILLS_COMMIT = "2ab958093e83e0ec752e6c1c5932da465bf23e0c";

export const SKILL_PATHS = [
  "skills/engineering/setup-matt-pocock-skills",
  "skills/engineering/to-spec",
  "skills/engineering/to-tickets",
  "skills/engineering/prototype",
  "skills/engineering/implement",
  "skills/engineering/tdd",
  "skills/engineering/code-review",
  "skills/engineering/resolving-merge-conflicts",
] as const;

const SKILL_OVERRIDE_MARKER = "<!-- lfi:skill-override -->";

type AdaptableSkill = "to-spec" | "to-tickets";

const skillAnchors: Readonly<Record<AdaptableSkill, readonly string[]>> = {
  "to-spec": ["Apply the `ready-for-agent` triage label"],
  "to-tickets": [
    ".scratch/<feature-slug>/issues/",
    "Apply the `ready-for-agent` triage label",
  ],
};

const isAdaptableSkill = (name: string): name is AdaptableSkill =>
  name === "to-spec" || name === "to-tickets";

const skillOverride = (name: "to-spec" | "to-tickets"): string =>
  name === "to-spec"
    ? `${SKILL_OVERRIDE_MARKER}
## LFI tracker override

Before following the process below, read \`docs/agents/issue-tracker.md\`. If it
contains \`lfi:tracker-contract\`, these rules take precedence over every later
tracker and path instruction in this skill:

- Allocate the next shared \`LFI-N\` and publish one
  \`type: spec\` document in a new \`.lfi/tasks/informative-slug/\` directory,
  named \`[SPEC] LFI-N — informative-slug.md\`.
- A specification is not executable.

If the marker is absent, follow the original process below unchanged.

## Переопределение LFI для трекера

Перед выполнением процесса ниже прочитайте \`docs/agents/issue-tracker.md\`. Если
он содержит \`lfi:tracker-contract\`, эти правила имеют приоритет над всеми
последующими инструкциями навыка о трекере и путях:

- Выделите следующий общий \`LFI-N\` и опубликуйте один
  документ \`type: spec\` в новом каталоге
  \`.lfi/tasks/informative-slug/\` с именем
  \`[SPEC] LFI-N — informative-slug.md\`.
- Спецификация не исполняется.

Если маркер отсутствует, без изменений следуйте исходному процессу ниже.

`
    : `${SKILL_OVERRIDE_MARKER}
## LFI tracker override

Before following the process below, read \`docs/agents/issue-tracker.md\`. If it
contains \`lfi:tracker-contract\`, these rules take precedence over every later
tracker, path, and execution-model instruction in this skill:

- Publish one \`type: task\` document per ticket in
  its specification's \`.lfi/tasks/specification-slug/tasks/\` directory,
  using the shared \`LFI-N\` sequence and \`spec: LFI-N\`. Publish a ticket
  without a specification directly in \`.lfi/tasks/\`. Assign exactly one
  \`execution_tier: light|standard|deep\` in frontmatter. Prefix each filename
  with its derived status, for example
  \`[READY] LFI-N — informative-slug.md\` or
  \`[BLOCKED] LFI-N — informative-slug.md\`.
- Assign the execution tier automatically from required judgment and cost of
  error: bounded low-risk mechanical work is \`light\`; ordinary feature,
  maintenance, and bug work is \`standard\`; ambiguous, cross-boundary,
  security-, concurrency-, or data-sensitive work is \`deep\`. File count is
  not authoritative. Resolve genuine doubt upward. The user may override the
  tier before execution.
- The skill must not ask for an execution model or assign concrete model labels.
- Do not publish LFI tracker documents under \`.scratch/\`.

If the marker is absent, follow the original process below unchanged.

## Переопределение LFI для трекера

Перед выполнением процесса ниже прочитайте \`docs/agents/issue-tracker.md\`. Если
он содержит \`lfi:tracker-contract\`, эти правила имеют приоритет над всеми
последующими инструкциями навыка о трекере, путях и модели выполнения:

- Опубликуйте по одному документу \`type: task\` на
  задачу в каталоге \`.lfi/tasks/specification-slug/tasks/\` её спецификации,
  используя общую последовательность \`LFI-N\` и \`spec: LFI-N\`. Задачу без
  спецификации публикуйте непосредственно в \`.lfi/tasks/\`. В frontmatter
  укажите ровно один \`execution_tier: light|standard|deep\`. Имя каждого файла
  начинается с вычисленного статуса, например
  \`[READY] LFI-N — informative-slug.md\` или
  \`[BLOCKED] LFI-N — informative-slug.md\`.
- Автоматически назначайте уровень выполнения по требуемому качеству суждения и
  цене ошибки: ограниченная механическая низкорисковая работа — \`light\`;
  обычная работа над функциями, сопровождением и ошибками — \`standard\`;
  неоднозначная, межсистемная, чувствительная к безопасности, конкурентности
  или данным работа — \`deep\`. Количество файлов не определяет уровень.
  При настоящем сомнении выбирайте более высокий уровень. Пользователь может
  изменить уровень до выполнения.
- Навык не должен спрашивать модель выполнения или назначать метки конкретных
  моделей.
- Не публикуйте документы трекера LFI в \`.scratch/\`.

Если маркер отсутствует, без изменений следуйте исходному процессу ниже.

`;

export const adaptLfiSkill = (name: string, source: string): string => {
  if (!isAdaptableSkill(name)) return source;
  if (source.includes(SKILL_OVERRIDE_MARKER)) return source;
  const missing = skillAnchors[name].filter((anchor) => !source.includes(anchor));
  const frontmatterEnd = source.indexOf("\n---\n", 4);
  if (!source.startsWith("---\n") || frontmatterEnd < 0 || missing.length > 0) {
    throw new Error(
      `LFI cannot adapt ${name} at the pinned skill commit; upstream instructions changed / LFI не может адаптировать ${name}: инструкции закреплённой версии изменились`,
    );
  }
  const insertion = frontmatterEnd + "\n---\n".length;
  return `${source.slice(0, insertion)}\n${skillOverride(name)}${source.slice(insertion)}`;
};

const defaultSkillRoot = join(homedir(), ".agents", "skills");
const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const directoriesDiffer = async (
  destination: string,
  source: string,
): Promise<boolean> =>
  (
    await runCommand("git", [
      "diff",
      "--no-index",
      "--quiet",
      destination,
      source,
    ])
  ).exitCode !== 0;

const fetchBundle = async (): Promise<string> => {
  const temp = await mkdtemp(join(tmpdir(), "lfi-skills-"));
  await requireCommand("git", [
    "clone",
    "--quiet",
    "--filter=blob:none",
    "--no-checkout",
    "https://github.com/mattpocock/skills.git",
    temp,
  ]);
  await requireCommand("git", ["sparse-checkout", "set", ...SKILL_PATHS], {
    cwd: temp,
  });
  await requireCommand("git", ["checkout", "--quiet", SKILLS_COMMIT], {
    cwd: temp,
  });
  return temp;
};

const adaptBundle = async (bundle: string): Promise<void> => {
  for (const name of ["to-spec", "to-tickets"] as const) {
    const path = join(bundle, "skills", "engineering", name, "SKILL.md");
    const source = await readFile(path, "utf8");
    const adapted = adaptLfiSkill(name, source);
    if (adapted !== source) await writeFile(path, adapted);
  }
};

export const listSkillStatus = async (): Promise<
  Array<{ name: string; installed: boolean; hasOpenAiMetadata: boolean }>
> =>
  Promise.all(
    SKILL_PATHS.map(async (path) => {
      const name = basename(path);
      return {
        name,
        installed: await exists(join(defaultSkillRoot, name, "SKILL.md")),
        hasOpenAiMetadata: await exists(
          join(defaultSkillRoot, name, "agents", "openai.yaml"),
        ),
      };
    }),
  );

export const installSkills = async (
  options: {
    update?: boolean;
    yes?: boolean;
    language?: Language;
    sourceRoot?: string;
    destinationRoot?: string;
  } = {},
): Promise<string[]> => {
  const language = options.language ?? "en";
  const ownsBundle = options.sourceRoot === undefined;
  const bundle = options.sourceRoot ?? (await fetchBundle());
  const destinationRoot = options.destinationRoot ?? defaultSkillRoot;
  const changed: string[] = [];
  try {
    await adaptBundle(bundle);
    await mkdir(destinationRoot, { recursive: true });
    const candidates: Array<{ name: string; source: string; destination: string }> = [];
    for (const path of SKILL_PATHS) {
      const name = basename(path);
      const source = join(bundle, path);
      const destination = join(destinationRoot, name);
      if (!(await exists(destination))) {
        candidates.push({ name, source, destination });
        continue;
      }
      if (name === "to-spec" || name === "to-tickets") {
        if (await directoriesDiffer(destination, source)) {
          candidates.push({ name, source, destination });
        }
        continue;
      }
      if (!options.update) {
        const installedMetadata = join(destination, "agents", "openai.yaml");
        const sourceMetadata = join(source, "agents", "openai.yaml");
        if (!(await exists(installedMetadata))) {
          if (!(await exists(sourceMetadata))) {
            throw new Error(
              `${name} is missing agents/openai.yaml at pinned commit / в закреплённом коммите отсутствует agents/openai.yaml`,
            );
          }
          await mkdir(join(destination, "agents"), { recursive: true });
          await cp(sourceMetadata, installedMetadata);
          changed.push(name);
        }
        continue;
      }
      if (await directoriesDiffer(destination, source)) {
        candidates.push({ name, source, destination });
      }
    }
    if (options.update) {
      console.log(
        localize(
          language,
          `Skill changes at ${SKILLS_COMMIT.slice(0, 12)}: ${candidates.map((item) => item.name).join(", ") || "none"}`,
          `Изменения навыков на ${SKILLS_COMMIT.slice(0, 12)}: ${candidates.map((item) => item.name).join(", ") || "нет"}`,
        ),
      );
    }
    if (
      options.update &&
      candidates.length > 0 &&
      !options.yes &&
      process.stdin.isTTY
    ) {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await input.question(
        localize(
          language,
          `Update the LFI skill bundle to ${SKILLS_COMMIT.slice(0, 12)}? [y/N] `,
          `Обновить набор навыков LFI до ${SKILLS_COMMIT.slice(0, 12)}? [y/N] `,
        ),
      );
      input.close();
      if (!/^y/iu.test(answer.trim())) return [];
    }
    for (const { name, source, destination } of candidates) {
      if (await exists(destination)) {
        await rm(destination, { recursive: true, force: true });
      }
      await cp(source, destination, { recursive: true });
      const metadata = join(destination, "agents", "openai.yaml");
      if (!(await exists(metadata))) {
        throw new Error(
          `${name} is missing agents/openai.yaml at pinned commit / в закреплённом коммите отсутствует agents/openai.yaml`,
        );
      }
      changed.push(name);
    }
  } finally {
    if (ownsBundle) await rm(bundle, { recursive: true, force: true });
  }
  return changed;
};

export const readInstalledSkill = async (name: string): Promise<string> =>
  readFile(join(defaultSkillRoot, name, "SKILL.md"), "utf8");
