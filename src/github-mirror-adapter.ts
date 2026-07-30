import { withGithubRetry } from "./github-resilience.js";
import { gitResult } from "./git.js";
import { ensureGithubTypeLabels } from "./github.js";
import type { GithubMirrorAdapter, MirrorIssue } from "./mirror-types.js";
import { requireCommand } from "./process.js";

const parseIssue = (source: string): MirrorIssue => {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid GitHub issue response");
  }
  const number = Reflect.get(value, "number");
  const title = Reflect.get(value, "title");
  const body = Reflect.get(value, "body");
  const state = Reflect.get(value, "state");
  const labels = Reflect.get(value, "labels");
  if (
    typeof number !== "number" ||
    typeof title !== "string" ||
    typeof body !== "string" ||
    (state !== "OPEN" && state !== "CLOSED") ||
    !Array.isArray(labels)
  ) {
    throw new Error("Invalid GitHub issue response");
  }
  return {
    number,
    title,
    body,
    state: state === "OPEN" ? "open" : "closed",
    labels: labels.flatMap((label): string[] => {
      if (typeof label === "string") return [label];
      if (typeof label !== "object" || label === null) return [];
      const name = Reflect.get(label, "name");
      return typeof name === "string" ? [name] : [];
    }),
  };
};

const command = (cwd: string, args: readonly string[]) =>
  withGithubRetry(() => requireCommand("gh", args, { cwd }));

const allowTextualRelationshipFallback = async (
  operation: () => Promise<unknown>,
): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).toLowerCase();
    if (
      /http 404|already exists|not supported|not enabled|sub-issues? (?:are|is) disabled|dependencies? (?:are|is) disabled/u.test(
        message,
      )
    ) {
      return;
    }
    throw error;
  }
};

const relationshipQuery = async (
  operation: () => Promise<string>,
): Promise<string | undefined> => {
  try {
    return await operation();
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).toLowerCase();
    if (
      /http 404|not supported|not enabled|sub-issues? (?:are|is) disabled|dependencies? (?:are|is) disabled/u.test(
        message,
      )
    ) {
      return undefined;
    }
    throw error;
  }
};

export const createGhMirrorAdapter = (
  cwd: string,
  repo: string,
): GithubMirrorAdapter => {
  const findByLfiId = async (id: string): Promise<MirrorIssue | undefined> => {
    const result = await command(cwd, [
      "issue", "list", "--repo", repo, "--state", "all",
      "--search", `"${id}" in:title`, "--limit", "20",
      "--json", "number,title,body,state,labels",
    ]);
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) return undefined;
    const match = parsed.find((item) => {
      if (typeof item !== "object" || item === null) return false;
      const title = Reflect.get(item, "title");
      return (
        typeof title === "string" &&
        /LFI-\d+/u.exec(title)?.[0] === id
      );
    });
    return match ? parseIssue(JSON.stringify(match)) : undefined;
  };
  return {
    verifyDestination: async () => {
      await command(cwd, [
        "repo",
        "view",
        repo,
        "--json",
        "nameWithOwner",
      ]);
    },
    ensureTypeLabels: async () => {
      await ensureGithubTypeLabels(cwd, repo);
    },
    findByLfiId,
    getIssue: async (number) => {
      const result = await command(cwd, [
        "issue", "view", String(number), "--repo", repo,
        "--json", "number,title,body,state,labels",
      ]);
      return parseIssue(result.stdout);
    },
    createIssue: async (desired, closingComment) => {
      const id = /LFI-\d+/u.exec(desired.title)?.[0];
      const issue = await withGithubRetry(async () => {
        try {
          const result = await requireCommand(
            "gh",
            [
              "issue", "create", "--repo", repo, "--title", desired.title,
              "--body", desired.body, "--label", desired.labels.join(","),
            ],
            { cwd },
          );
          return {
            number: Number(result.stdout.trim().split("/").at(-1)),
            ...desired,
            state: "open" as const,
          };
        } catch (error) {
          const existing = id ? await findByLfiId(id) : undefined;
          if (existing) return existing;
          throw error;
        }
      });
      if (desired.state === "closed") {
        await command(cwd, [
          "issue", "close", String(issue.number), "--repo", repo,
          ...(closingComment ? ["--comment", closingComment] : []),
        ]);
        return { ...issue, state: desired.state };
      }
      return issue;
    },
    updateIssue: async (issue, closingComment) => {
      await command(cwd, [
        "issue", "edit", String(issue.number), "--repo", repo,
        "--title", issue.title, "--body", issue.body,
      ]);
      await command(cwd, [
        "api", "--method", "PUT",
        `repos/${repo}/issues/${issue.number}/labels`,
        ...issue.labels.flatMap((label) => ["-f", `labels[]=${label}`]),
      ]);
      await command(cwd, [
        "issue", issue.state === "closed" ? "close" : "reopen",
        String(issue.number), "--repo", repo,
        ...(issue.state === "closed" && closingComment
          ? ["--comment", closingComment]
          : []),
      ]);
    },
    reconcileParent: async (child, parent) => {
      const currentSource = await relationshipQuery(async () =>
        (
          await command(cwd, [
            "api",
            `repos/${repo}/issues/${child}/parent`,
            "--jq",
            ".number",
          ])
        ).stdout,
      );
      const current = currentSource ? Number(currentSource.trim()) : undefined;
      if (current === parent) return;
      const childInfo = await command(cwd, [
        "api", `repos/${repo}/issues/${child}`, "--jq", ".id",
      ]);
      if (current !== undefined) {
        await allowTextualRelationshipFallback(() =>
          command(cwd, [
            "api",
            "--method",
            "DELETE",
            `repos/${repo}/issues/${current}/sub_issue`,
            "-F",
            `sub_issue_id=${childInfo.stdout.trim()}`,
          ]),
        );
      }
      if (parent !== undefined) {
        await allowTextualRelationshipFallback(() =>
          command(cwd, [
            "api",
            "--method",
            "POST",
            `repos/${repo}/issues/${parent}/sub_issues`,
            "-F",
            `sub_issue_id=${childInfo.stdout.trim()}`,
          ]),
        );
      }
    },
    reconcileBlockers: async (child, blockers) => {
      const currentSource = await relationshipQuery(async () =>
        (
          await command(cwd, [
            "api",
            `repos/${repo}/issues/${child}/dependencies/blocked_by`,
            "--jq",
            ".[].number",
          ])
        ).stdout,
      );
      if (currentSource === undefined) return;
      const current = new Set(
        currentSource
          .split(/\s+/u)
          .filter(Boolean)
          .map(Number),
      );
      const desired = new Set(blockers);
      for (const blocker of new Set([...current, ...desired])) {
        if (current.has(blocker) === desired.has(blocker)) continue;
        const info = await command(cwd, [
          "api", `repos/${repo}/issues/${blocker}`, "--jq", ".id",
        ]);
        const add = desired.has(blocker);
        await allowTextualRelationshipFallback(() =>
          command(cwd, [
            "api",
            "--method",
            add ? "POST" : "DELETE",
            `repos/${repo}/issues/${child}/dependencies/blocked_by${
              add ? "" : `/${info.stdout.trim()}`
            }`,
            ...(add ? ["-F", `issue_id=${info.stdout.trim()}`] : []),
          ]),
        );
      }
    },
  };
};

export const inferGithubRepo = async (
  cwd: string,
): Promise<string | undefined> => {
  const remote = await gitResult(cwd, ["remote", "get-url", "origin"]).catch(
    () => undefined,
  );
  const match = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/u.exec(
    remote?.stdout.trim() ?? "",
  );
  return match?.[1];
};
