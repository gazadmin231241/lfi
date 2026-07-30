import { join } from "node:path";

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
import { checkpointTracker, mapConcurrent } from "./runner-support.js";

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

const statusMarker = (
  document: TrackerDocument,
  tracker: LocalTracker,
): string => {
  if (document.status === "completed") return "✅";
  if (document.status === "cancelled") return "";
  if (
    document.type === "task" &&
    document.blockedBy.some(
      (id) =>
        tracker.tasks.find((task) => task.id === id)?.status !== "completed",
    )
  ) {
    return "⛔";
  }
  return document.type === "task" ? "🟢" : "📘";
};

const desiredIssue = (
  document: TrackerDocument,
  tracker: LocalTracker,
): Omit<MirrorIssue, "number"> => {
  const blocked =
    document.blockedBy.length === 0
      ? "None — can start immediately."
      : document.blockedBy.map((id) => `- ${id}`).join("\n");
  const parent = document.spec ? `\n## Parent\n\n${document.spec}\n` : "";
  const marker = statusMarker(document, tracker);
  return {
    title: `${marker ? `${marker} ` : ""}${document.id} — ${document.title}`,
    body: `${document.body.trimEnd()}${parent}\n## Blocked by\n\n${blocked}\n\n---\nManaged by LFI from ${document.id}.\n`,
    state: desiredState(document, tracker),
  };
};

export const syncGithubMirror = async (
  cwd: string,
  options: {
    adapter?: GithubMirrorAdapter;
    repo?: string;
    dryRun?: boolean;
    force?: boolean;
  } = {},
): Promise<SyncResult> => {
  const config = await loadConfig(join(cwd, ".lfi", "config.env"));
  if (config.TASK_SOURCE !== "local") {
    throw new Error(
      "Sync is only available when task storage is Local Markdown. / Синхронизация доступна только для Local Markdown.",
    );
  }
  const repo =
    options.repo ?? (config.GITHUB_REPO || (await inferGithubRepo(cwd)));
  if (!repo && !options.adapter) {
    throw new Error("GitHub repository is required. Use --repo owner/name.");
  }
  const adapter =
    options.adapter ?? createGhMirrorAdapter(cwd, repo!);
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
      const desired = desiredIssue(document, tracker);
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
      if (!issue) {
        if (options.dryRun) {
          result.created.push(document.id);
          continue;
        }
        issue = await adapter.createIssue(
          desired.title,
          desired.body,
          desired.state,
          document.status === "cancelled"
            ? "Cancelled in the local LFI tracker."
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
        issue.state !== desired.state
      ) {
        if (!options.dryRun) {
          await adapter.updateIssue(
            { ...desired, number: issue.number },
            document.status === "cancelled"
              ? "Cancelled in the local LFI tracker."
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
        if (parent) await adapter.setParent(issue, parent);
        const blockers = task.blockedBy.flatMap((id) => {
          const number = mappings.get(id);
          return number === undefined ? [] : [number];
        });
        if (blockers.length > 0) await adapter.setBlockers(issue, blockers);
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
