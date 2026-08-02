import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { configuredAgents, DEFAULT_CONFIG, type LfiConfig } from "./config.js";
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

const commandDetail = (
  language: Language,
  command: string,
  ok: boolean,
): string => ok
  ? localize(language, `${command} is available`, `${command} доступен`)
  : command === "bwrap"
    ? localize(
        language,
        "bwrap is missing; install bubblewrap or set ISOLATION_PROVIDER=none",
        "bwrap отсутствует; установите bubblewrap или задайте ISOLATION_PROVIDER=none",
      )
  : localize(
      language,
      `${command} is unavailable or its check failed`,
      `${command} недоступен или его проверка завершилась ошибкой`,
    );

const checkCommand = async (
  command: string,
  args: readonly string[],
  language: Language,
  required: boolean,
  environment: NodeJS.ProcessEnv,
  name = command,
): Promise<DoctorCheck> => {
  const result = await runCommand(command, args, { env: environment }).catch(() => ({ exitCode: 1 }));
  return {
    name,
    ok: result.exitCode === 0,
    detail: commandDetail(language, name, result.exitCode === 0),
    required,
  };
};

export const runDoctor = async (
  cwd: string,
  language: Language,
  config: LfiConfig = DEFAULT_CONFIG,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DoctorCheck[]> => {
  const agents = configuredAgents(config);
  const commands: Array<readonly [string, readonly string[], string?]> = [
    ["git", ["--version"]],
    ["gh", ["auth", "status"]],
    ...(agents.has("codex")
      ? [["codex", ["login", "status"], "codex"] as const]
      : []),
    ...(agents.has("pi") ? [["which", ["pi"], "pi"] as const] : []),
    ...(config.ISOLATION_PROVIDER === "local"
      ? [["bwrap", ["--version"]] as const]
      : []),
  ];
  const commandChecks = await Promise.all(
    commands.map(async ([command, args, name]) => {
      return checkCommand(command, args, language, true, environment, name);
    }),
  );
  const skillChecks = agents.has("codex")
    ? await Promise.all(
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
      )
    : [];
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
