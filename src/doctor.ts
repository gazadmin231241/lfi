import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { runCommand } from "./process.js";

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

export const runDoctor = async (cwd: string): Promise<DoctorCheck[]> => {
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
    requiredSkills.map(async (skill) => ({
      name: `$${skill}`,
      ok: await exists(join(homedir(), ".agents", "skills", skill, "SKILL.md")),
      detail: join("~/.agents/skills", skill),
      required: true,
    })),
  );
  const setupConfigured =
    (await exists(join(cwd, "docs", "agents", "issue-tracker.md"))) ||
    (await exists(join(cwd, "CONTEXT.md")));
  return [
    ...commandChecks,
    ...skillChecks,
    {
      name: "$setup-matt-pocock-skills",
      ok: setupConfigured,
      detail: setupConfigured
        ? "project agent workflow detected"
        : "open Codex and run $setup-matt-pocock-skills",
      required: false,
    },
  ];
};
