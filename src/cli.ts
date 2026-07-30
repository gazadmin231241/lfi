#!/usr/bin/env node

import {
  access,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";

import { loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { initializeProject } from "./init.js";
import { resolveLanguage, saveLanguage, t, type Language } from "./i18n.js";
import { pruneExpiredRunLogs } from "./logs.js";
import { dryRun, runLfi } from "./runner.js";
import { installSkills, listSkillStatus, SKILLS_COMMIT } from "./skills.js";
import { requestShutdown } from "./process.js";

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
  console.error("\nStopping LFI; worktrees and state will be preserved...");
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
  lfi run [--dry-run]
  lfi status
  lfi logs [ISSUE]
  lfi logs prune [--all]
  lfi skills install|list|doctor|update
  lfi config language [ru|en]`
      : `LFI — Let's Fucking Implement

Usage:
  lfi init [--advanced] [--yes] [--model MODEL] [--reasoning EFFORT]
  lfi doctor
  lfi run [--dry-run]
  lfi status
  lfi logs [ISSUE]
  lfi logs prune [--all]
  lfi skills install|list|doctor|update
  lfi config language [ru|en]`,
  );
};

const requireConfig = async () => {
  const path = join(cwd, ".lfi", "config.env");
  await access(path).catch(() => {
    throw new Error("No .lfi/config.env found. Run `lfi init` first.");
  });
  return loadConfig(path);
};

const printDoctor = async (): Promise<number> => {
  const checks = await runDoctor(cwd);
  for (const check of checks) {
    console.log(`${check.ok ? "✓" : check.required ? "✗" : "!"} ${check.name}: ${check.detail}`);
  }
  return checks.some((check) => check.required && !check.ok) ? 1 : 0;
};

const showLogs = async (issue?: string): Promise<void> => {
  const logsRoot = join(cwd, ".lfi", "logs");
  const runs = (await readdir(logsRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!issue) {
    console.log(runs.join("\n"));
    return;
  }
  for (const run of runs) {
    const directory = join(logsRoot, run);
    const files = await readdir(directory);
    for (const file of files.filter((name) => name.includes(`issue-${issue}`))) {
      console.log(`\n== ${run}/${file} ==`);
      if (file.endsWith(".log")) console.log(await readFile(join(directory, file), "utf8"));
      else console.log(join(directory, file));
    }
  }
};

const pruneLogs = async (all: boolean): Promise<void> => {
  const config = await requireConfig();
  const logsRoot = join(cwd, ".lfi", "logs");
  if (all) {
    const activeRun = await readFile(
      join(cwd, ".lfi", "state", "run.lock"),
      "utf8",
    )
      .then((source) => (JSON.parse(source) as { runId?: string }).runId)
      .catch(() => undefined);
    for (const entry of await readdir(logsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== activeRun) {
        await rm(join(logsRoot, entry.name), { recursive: true, force: true });
      }
    }
    return;
  }
  const removed = await pruneExpiredRunLogs(logsRoot, {
    retentionDays: config.LOG_RETENTION_DAYS,
  });
  console.log(`Removed ${removed.length} expired run log(s).`);
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
    const result = await initializeProject({
      cwd,
      language,
      ...(option("--model") ? { model: option("--model")! } : {}),
      ...(option("--reasoning")
        ? { reasoning: option("--reasoning") as "low" | "medium" | "high" | "xhigh" | "max" | "ultra" }
        : {}),
      ...(retention ? { retentionDays: Number(retention) } : {}),
      yes: has("--yes"),
      advanced: has("--advanced"),
    });
    console.log(t(language, result === "created" ? "initialized" : "alreadyInitialized"));
    console.log(
      language === "ru"
        ? "Далее: gh auth login, codex login, lfi skills install, $setup-matt-pocock-skills, lfi doctor, lfi run --dry-run"
        : "Next: gh auth login, codex login, lfi skills install, $setup-matt-pocock-skills, lfi doctor, lfi run --dry-run",
    );
    return 0;
  }
  if (command === "doctor") return printDoctor();
  if (command === "skills") {
    const subcommand = positional[1] ?? "list";
    if (subcommand === "install" || subcommand === "update") {
      const changed = await installSkills({
        update: subcommand === "update",
        yes: has("--yes"),
      });
      console.log(
        `${subcommand === "update" ? "Updated" : "Installed"}: ${changed.join(", ") || "nothing"}`,
      );
      console.log(`Pinned mattpocock/skills commit: ${SKILLS_COMMIT}`);
      return 0;
    }
    const statuses = await listSkillStatus();
    for (const status of statuses) {
      console.log(
        `${status.installed && status.hasOpenAiMetadata ? "✓" : "✗"} ${status.name}${status.installed && !status.hasOpenAiMetadata ? " (missing agents/openai.yaml)" : ""}`,
      );
    }
    return subcommand === "doctor" &&
      statuses.some((status) => !status.installed || !status.hasOpenAiMetadata)
      ? 1
      : 0;
  }
  if (command === "run") {
    await requireConfig();
    if (has("--dry-run")) {
      const plan = await dryRun(cwd);
      console.log(`Runnable: ${plan.runnable.map((issue) => `#${issue.number} ${issue.title}`).join("\n") || "none"}`);
      console.log(`Blocked/excluded: ${plan.blocked.map((issue) => `#${issue.number} ${issue.title}`).join("\n") || "none"}`);
      return 0;
    }
    return runLfi(cwd, language);
  }
  if (command === "status") {
    const state = await readFile(join(cwd, ".lfi", "state", "last-run.json"), "utf8").catch(
      () => "",
    );
    console.log(state || "No completed LFI runs.");
    return 0;
  }
  if (command === "logs") {
    if (positional[1] === "prune") await pruneLogs(has("--all"));
    else await showLogs(positional[1]);
    return 0;
  }
  throw new Error(`Unknown command: ${command}`);
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
