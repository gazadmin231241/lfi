export interface GithubIssue {
  number: number;
  title: string;
  url: string;
  body: string;
  labels: string[];
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
    includeLabel?: string;
    excludeLabels?: readonly string[];
    nativeBlockers?: ReadonlyMap<number, readonly number[]>;
  } = {},
): GithubIssue[] => {
  const includeLabel = options.includeLabel ?? "ready-for-agent";
  const excluded = new Set(
    (options.excludeLabels ?? ["blocked", "needs-info", "ready-for-human"]).map(
      (label) => label.toLowerCase(),
    ),
  );

  return issues.filter((issue) => {
    const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
    if (!labels.has(includeLabel.toLowerCase())) return false;
    if ([...excluded].some((label) => labels.has(label))) return false;
    const blockers = [
      ...parseBlockedBy(issue.body),
      ...(options.nativeBlockers?.get(issue.number) ?? []),
    ];
    return blockers.every((blocker) => !openIssueNumbers.has(blocker));
  });
};
