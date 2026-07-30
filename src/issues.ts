import {
  LFI_SPEC_LABEL,
  LFI_TASK_LABEL,
  withoutStatusPrefix,
} from "./tracker-contract.js";

export interface GithubIssue {
  id?: string;
  number: number;
  title: string;
  url: string;
  body: string;
  labels: string[];
  blockedBy?: string[];
}

const blockedByHeading =
  /^##\s+(?:Blocked by|Заблокировано задачами)\s*$/imu;

export const parseBlockedBy = (body: string): number[] => {
  const heading = blockedByHeading.exec(body);
  if (!heading) return [];
  const remainder = body.slice(heading.index + heading[0].length);
  const nextHeading = /^##\s+/imu.exec(remainder);
  const section =
    nextHeading === null ? remainder : remainder.slice(0, nextHeading.index);
  if (/^\s*(?:None|Нет)(?=\s|$)/imu.test(section)) return [];
  return [...section.matchAll(/#(\d+)/gu)]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isSafeInteger(number));
};

const managedHeading =
  /^##\s+(?:Parent|Родитель|Blocked by|Заблокировано задачами)\s*$/iu;
const managedFooter =
  /^(?:Managed by LFI from|Управляется LFI из)\s+LFI-\d+\.\s*$/iu;

export const withoutManagedGithubSections = (body: string): string => {
  const lines = body.split(/\r?\n/u);
  const kept: string[] = [];
  let skipping = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (managedHeading.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^##\s+/u.test(line)) {
      skipping = false;
    }
    if (managedFooter.test(line)) {
      if (kept.at(-1) === "---") kept.pop();
      continue;
    }
    if (!skipping) kept.push(line);
  }
  const cleaned = kept.join("\n").trim();
  return cleaned ? `${cleaned}\n` : "";
};

export const withoutManagedGithubTitle = (title: string): string =>
  withoutStatusPrefix(title).replace(/^LFI-\d+\s+—\s+/u, "");

export const githubTaskState = (
  issue: GithubIssue,
  openIssueNumbers: ReadonlySet<number>,
  nativeBlockers: ReadonlyMap<number, readonly number[]> = new Map(),
): "ready" | "blocked" => {
  const blockers = [
    ...parseBlockedBy(issue.body),
    ...(nativeBlockers.get(issue.number) ?? []),
  ];
  return blockers.some((blocker) => openIssueNumbers.has(blocker))
    ? "blocked"
    : "ready";
};

export const selectRunnableIssues = (
  issues: GithubIssue[],
  openIssueNumbers: ReadonlySet<number>,
  options: {
    nativeBlockers?: ReadonlyMap<number, readonly number[]>;
  } = {},
): GithubIssue[] => {
  return issues.filter((issue) => {
    const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
    if (!labels.has(LFI_TASK_LABEL) || labels.has(LFI_SPEC_LABEL)) return false;
    return (
      githubTaskState(
        issue,
        openIssueNumbers,
        options.nativeBlockers,
      ) === "ready"
    );
  });
};
