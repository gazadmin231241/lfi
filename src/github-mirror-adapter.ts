import { withGithubRetry } from "./github-resilience.js";
import { gitResult } from "./git.js";
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
  if (
    typeof number !== "number" ||
    typeof title !== "string" ||
    typeof body !== "string" ||
    (state !== "OPEN" && state !== "CLOSED")
  ) {
    throw new Error("Invalid GitHub issue response");
  }
  return {
    number,
    title,
    body,
    state: state === "OPEN" ? "open" : "closed",
  };
};

const command = (cwd: string, args: readonly string[]) =>
  withGithubRetry(() => requireCommand("gh", args, { cwd }));

export const createGhMirrorAdapter = (
  cwd: string,
  repo: string,
): GithubMirrorAdapter => {
  const findByLfiId = async (id: string): Promise<MirrorIssue | undefined> => {
    const result = await command(cwd, [
      "issue", "list", "--repo", repo, "--state", "all",
      "--search", `"${id}" in:title`, "--limit", "20",
      "--json", "number,title,body,state",
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
    findByLfiId,
    getIssue: async (number) => {
      const result = await command(cwd, [
        "issue", "view", String(number), "--repo", repo,
        "--json", "number,title,body,state",
      ]);
      return parseIssue(result.stdout);
    },
    createIssue: async (title, body, state, closingComment) => {
      const id = /LFI-\d+/u.exec(title)?.[0];
      const issue = await withGithubRetry(async () => {
        try {
          const result = await requireCommand(
            "gh",
            ["issue", "create", "--repo", repo, "--title", title, "--body", body],
            { cwd },
          );
          return {
            number: Number(result.stdout.trim().split("/").at(-1)),
            title,
            body,
            state: "open" as const,
          };
        } catch (error) {
          const existing = id ? await findByLfiId(id) : undefined;
          if (existing) return existing;
          throw error;
        }
      });
      if (state === "closed") {
        await command(cwd, [
          "issue", "close", String(issue.number), "--repo", repo,
          ...(closingComment ? ["--comment", closingComment] : []),
        ]);
        return { ...issue, state };
      }
      return issue;
    },
    updateIssue: async (issue, closingComment) => {
      await command(cwd, [
        "issue", "edit", String(issue.number), "--repo", repo,
        "--title", issue.title, "--body", issue.body,
      ]);
      await command(cwd, [
        "issue", issue.state === "closed" ? "close" : "reopen",
        String(issue.number), "--repo", repo,
        ...(issue.state === "closed" && closingComment
          ? ["--comment", closingComment]
          : []),
      ]);
    },
    setParent: async (child, parent) => {
      const info = await command(cwd, [
        "api", `repos/${repo}/issues/${child}`, "--jq", ".id",
      ]);
      await command(cwd, [
        "api", "--method", "POST", `repos/${repo}/issues/${parent}/sub_issues`,
        "-F", `sub_issue_id=${info.stdout.trim()}`,
      ]).catch(() => undefined);
    },
    setBlockers: async (child, blockers) => {
      for (const blocker of blockers) {
        const info = await command(cwd, [
          "api", `repos/${repo}/issues/${blocker}`, "--jq", ".id",
        ]);
        await command(cwd, [
          "api", "--method", "POST",
          `repos/${repo}/issues/${child}/dependencies/blocked_by`,
          "-F", `issue_id=${info.stdout.trim()}`,
        ]).catch(() => undefined);
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
