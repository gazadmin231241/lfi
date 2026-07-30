# LFI v1 specification

LFI (“Let’s Fucking Implement”) is a bilingual TypeScript CLI for unattended
implementation of local Markdown tasks or `lfi:task` GitHub Issues with Codex.

## User workflow

1. Install/link `lfi`, select English or Russian once, and run `lfi init` in a
   Git repository. Choose Local Markdown or GitHub Issues; new projects default
   to local.
2. Local tasks and specs are versioned flat Markdown collections under `.lfi`,
   with one shared stable `LFI-N` namespace. Transient state remains ignored.
   Completed tasks record an ISO-8601 `completed_at` timestamp for recent
   completion ordering.
3. `lfi run --dry-run` reports eligible and blocked work without mutations.
4. `lfi run` performs at most ten stages, with at most three workers in
   parallel. Each issue runs in `.lfi/worktrees/issue-N`.
5. Eligible GitHub issues are open and labelled `lfi:task`.
   Specifications use `lfi:spec` and are never executable. Open dependencies
   declared in `## Blocked by` or GitHub dependencies block execution.
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
9. In local mode the validated integration branch merges to the host checkout
   without network access. In GitHub mode the base is pushed and Issues close
   only after validation.
10. Successful worktrees/branches are removed; unfinished ones persist and are
    updated from the latest base before another attempt.

## Operations

- `doctor`, `status`, and `logs` make prerequisites and progress inspectable.
- Detailed failed-agent JSONL is compressed; successful runs keep compact logs.
- Run logs expire by age (three days by default); active logs are preserved.
- The pinned `lfi skills` bundle installs eight Matt Pocock skills, including
  their `agents/openai.yaml`. LFI conditionally adapts `to-spec` and
  `to-tickets` for projects carrying the generated LFI tracker contract.
- GitHub auth is provided by `gh auth login`; Codex auth by `codex login`.
- `lfi sync` explicitly and resumably mirrors local specs, tasks, parents,
  blockers, and completion state to GitHub.
- `lfi migrate local` imports open `lfi:spec` and `lfi:task` Issues with native
  parent and blocker relationships into an existing project.
- The CLI runs in one foreground terminal and does not open terminal windows.
