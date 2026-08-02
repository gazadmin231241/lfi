import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";

export type Language = "en" | "ru";

export const localize = (
  language: Language,
  english: string,
  russian: string,
): string => (language === "ru" ? russian : english);

const globalConfigPath = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "lfi",
  "config.json",
);

export const detectLanguage = (): Language =>
  /^(ru|uk|be)/iu.test(process.env.LANG ?? "") ? "ru" : "en";

export const loadLanguage = async (): Promise<Language | undefined> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(globalConfigPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const language = Reflect.get(parsed, "language");
    return language === "en" || language === "ru" ? language : undefined;
  } catch {
    return undefined;
  }
};

export const saveLanguage = async (language: Language): Promise<void> => {
  await mkdir(dirname(globalConfigPath), { recursive: true });
  await writeFile(globalConfigPath, `${JSON.stringify({ language }, null, 2)}\n`);
};

export const resolveLanguage = async (
  requested?: string,
  interactive = process.stdin.isTTY === true,
  askAgain = false,
): Promise<Language> => {
  if (requested === "en" || requested === "ru") {
    await saveLanguage(requested);
    return requested;
  }
  const stored = await loadLanguage();
  if (stored && !askAgain) return stored;
  if (!interactive) return detectLanguage();
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await input.question(
    "Choose language / Выберите язык\n1. English\n2. Русский\n> ",
  );
  input.close();
  const language: Language = answer.trim() === "1"
    ? "en"
    : answer.trim() === "2"
      ? "ru"
      : stored ?? detectLanguage();
  await saveLanguage(language);
  return language;
};

const messages = {
  en: {
    initialized: "LFI initialized.",
    updated: "LFI project is up to date.",
    alreadyInitialized: "LFI is already initialized in this project.",
    noConfig: "No .lfi/config.env found. Run `lfi init` first.",
    noIssues: "No runnable issues found.",
    stage: "Stage",
    completed: "Completed",
    failed: "Failed",
  },
  ru: {
    initialized: "LFI инициализирован.",
    updated: "Проект LFI приведён к актуальному состоянию.",
    alreadyInitialized: "LFI уже инициализирован в этом проекте.",
    noConfig: "Файл .lfi/config.env не найден. Сначала выполните `lfi init`.",
    noIssues: "Нет доступных для выполнения задач.",
    stage: "Этап",
    completed: "Завершено",
    failed: "Ошибка",
  },
} as const;

export const t = (language: Language, key: keyof (typeof messages)["en"]): string =>
  messages[language][key];
