# LFI v1 specification

LFI (“Let’s Fucking Implement”) is a bilingual TypeScript CLI for unattended
implementation of local Markdown tasks with Codex.

## User workflow

1. Install/link `lfi`, select English or Russian once, and run `lfi init` in a
   Git repository. Tasks live only in the local Markdown tracker.
2. Local tracker documents are versioned under `.lfi/tasks/`: each
   specification has a directory containing its specification document and
   `tasks/` subdirectory, while tasks without a specification are at the root.
   Completed tasks stay in place; there is no archive directory. All documents
   share one stable `LFI-N` namespace. Transient state remains ignored.
   Completed tasks record an ISO-8601 `completed_at` timestamp for recent
   completion ordering.
3. `lfi run --dry-run` reports eligible and blocked work without mutations.
4. `lfi run` performs at most ten stages, with at most three workers in
   parallel. Each task runs in `.lfi/worktrees/lfi-N`.
5. Specifications are never executable. Unfinished local dependencies declared
   by the task document block execution.
6. Workers invoke Codex with the configured model/reasoning, the editable
   `task-prompt.md`, and `$implement`. Local implementation changes are
   pre-approved; deploy, SSH, production changes, force-push, destructive
   database resets, and secrets remain forbidden.
7. Each worker performs one complete `$code-review`, consisting of parallel
   Standards and Spec axes. It batches remediation and, for substantive
   review-driven changes, requests targeted confirmation only from axes that
   produced the relevant findings. A second complete review is forbidden, but
   a known blocker may not be ignored: unresolved blockers produce
   `incomplete`. The planned repository-wide validation runs once on the final
   review-adjusted code.
8. A worker result is accepted only when Codex exits successfully and emits the
   required structured `completed` status. The Codex `workspace-write` sandbox
   keeps Git metadata read-only, so the LFI host stages and commits successful
   worker changes. Acceptance then requires commits ahead of the base and a
   clean worktree.
9. Successful branches merge into a temporary integration worktree. Conflicts
   invoke the merger model with `$resolving-merge-conflicts`. After a combined
   validation failure, LFI first runs the same command in a separately prepared
   base worktree. Base failures skip model repair. Otherwise the merger receives
   redacted command output and may modify only paths in the integrated diff.
   One failed integration repair stops the run and preserves the worktree
   instead of re-running accepted implementation work.
10. The validated integration branch is pushed to the configured default
    branch on GitHub.
11. Successful worktrees/branches are removed; unfinished ones persist and are
    updated from the latest base before another attempt.

## Operations

- `doctor`, `status`, and `logs` make prerequisites and progress inspectable.
- `.lfi/logs/run.log` mirrors LFI's terminal output in real time. Flat,
  task-oriented logs stream readable worker details for both successful and
  failed attempts, with timestamped iteration sections.
- Log sections and legacy run directories expire by age (three days by
  default); active logs are preserved.
- The pinned `lfi skills` bundle installs eight Matt Pocock skills verbatim,
  including their `agents/openai.yaml`; LFI does not modify upstream skill
  instructions.
- GitHub auth is provided by `gh auth login`; Codex auth by `codex login`.
- The CLI runs in one foreground terminal and does not open terminal windows.
