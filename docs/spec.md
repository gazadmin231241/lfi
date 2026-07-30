# LFI v1 specification

LFI (“Let’s Fucking Implement”) is a bilingual TypeScript CLI for unattended
implementation of ready GitHub Issues with Codex.

## User workflow

1. Install/link `lfi`, select English or Russian once, and run `lfi init` in a
   GitHub repository.
2. LFI detects the repository, default branch, validation command, package
   manager, and worktree setup command. Normal initialization only asks how
   many days logs should be retained.
3. `lfi run --dry-run` reports eligible and blocked work without mutations.
4. `lfi run` performs at most ten stages, with at most three workers in
   parallel. Each issue runs in `.lfi/worktrees/issue-N`.
5. Eligible issues are open, labelled `ready-for-agent`, and do not carry
   `blocked`, `needs-info`, or `ready-for-human`. Open dependencies declared in
   `## Blocked by` or GitHub dependencies block execution.
6. Workers invoke Codex with the configured model/reasoning, the editable
   `task-prompt.md`, and `$implement`. Local implementation changes are
   pre-approved; deploy, SSH, production changes, force-push, destructive
   database resets, and secrets remain forbidden.
7. A worker result is accepted only when Codex exits successfully, emits the
   required structured `completed` status, has commits ahead of the base, and
   leaves a clean worktree.
8. Successful branches merge into a temporary integration worktree. Conflicts
   and combined validation failures invoke the merger model with
   `$resolving-merge-conflicts`.
9. The base branch is pushed and issues are closed only after combined
   validation passes. The stage is atomic from the remote base branch's point
   of view.
10. Successful worktrees/branches are removed; unfinished ones persist and are
    updated from the latest base before another attempt.

## Operations

- `doctor`, `status`, and `logs` make prerequisites and progress inspectable.
- Detailed failed-agent JSONL is compressed; successful runs keep compact logs.
- Run logs expire by age (three days by default); active logs are preserved.
- The pinned `lfi skills` bundle installs eight Matt Pocock skills, including
  their `agents/openai.yaml`, without overwriting existing skills on install.
- GitHub auth is provided by `gh auth login`; Codex auth by `codex login`.
- The CLI runs in one foreground terminal and does not open terminal windows.
