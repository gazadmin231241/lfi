import { access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { runCommand } from "./process.js";
import { localize, type Language } from "./i18n.js";
import { loadConfig } from "./config.js";
import { inferGithubRepo } from "./github-mirror-adapter.js";
import { loadReconciledLocalTracker } from "./tracker-files.js";

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
  options: { sync?: boolean } = {},
): Promise<DoctorCheck[]> => {
  const config = await loadConfig(join(cwd, ".lfi", "config.env")).catch(
    () => undefined,
  );
  const commands: Array<readonly [string, readonly string[]]> = [
    ["git", ["--version"]],
    ["codex", ["login", "status"]],
  ];
  if (options.sync || config?.TASK_SOURCE === "github") {
    commands.splice(1, 0, ["gh", ["auth", "status"]]);
  }
  const commandChecks = await Promise.all(
    commands.map(async ([command, args]) => {
      const result = await runCommand(command, args).catch((error) => ({
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }));
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
  const syncChecks: DoctorCheck[] = [];
  if (options.sync) {
    const tracker = await loadReconciledLocalTracker(join(cwd, ".lfi"))
      .then(() => ({
        name: "local tracker",
        ok: true,
        detail: localize(
          language,
          "documents are valid",
          "документы корректны",
        ),
        required: true,
      }))
      .catch((error) => ({
        name: "local tracker",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        required: true,
      }));
    syncChecks.push(tracker);
    const repo =
      config?.GITHUB_REPO || (await inferGithubRepo(cwd).catch(() => undefined));
    if (!repo) {
      syncChecks.push({
        name: "GitHub destination",
        ok: false,
        detail: localize(
          language,
          "not configured; pass --repo to lfi sync",
          "не настроен; передайте --repo команде lfi sync",
        ),
        required: true,
      });
    } else {
      const accessResult = await runCommand(
        "gh",
        ["repo", "view", repo, "--json", "nameWithOwner"],
        { cwd },
      ).catch((error) => ({
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }));
      syncChecks.push({
        name: "GitHub destination",
        ok: accessResult.exitCode === 0,
        detail:
          (accessResult.stdout || accessResult.stderr).trim().split("\n")[0] ??
          repo,
        required: true,
      });
    }
    syncChecks.push({
      name: "GitHub mirror",
      ok: config?.TASK_SOURCE === "local",
      detail:
        config?.TASK_SOURCE === "local"
          ? localize(language, "ready to synchronize", "готово к синхронизации")
          : localize(
              language,
              "sync requires Local Markdown mode",
              "для sync нужен режим Local Markdown",
            ),
      required: true,
    });
  }
  return [
    ...commandChecks,
    ...syncChecks,
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
