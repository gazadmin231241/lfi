import { join } from "node:path";

import { mapConcurrent } from "./concurrency.js";
import { loadConfig, updateConfig } from "./config.js";
import {
  createGhMirrorAdapter,
  inferGithubRepo,
} from "./github-mirror-adapter.js";
import {
  loadLocalTracker,
  saveTrackerDocument,
  type LocalTracker,
  type TrackerDocument,
} from "./local-tracker.js";
import type { GithubMirrorAdapter, MirrorIssue } from "./mirror-types.js";
import { withoutLocalRelationships } from "./local-relationships.js";
import { checkpointTracker } from "./runner-support.js";
import { localize, type Language } from "./i18n.js";
import {
  LFI_SPEC_LABEL,
  LFI_TASK_LABEL,
} from "./tracker-contract.js";

export type { GithubMirrorAdapter, MirrorIssue } from "./mirror-types.js";

export interface SyncResult {
  created: string[];
  updated: string[];
  skipped: string[];
  failed: Array<{ id: string; reason: string }>;
}

const desiredState = (
  document: TrackerDocument,
  tracker: LocalTracker,
): "open" | "closed" => {
  if (document.status !== "ready") return "closed";
  if (document.type === "spec") {
    const children = tracker.tasks.filter((task) => task.spec === document.id);
    if (
      children.length > 0 &&
      children.every((task) => task.status !== "ready")
    ) {
      return "closed";
    }
  }
  return "open";
};

const desiredIssue = (
  document: TrackerDocument,
  tracker: LocalTracker,
  language: Language,
): Omit<MirrorIssue, "number"> => {
  const blocked =
    document.blockedBy.length === 0
      ? localize(
          language,
          "None — can start immediately.",
          "Нет — можно начинать сразу.",
        )
      : document.blockedBy.map((id) => `- ${id}`).join("\n");
  const parent = document.spec
    ? `\n## ${localize(language, "Parent", "Родитель")}\n\n${document.spec}\n`
    : "";
  return {
    title: `${document.id} — ${document.title}`,
    body: `${withoutLocalRelationships(document.body)}${parent}\n## ${localize(
      language,
      "Blocked by",
      "Заблокировано задачами",
    )}\n\n${blocked}\n\n---\n${localize(
      language,
      `Managed by LFI from ${document.id}.`,
      `Управляется LFI из ${document.id}.`,
    )}\n`,
    state: desiredState(document, tracker),
    labels: [document.type === "spec" ? LFI_SPEC_LABEL : LFI_TASK_LABEL],
  };
};

const typeLabels = new Set([LFI_SPEC_LABEL, LFI_TASK_LABEL]);

const desiredLabels = (
  existing: readonly string[],
  type: TrackerDocument["type"],
): string[] =>
  [
    ...existing.filter((label) => !typeLabels.has(label)),
    type === "spec" ? LFI_SPEC_LABEL : LFI_TASK_LABEL,
  ].sort((left, right) => left.localeCompare(right));

const sameLabels = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

export const syncGithubMirror = async (
  cwd: string,
  options: {
    adapter?: GithubMirrorAdapter;
    repo?: string;
    dryRun?: boolean;
    force?: boolean;
    language?: Language;
  } = {},
): Promise<SyncResult> => {
  const language = options.language ?? "en";
  const config = await loadConfig(join(cwd, ".lfi", "config.env"));
  if (config.TASK_SOURCE !== "local") {
    throw new Error(
      "Sync is only available when task storage is Local Markdown. / Синхронизация доступна только для Local Markdown.",
    );
  }
  const repo =
    options.repo ?? (config.GITHUB_REPO || (await inferGithubRepo(cwd)));
  if (!repo && !options.adapter) {
    throw new Error(
      localize(
        language,
        "GitHub repository is required. Use --repo owner/name.",
        "Требуется GitHub-репозиторий. Используйте --repo owner/name.",
      ),
    );
  }
  const adapter =
    options.adapter ?? createGhMirrorAdapter(cwd, repo!);
  await adapter.verifyDestination?.();
  if (!options.dryRun) await adapter.ensureTypeLabels?.();
  let tracker = await loadLocalTracker(join(cwd, ".lfi"));
  if (!options.dryRun) {
    await checkpointTracker(cwd, "docs(lfi): update local task tracker");
    tracker = await loadLocalTracker(join(cwd, ".lfi"));
  }
  const result: SyncResult = {
    created: [],
    updated: [],
    skipped: [],
    failed: [],
  };
  const mappings = new Map(
    tracker.documents
      .filter((document) => document.githubIssue !== undefined)
      .map((document) => [document.id, document.githubIssue!]),
  );
  for (const document of [
    ...tracker.specs.sort((a, b) => a.number - b.number),
    ...tracker.tasks.sort((a, b) => a.number - b.number),
  ]) {
    try {
      const baseDesired = desiredIssue(document, tracker, language);
      const cancellation = localize(
        language,
        "Cancelled in the local LFI tracker.",
        "Отменено в локальном трекере LFI.",
      );
      let issue =
        document.githubIssue === undefined
          ? await adapter.findByLfiId(document.id)
          : await adapter.getIssue(document.githubIssue);
      if (
        issue &&
        document.githubIssue === undefined &&
        !options.dryRun
      ) {
        document.githubIssue = issue.number;
        mappings.set(document.id, issue.number);
        await saveTrackerDocument(document);
      }
      const desired = {
        ...baseDesired,
        labels: desiredLabels(issue?.labels ?? [], document.type),
      };
      if (!issue) {
        if (options.dryRun) {
          result.created.push(document.id);
          continue;
        }
        issue = await adapter.createIssue(
          desired,
          document.status === "cancelled"
            ? cancellation
            : undefined,
        );
        document.githubIssue = issue.number;
        mappings.set(document.id, issue.number);
        await saveTrackerDocument(document);
        result.created.push(document.id);
      } else if (
        options.force ||
        issue.title !== desired.title ||
        issue.body !== desired.body ||
        issue.state !== desired.state ||
        !sameLabels(issue.labels, desired.labels)
      ) {
        if (!options.dryRun) {
          await adapter.updateIssue(
            { ...desired, number: issue.number },
            document.status === "cancelled"
              ? cancellation
              : undefined,
          );
        }
        result.updated.push(document.id);
      } else {
        result.skipped.push(document.id);
      }
    } catch (error) {
      result.failed.push({
        id: document.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (!options.dryRun) {
    await mapConcurrent(tracker.tasks, 3, async (task) => {
      try {
        const issue = mappings.get(task.id);
        if (!issue) return;
        const parent = task.spec ? mappings.get(task.spec) : undefined;
        await adapter.reconcileParent(issue, parent);
        const blockers = task.blockedBy.flatMap((id) => {
          const number = mappings.get(id);
          return number === undefined ? [] : [number];
        });
        await adapter.reconcileBlockers(issue, blockers);
      } catch (error) {
        result.failed.push({
          id: task.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    });
    await checkpointTracker(cwd, "chore(lfi): record GitHub task mappings");
    if (!options.adapter && repo && repo !== config.GITHUB_REPO) {
      await updateConfig(join(cwd, ".lfi", "config.env"), {
        ...config,
        GITHUB_REPO: repo,
      });
    }
  }
  return result;
};
