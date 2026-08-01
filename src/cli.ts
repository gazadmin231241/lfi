#!/usr/bin/env node
import { access, readFile, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";

import { isReasoningEffort, loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { initializeProject } from "./init.js";
import { localize, resolveLanguage, saveLanguage, t, type Language } from "./i18n.js";
import { pruneExpiredRunLogs } from "./logs.js";
import { formatLogRuns, formatTaskLogSection, listLogRuns, readLatestTaskLog } from "./log-view.js";
import { dryRun, runLfi } from "./runner.js";
import { installSkills, listSkillStatus, SKILLS_COMMIT } from "./skills.js";
import { requestShutdown } from "./process.js";
import { localStatusLines, type StatusFilter } from "./status.js";

const args = process.argv.slice(2);
const cwd = process.cwd();
const VERSION = "0.1.0";
const valueOptions = new Set([
  "--lang",
  "--model",
  "--reasoning",
  "--log-retention-days",
]);
const positional: string[] = [];
for (let index = 0; index < args.length; index++) {
  const argument = args[index]!;
  if (valueOptions.has(argument)) {
    index++;
    continue;
  }
  if (!argument.startsWith("-")) positional.push(argument);
}

process.once("SIGINT", () => {
  console.error(
    "\nStopping LFI; worktrees and state will be preserved. / LFI останавливается; worktree и состояние будут сохранены...",
  );
  requestShutdown();
});
process.once("SIGTERM", requestShutdown);

const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string): boolean => args.includes(name);

const printHelp = (language: Language) => {
  console.log(
    language === "ru"
      ? `LFI — Let's Fucking Implement

Использование:
  lfi init [--advanced] [--yes] [--model MODEL] [--reasoning EFFORT]
  lfi doctor
  lfi run [LFI-ID...] [--dry-run]
  lfi status [--all|--ready|--blocked|--completed]
  lfi logs [LFI-ID]
  lfi logs prune [--all]
  lfi skills install|list|doctor|update
  lfi config language [ru|en]`
      : `LFI — Let's Fucking Implement

Usage:
  lfi init [--advanced] [--yes] [--model MODEL] [--reasoning EFFORT]
  lfi doctor
  lfi run [LFI-ID...] [--dry-run]
  lfi status [--all|--ready|--blocked|--completed]
  lfi logs [LFI-ID]
  lfi logs prune [--all]
  lfi skills install|list|doctor|update
  lfi config language [ru|en]`,
  );
};

const requireConfig = async (language: Language) => {
  const path = join(cwd, ".lfi", "config.env");
  await access(path).catch(() => {
    throw new Error(t(language, "noConfig"));
  });
  return loadConfig(path);
};

const printDoctor = async (
  language: Language,
): Promise<number> => {
  const checks = await runDoctor(cwd, language);
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : check.required ? "✗" : "!"} ${check.name}: ${check.detail}`);
  }
  return checks.some((check) => check.required && !check.ok) ? 1 : 0;
};

const showLogs = async (
  task: string | undefined,
  language: Language,
): Promise<void> => {
  const lfiRoot = join(cwd, ".lfi");
  const logsRoot = join(cwd, ".lfi", "logs");
  if (!task) {
    const runs = await listLogRuns(lfiRoot);
    console.log(
      runs.length > 0
        ? formatLogRuns(runs, language)
        : localize(language, "No log history.", "История запусков пуста."),
    );
    return;
  }
  const latest = await readLatestTaskLog(logsRoot, task);
  if (!latest) {
    console.log(localize(language, "No task log found.", "Лог задачи не найден."));
    return;
  }
  console.log(formatTaskLogSection(latest.content, language));
  const path = relative(cwd, latest.path);
  console.log(
    localize(
      language,
      `Full history: less ${path}`,
      `Полная история: less ${path}`,
    ),
  );
};

const pruneLogs = async (all: boolean, language: Language): Promise<void> => {
  const config = await requireConfig(language);
  const logsRoot = join(cwd, ".lfi", "logs");
  if (all) {
    const activeRun = await readFile(
      join(cwd, ".lfi", "state", "run.lock"),
      "utf8",
    )
      .then((source) => (JSON.parse(source) as { runId?: string }).runId)
      .catch(() => undefined);
    if (activeRun) {
      throw new Error(
        localize(
          language,
          "Cannot remove all logs while an LFI run is active.",
          "Нельзя удалить все логи, пока выполняется LFI.",
        ),
      );
    }
    for (const entry of await readdir(logsRoot, { withFileTypes: true })) {
      await rm(join(logsRoot, entry.name), { recursive: true, force: true });
    }
    return;
  }
  const removed = await pruneExpiredRunLogs(logsRoot, {
    retentionDays: config.LOG_RETENTION_DAYS,
  });
  console.log(
    localize(
      language,
      `Removed ${removed.length} expired run log(s).`,
      `Удалено устаревших каталогов с логами: ${removed.length}.`,
    ),
  );
};

const main = async (): Promise<number> => {
  if (has("--version") || has("-V")) {
    console.log(VERSION);
    return 0;
  }
  if (positional[0] === "config" && positional[1] === "language") {
    const requested = positional[2];
    if (requested === "en" || requested === "ru") {
      await saveLanguage(requested);
      console.log(`Language: ${requested}`);
      return 0;
    }
  }
  const language = await resolveLanguage(option("--lang"));
  const command = positional[0];
  if (!command || command === "--help" || command === "-h") {
    printHelp(language);
    return 0;
  }
  if (command === "init") {
    const retention = option("--log-retention-days");
    const reasoning = option("--reasoning");
    if (reasoning && !isReasoningEffort(reasoning)) {
      throw new Error(
        localize(
          language,
          `Unsupported reasoning effort: ${reasoning}`,
          `Неподдерживаемый уровень рассуждений: ${reasoning}`,
        ),
      );
    }
    const supportedReasoning =
      reasoning && isReasoningEffort(reasoning) ? reasoning : undefined;
    const result = await initializeProject({
      cwd,
      language,
      ...(option("--model") ? { model: option("--model")! } : {}),
      ...(supportedReasoning ? { reasoning: supportedReasoning } : {}),
      ...(retention ? { retentionDays: Number(retention) } : {}),
      yes: has("--yes"),
      advanced: has("--advanced"),
    });
    console.log(t(language, result === "created" ? "initialized" : "alreadyInitialized"));
    console.log(
      localize(
        language,
        "Next: codex login, lfi skills install, lfi doctor, lfi run --dry-run",
        "Далее: codex login, lfi skills install, lfi doctor, lfi run --dry-run",
      ),
    );
    return 0;
  }
  if (command === "doctor") return printDoctor(language);
  if (command === "skills") {
    const subcommand = positional[1] ?? "list";
    if (subcommand === "install" || subcommand === "update") {
      const changed = await installSkills({
        update: subcommand === "update",
        yes: has("--yes"),
        language,
      });
      console.log(
        localize(
          language,
          `${subcommand === "update" ? "Updated" : "Installed"}: ${changed.join(", ") || "nothing"}`,
          `${subcommand === "update" ? "Обновлено" : "Установлено"}: ${changed.join(", ") || "ничего"}`,
        ),
      );
      console.log(
        localize(
          language,
          `Pinned mattpocock/skills commit: ${SKILLS_COMMIT}`,
          `Зафиксированный коммит mattpocock/skills: ${SKILLS_COMMIT}`,
        ),
      );
      return 0;
    }
    const statuses = await listSkillStatus();
    for (const status of statuses) {
      console.log(
        `${status.installed && status.hasOpenAiMetadata ? "✓" : "✗"} ${status.name}${status.installed && !status.hasOpenAiMetadata ? localize(language, " (missing agents/openai.yaml)", " (нет agents/openai.yaml)") : ""}`,
      );
    }
    return subcommand === "doctor" &&
      statuses.some((status) => !status.installed || !status.hasOpenAiMetadata)
      ? 1
      : 0;
  }
  if (command === "run") {
    await requireConfig(language);
    const selected = positional.slice(1);
    if (has("--dry-run")) {
      const plan = await dryRun(cwd, selected);
      console.log(
        `${localize(language, "Runnable", "Доступны")}: ${plan.runnable.map((task) => `${task.id} ${task.title}`).join("\n") || localize(language, "none", "нет")}`,
      );
      console.log(
        `${localize(language, "Blocked/excluded", "Заблокированы/исключены")}: ${plan.blocked
          .map(
            (task) =>
              `${task.id} ${task.title}${
                task.blockedBy?.length
                  ? ` · ${localize(language, "blocked by", "заблокирована задачами")} ${task.blockedBy.join(", ")}`
                  : ""
              }`,
          )
          .join("\n") || localize(language, "none", "нет")}`,
      );
      return 0;
    }
    return runLfi(cwd, language, selected);
  }
  if (command === "status") {
    await requireConfig(language);
    const filter: StatusFilter | undefined = has("--ready")
      ? "ready"
      : has("--blocked")
        ? "blocked"
        : has("--completed")
          ? "completed"
          : undefined;
    console.log(
      (
        await localStatusLines(cwd, {
          ...(has("--all") ? { all: true } : {}),
          ...(filter ? { filter } : {}),
          language,
        })
      ).join("\n") || localize(language, "No local tasks.", "Локальных задач нет."),
    );
    return 0;
  }
  if (command === "logs") {
    if (positional[1] === "prune") await pruneLogs(has("--all"), language);
    else await showLogs(positional[1], language);
    return 0;
  }
  throw new Error(
    localize(
      language,
      `Unknown command: ${command}`,
      `Неизвестная команда: ${command}`,
    ),
  );
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
