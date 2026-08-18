import {
  access,
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";

import { resolveAgentProfile } from "./agent-provider.js";
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

const defaultSkillRoot = join(homedir(), ".agents", "skills");
const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const requireSkillMetadata = async (name: string, skillRoot: string): Promise<string> => {
  const metadata = join(skillRoot, "agents", "openai.yaml");
  if (!(await exists(metadata))) {
    throw new Error(
      `${name} is missing agents/openai.yaml at pinned commit / в закреплённом коммите отсутствует agents/openai.yaml`,
    );
  }
  return metadata;
};

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

export const installedSkillNames = async (
  skillRoot = defaultSkillRoot,
): Promise<Set<string>> => {
  const entries = await readdir(skillRoot, { withFileTypes: true }).catch(() => []);
  const installed = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) =>
        (await exists(join(skillRoot, entry.name, "SKILL.md")))
          ? entry.name
          : undefined),
  );
  return new Set(installed.filter((name): name is string => name !== undefined));
};

const defaultClaudeSkillRoot = (): string =>
  join(resolveAgentProfile("claude", homedir()).stateDirectory, "skills");

// Claude Code reads skills from its own state directory rather than the shared
// ~/.agents/skills tree, so the installed skills are linked into it. Anything
// already sitting at the link path belongs to the user and is left alone.
export const linkSkillsForClaude = async (
  names: readonly string[],
  installedRoot: string,
  claudeSkillRoot: string,
  language: Language,
): Promise<string[]> => {
  const linked: string[] = [];
  await mkdir(claudeSkillRoot, { recursive: true });
  for (const name of names) {
    const link = join(claudeSkillRoot, name);
    const target = join(installedRoot, name);
    const entry = await lstat(link).then((stats) => stats, () => undefined);
    if (entry) {
      const current = entry.isSymbolicLink()
        ? await readlink(link).catch(() => undefined)
        : undefined;
      if (current === target) continue;
      console.log(
        localize(
          language,
          `Left ${link} untouched: it is not the LFI skill link.`,
          `Оставлен без изменений ${link}: это не ссылка на навык LFI.`,
        ),
      );
      continue;
    }
    await symlink(target, link);
    linked.push(name);
  }
  return linked;
};

export const installSkills = async (
  options: {
    update?: boolean;
    yes?: boolean;
    language?: Language;
    sourceRoot?: string;
    destinationRoot?: string;
    claudeSkillRoot?: string;
  } = {},
): Promise<string[]> => {
  const language = options.language ?? "en";
  const ownsBundle = options.sourceRoot === undefined;
  const bundle = options.sourceRoot ?? (await fetchBundle());
  const destinationRoot = options.destinationRoot ?? defaultSkillRoot;
  const changed: string[] = [];
  try {
    await mkdir(destinationRoot, { recursive: true });
    const candidates: Array<{ name: string; source: string; destination: string }> = [];
    for (const path of SKILL_PATHS) {
      const name = basename(path);
      const source = join(bundle, path);
      const destination = join(destinationRoot, name);
      const sourceMetadata = await requireSkillMetadata(name, source);
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
        if (!(await exists(installedMetadata))) {
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
      await requireSkillMetadata(name, destination);
      changed.push(name);
    }
  } finally {
    if (ownsBundle) await rm(bundle, { recursive: true, force: true });
  }
  await linkSkillsForClaude(
    SKILL_PATHS.map((path) => basename(path)),
    destinationRoot,
    options.claudeSkillRoot ?? defaultClaudeSkillRoot(),
    language,
  );
  return changed;
};

export const readInstalledSkill = async (name: string): Promise<string> =>
  readFile(join(defaultSkillRoot, name, "SKILL.md"), "utf8");
