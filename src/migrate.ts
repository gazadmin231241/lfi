import { join } from "node:path";

import { loadConfig, updateConfig } from "./config.js";
import {
  listOpenIssues,
  nativeBlockers,
  nativeParents,
  repoInfo,
} from "./github.js";
import {
  type GithubIssue,
  withoutManagedGithubSections,
  withoutManagedGithubTitle,
} from "./issues.js";
import {
  loadLocalTracker,
  nextRepositoryLfiId,
  saveTrackerDocument,
  type TrackerDocument,
} from "./local-tracker.js";
import { checkpointTracker } from "./runner-support.js";
import { configureLocalTracker } from "./local-setup.js";
import type { Language } from "./i18n.js";
import { executionTierFromLabels } from "./execution-tier.js";
import {
  LFI_SPEC_LABEL,
  LFI_TASK_LABEL,
} from "./tracker-contract.js";
import {
  reconcileTrackerFilenames,
  trackerTitleSlug,
} from "./tracker-files.js";

export interface MigrationSource {
  listOpenLfiIssues(): Promise<GithubIssue[]>;
  parents(issueNumbers: readonly number[]): Promise<Map<number, number>>;
  blockers(issueNumbers: readonly number[]): Promise<Map<number, number[]>>;
}

const defaultSource = async (
  cwd: string,
): Promise<MigrationSource> => {
  const repository = await repoInfo(cwd);
  return {
    listOpenLfiIssues: async () => {
      const [specs, tasks] = await Promise.all([
        listOpenIssues(cwd, LFI_SPEC_LABEL),
        listOpenIssues(cwd, LFI_TASK_LABEL),
      ]);
      return [...specs, ...tasks];
    },
    parents: (numbers) =>
      nativeParents(cwd, repository.nameWithOwner, numbers),
    blockers: (numbers) =>
      nativeBlockers(cwd, repository.nameWithOwner, numbers),
  };
};

const withoutImportedBlockerBullets = (
  body: string,
  blockerNumbers: readonly number[],
): string => {
  const blockers = new Set(blockerNumbers);
  const cleaned = body
    .split(/\r?\n/u)
    .filter((line) => {
      const match = /^\s*-\s+#(\d+)\s*$/u.exec(line);
      return match === null || !blockers.has(Number(match[1]));
    })
    .join("\n")
    .trimEnd();
  return cleaned ? `${cleaned}\n` : "";
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
    options.source ?? (await defaultSource(cwd));
  const issues = (await source.listOpenLfiIssues()).filter((issue) => {
    const labels = new Set(issue.labels);
    return labels.has(LFI_SPEC_LABEL) !== labels.has(LFI_TASK_LABEL);
  });
  const issueNumbers = issues.map((issue) => issue.number);
  const [parents, blockers] = await Promise.all([
    source.parents(issueNumbers),
    source.blockers(issueNumbers),
  ]);
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
    const title = withoutManagedGithubTitle(issue.title);
    const type = issue.labels.includes(LFI_SPEC_LABEL) ? "spec" : "task";
    const tierSelection = executionTierFromLabels(issue.labels);
    if (type === "task" && tierSelection.status === "conflict") {
      throw new Error(
        `${issue.number}: conflicting execution tier labels: ${tierSelection.labels.join(", ")} / конфликтующие метки уровня выполнения`,
      );
    }
    const parentNumber = parents.get(issue.number);
    const spec =
      parentNumber === undefined ? undefined : issueIds.get(parentNumber);
    if (parentNumber !== undefined) {
      const parent = issues.find((candidate) => candidate.number === parentNumber);
      if (
        type !== "task" ||
        !spec ||
        !parent?.labels.includes(LFI_SPEC_LABEL)
      ) {
        throw new Error(
          `${issue.number}: native parent must be an imported lfi:spec Issue / нативный родитель должен быть импортированной Issue с lfi:spec`,
        );
      }
    }
    const blockerNumbers = blockers.get(issue.number) ?? [];
    const document: TrackerDocument = {
      id,
      number: Number(id.slice(4)),
      type,
      title,
      status: "ready",
      ...(type === "task" && tierSelection.status === "resolved"
        ? { executionTier: tierSelection.tier }
        : {}),
      ...(spec ? { spec } : {}),
      blockedBy:
        type === "task"
          ? blockerNumbers.flatMap((number) => {
              const blocker = issueIds.get(number);
              return blocker === undefined ? [] : [blocker];
            })
          : [],
      githubIssue: issue.number,
      body: withoutImportedBlockerBullets(
        withoutManagedGithubSections(issue.body),
        blockerNumbers,
      ),
      path: join(
        lfiRoot,
        type === "spec" ? "specs" : "tasks",
        `${id}-${trackerTitleSlug(title)}.md`,
      ),
    };
    await saveTrackerDocument(document);
    created.push(document);
  }
  const imported = await loadLocalTracker(lfiRoot);
  await reconcileTrackerFilenames(imported, new Set());
  await checkpointTracker(cwd, "docs(lfi): import GitHub tracker");
  await updateConfig(configPath, { ...config, TASK_SOURCE: "local" });
  return created.map((document) => document.id);
};
