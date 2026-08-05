# LFI v1 specification

LFI (“Let’s Fucking Implement”) is a bilingual TypeScript CLI for unattended
implementation of local Markdown tasks with pluggable coding agents.

## User workflow

1. Install/link `lfi`, select English or Russian once, and run `lfi init` in a
   Git repository. Tasks live only in the local Markdown tracker.
2. Local tracker documents are versioned under `.scratch/`: each
   specification has a directory containing its specification document and
   `issues/` subdirectory, while tasks without a specification are at the root.
   Completed tasks stay in place; there is no archive directory. All documents
   share one stable `LFI-N` namespace. Transient state remains ignored. Status
   exists only in the filename; `Type:`, `Blocked by:`, and `Tier:` are plain
   marker lines in the Markdown body.
3. `lfi run --dry-run` reports eligible and blocked work without mutations.
4. `lfi run` performs at most ten stages, with at most three workers in
   parallel. Each task runs in `.lfi/worktrees/lfi-N`.
5. Only documents declaring `Type: task` are executable. Specifications and
   wayfinding documents are not. Unfinished local dependencies declared by the
   task document block execution.
6. Each execution tier selects an agent-model pair. Workers invoke that agent
   with the configured reasoning, the editable `task-prompt.md`, and the
   agent-specific expansion of the implementation-skill placeholder. Local changes are
   pre-approved; deploy, SSH, production changes, force-push, destructive
   database resets, and secrets remain forbidden.
7. Each worker performs one complete `$code-review`, consisting of parallel
   Standards and Spec axes. It batches remediation and, for substantive
   review-driven changes, requests targeted confirmation only from axes that
   produced the relevant findings. A second complete review is forbidden, but
   a known blocker may not be ignored: unresolved blockers produce
   `incomplete`. Workers use focused tests and typechecking; LFI owns the
   repository-wide validation on the final review-adjusted code.
8. A worker result is accepted only when the selected agent exits successfully,
   emits the required tagged completion block with `completed` status, and
   creates commits ahead of the base. Uncommitted changes never reject an
   attempt: only committed work reaches integration, and a worktree left dirty
   is preserved with its path and cleanup command instead of being removed.
   Agents, setup, and validation commands run inside LFI's isolation boundary;
   an agent's own sandbox remains enabled inside it.
9. Successful branches merge into a temporary integration worktree. Conflicts
   invoke the merger model with `$resolving-merge-conflicts`. After a combined
   validation failure, LFI retries before invoking a model and then runs the
   same command in a separately prepared base worktree. A green base routes the
   first repair through the integrated-diff allowlist; a later repair is wide.
   A red base is diagnostic context for wide repair and never permission to
   deliver red code. Every repair is followed by the full command. Reviewed
   task checkpoints resume validation without re-running worker or review.
10. The validated integration branch is pushed to the configured default
    branch on GitHub.
11. Successful worktrees/branches are removed unless they hold uncommitted
    changes; unfinished ones persist and are updated from the latest base
    before another attempt. `lfi run` does not touch the host working tree's
    branch: it neither fetches nor merges `origin` there, so a dirty or stale
    checkout never blocks a run, and keeping the base branch current is the
    operator's call. A reused task worktree is refreshed from
    `origin/<base branch>` with `merge --ff-only`, and only when it is clean,
    on its branch, and strictly behind: an unreachable `origin`, a diverged
    branch, or uncommitted work skips the refresh with a log line instead of
    failing the run.

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
- GitHub auth is provided by `gh auth login`. Each configured agent manages its
  own authentication; code-host credentials stay outside the isolation boundary.
- The CLI runs in one foreground terminal and does not open terminal windows.
