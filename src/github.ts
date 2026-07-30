import { requireCommand } from "./process.js";
import type { GithubIssue } from "./issues.js";
import { localize, type Language } from "./i18n.js";

interface GhIssue {
  number: number;
  title: string;
  url: string;
  body: string;
  labels: Array<{ name: string }>;
}

export const repoInfo = async (
  cwd: string,
): Promise<{ nameWithOwner: string; defaultBranch: string }> => {
  const result = await requireCommand(
    "gh",
    ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
    { cwd },
  );
  const parsed = JSON.parse(result.stdout) as {
    nameWithOwner: string;
    defaultBranchRef: { name: string };
  };
  return {
    nameWithOwner: parsed.nameWithOwner,
    defaultBranch: parsed.defaultBranchRef.name,
  };
};

export const listOpenIssues = async (
  cwd: string,
  label: string,
): Promise<GithubIssue[]> => {
  const result = await requireCommand(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      label,
      "--limit",
      "100",
      "--json",
      "number,title,url,body,labels",
    ],
    { cwd },
  );
  return (JSON.parse(result.stdout) as GhIssue[]).map((issue) => ({
    ...issue,
    labels: issue.labels.map((labelEntry) => labelEntry.name),
  }));
};

export const listAllOpenIssueNumbers = async (
  cwd: string,
): Promise<Set<number>> => {
  const result = await requireCommand(
    "gh",
    ["issue", "list", "--state", "open", "--limit", "1000", "--json", "number"],
    { cwd },
  );
  return new Set(
    (JSON.parse(result.stdout) as Array<{ number: number }>).map(
      (issue) => issue.number,
    ),
  );
};

export const nativeBlockers = async (
  cwd: string,
  repo: string,
  issueNumbers: readonly number[],
): Promise<Map<number, number[]>> => {
  const result = new Map<number, number[]>();
  await Promise.all(
    issueNumbers.map(async (number) => {
      const response = await requireCommand(
        "gh",
        [
          "api",
          `repos/${repo}/issues/${number}/dependencies/blocked_by`,
          "--jq",
          ".[].number",
        ],
        { cwd },
      );
      result.set(
        number,
        response.stdout
          .split(/\s+/u)
          .filter(Boolean)
          .map(Number),
      );
    }),
  );
  return result;
};

export const closeIssue = async (
  cwd: string,
  number: number,
  sha: string,
  language: "en" | "ru",
): Promise<void> => {
  const comment =
    language === "ru"
      ? `Выполнено LFI и опубликовано в ${sha}.`
      : `Completed by LFI and published in ${sha}.`;
  await requireCommand(
    "gh",
    ["issue", "close", String(number), "--comment", comment],
    { cwd },
  );
};

export const commentFinalFailure = async (
  cwd: string,
  number: number,
  language: Language,
): Promise<void> => {
  await requireCommand(
    "gh",
    [
      "issue",
      "comment",
      String(number),
      "--body",
      localize(
        language,
        "LFI could not complete this issue within the configured number of stages. The worktree and local logs were preserved for inspection.",
        "LFI не смог завершить эту задачу за настроенное количество этапов. Worktree и локальные логи сохранены для проверки.",
      ),
    ],
    { cwd },
  );
};
