import { join } from "node:path";

import { loadConfig, updateConfig } from "./config.js";
import {
  listOpenIssues,
  nativeBlockers,
  repoInfo,
} from "./github.js";
import type { GithubIssue } from "./issues.js";
import {
  loadLocalTracker,
  nextRepositoryLfiId,
  saveTrackerDocument,
  type TrackerDocument,
} from "./local-tracker.js";
import { checkpointTracker } from "./runner-support.js";
import { configureLocalTracker } from "./local-setup.js";
import type { Language } from "./i18n.js";

export interface MigrationSource {
  listOpenAgentIssues(): Promise<GithubIssue[]>;
  blockers(issueNumbers: readonly number[]): Promise<Map<number, number[]>>;
}

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80) || "task";

const withoutBlockedBy = (body: string): string =>
  body
    .replace(/^##\s+Blocked by\s*$[\s\S]*?(?=^##\s+|\s*$)/imu, "")
    .trimStart();

const defaultSource = async (
  cwd: string,
  label: string,
): Promise<MigrationSource> => {
  const repository = await repoInfo(cwd);
  return {
    listOpenAgentIssues: () => listOpenIssues(cwd, label),
    blockers: (numbers) =>
      nativeBlockers(cwd, repository.nameWithOwner, numbers),
  };
};

export const migrateToLocal = async (
  cwd: string,
  options: { source?: MigrationSource; language?: Language } = {},
): Promise<string[]> => {
  const lfiRoot = join(cwd, ".lfi");
  const configPath = join(lfiRoot, "config.env");
  const config = await loadConfig(configPath);
  if (config.TASK_SOURCE !== "github") {
    throw new Error(
      "Migration requires GitHub task storage. / Для миграции нужен режим GitHub.",
    );
  }
  const source =
    options.source ?? (await defaultSource(cwd, config.ISSUE_LABEL));
  const issues = await source.listOpenAgentIssues();
  const blockers = await source.blockers(issues.map((issue) => issue.number));
  await configureLocalTracker(cwd, options.language ?? "en");
  const tracker = await loadLocalTracker(lfiRoot);
  const issueIds = new Map<number, string>();
  let next = Number(
    (await nextRepositoryLfiId(cwd, tracker.documents)).slice(4),
  );
  for (const issue of issues.sort((a, b) => a.number - b.number)) {
    issueIds.set(issue.number, `LFI-${next++}`);
  }
  const created: TrackerDocument[] = [];
  for (const issue of issues.sort((a, b) => a.number - b.number)) {
    const id = issueIds.get(issue.number)!;
    const document: TrackerDocument = {
      id,
      number: Number(id.slice(4)),
      type: "task",
      title: issue.title,
      status: "ready",
      blockedBy: (blockers.get(issue.number) ?? []).flatMap((number) => {
        const blocker = issueIds.get(number);
        return blocker === undefined ? [] : [blocker];
      }),
      githubIssue: issue.number,
      body: withoutBlockedBy(issue.body),
      path: join(lfiRoot, "tasks", `${id}-${slug(issue.title)}.md`),
    };
    await saveTrackerDocument(document);
    created.push(document);
  }
  await checkpointTracker(cwd, "docs(lfi): import GitHub tasks");
  await updateConfig(configPath, { ...config, TASK_SOURCE: "local" });
  return created.map((document) => document.id);
};
