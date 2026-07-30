import type { GithubIssue } from "./issues.js";

export const defaultTaskPrompt = (language: "en" | "ru"): string =>
  language === "ru"
    ? `Приступай к реализации: {{ISSUE_URL}}\n\nИспользуй $implement.\n\nВсе необходимые локальные изменения в рамках задачи заранее разрешены. Работай только в текущем worktree. Production deploy и SSH запрещены.\n`
    : `Start implementing: {{ISSUE_URL}}\n\nUse $implement.\n\nAll local changes required by the issue are pre-approved. Work only in the current worktree. Production deploy and SSH are forbidden.\n`;

export const renderWorkerPrompt = (
  template: string,
  issue: GithubIssue,
): string => {
  const identifier = issue.id ?? `#${issue.number}`;
  return `${template
  .replaceAll("{{ISSUE_URL}}", issue.url)
  .replaceAll("{{ISSUE_NUMBER}}", String(issue.number))
  .replaceAll("{{ISSUE_TITLE}}", issue.title)
  .replaceAll("{{TASK_ID}}", identifier)}

# Issue

${issue.body}

# LFI constraints

- Work only on ${identifier}.
- Read the applicable AGENTS.md files and use installed user skills.
- Schema changes, non-destructive migrations, dependencies, lockfile edits, root configuration, and file moves required by this issue are pre-approved.
- Never deploy, use production SSH, modify production data, delete database volumes, expose secrets, or force-push.
- Run focused checks regularly and the repository's full validation before finishing.
- Use $implement. It includes TDD where appropriate and $code-review.
- Do not run git add or git commit. The Codex sandbox intentionally protects Git metadata; after a successful response, the LFI host stages and commits the worktree.
- Your final response must conform to the output schema. Use status "completed" only when the entire issue is implemented, reviewed, and tested. Otherwise use "incomplete" and explain the remaining work.
`;
};

export const mergerPrompt = (
  context: string,
): string => `Resolve the current integration problem in this worktree.

Use $resolving-merge-conflicts when a merge is in progress.
Read the relevant issue bodies and commit history, preserve both intents, and run the configured validation.
Do not run git add or git commit; the LFI host commits a successful resolution because the Codex sandbox protects Git metadata.
Never abort the merge, deploy, use SSH, force-push, or touch production.

Context:
${context}
`;
