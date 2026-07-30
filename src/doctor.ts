import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { runCommand } from "./process.js";
import { localize, type Language } from "./i18n.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  required: boolean;
}

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const requiredSkills = [
  "implement",
  "tdd",
  "code-review",
  "resolving-merge-conflicts",
];

export const runDoctor = async (
  cwd: string,
  language: Language,
): Promise<DoctorCheck[]> => {
  const commands: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["git", ["--version"]],
    ["gh", ["auth", "status"]],
    ["codex", ["login", "status"]],
  ];
  const commandChecks = await Promise.all(
    commands.map(async ([command, args]) => {
      const result = await runCommand(command, args);
      return {
        name: command,
        ok: result.exitCode === 0,
        detail: (result.stdout || result.stderr).trim().split("\n")[0] ?? "",
        required: true,
      };
    }),
  );
  const skillChecks = await Promise.all(
    requiredSkills.map(async (skill) => {
      const directory = join(homedir(), ".agents", "skills", skill);
      const [hasSkill, hasMetadata] = await Promise.all([
        exists(join(directory, "SKILL.md")),
        exists(join(directory, "agents", "openai.yaml")),
      ]);
      return {
        name: `$${skill}`,
        ok: hasSkill && hasMetadata,
        detail: hasSkill && !hasMetadata
          ? localize(
              language,
              `${join("~/.agents/skills", skill)} is missing agents/openai.yaml`,
              `в ${join("~/.agents/skills", skill)} отсутствует agents/openai.yaml`,
            )
          : join("~/.agents/skills", skill),
        required: true,
      };
    }),
  );
  const setupConfigured = await exists(
    join(cwd, "docs", "agents", "issue-tracker.md"),
  );
  return [
    ...commandChecks,
    ...skillChecks,
    {
      name: "$setup-matt-pocock-skills",
      ok: setupConfigured,
      detail: setupConfigured
        ? localize(
            language,
            "project agent workflow detected",
            "настройка агентского процесса найдена",
          )
        : localize(
            language,
            "open Codex and run $setup-matt-pocock-skills",
            "откройте Codex и выполните $setup-matt-pocock-skills",
          ),
      required: false,
    },
  ];
};
