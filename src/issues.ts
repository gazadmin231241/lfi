import {
  LFI_SPEC_LABEL,
  LFI_TASK_LABEL,
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

export const parseBlockedBy = (body: string): number[] => {
  const heading = /^##\s+Blocked by\s*$/imu.exec(body);
  if (!heading) return [];
  const remainder = body.slice(heading.index + heading[0].length);
  const nextHeading = /^##\s+/imu.exec(remainder);
  const section =
    nextHeading === null ? remainder : remainder.slice(0, nextHeading.index);
  if (/^\s*None\b/imu.test(section)) return [];
  return [...section.matchAll(/#(\d+)/gu)]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isSafeInteger(number));
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
    const blockers = [
      ...parseBlockedBy(issue.body),
      ...(options.nativeBlockers?.get(issue.number) ?? []),
    ];
    return blockers.every((blocker) => !openIssueNumbers.has(blocker));
  });
};
