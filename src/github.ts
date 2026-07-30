import { requireCommand, runCommand } from "./process.js";
import type { GithubIssue } from "./issues.js";

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
      const response = await runCommand(
        "gh",
        [
          "api",
          `repos/${repo}/issues/${number}/dependencies/blocked_by`,
          "--jq",
          ".[].number",
        ],
        { cwd },
      );
      if (response.exitCode !== 0) return;
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
  summary: string,
): Promise<void> => {
  await runCommand("gh", [
    "issue",
    "comment",
    String(number),
    "--body",
    `LFI could not complete this issue after the configured stages.\n\n${summary}`,
  ], { cwd });
};
