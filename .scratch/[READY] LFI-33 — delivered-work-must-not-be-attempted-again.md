Type: task
Blocked by: None
Tier: standard

> **Task complexity:** `standard`

## What to build

A task whose work has already reached the default branch on the remote is done,
and no later run may hand it to an agent again.

Today integration can deliver a validated result to `origin/main` and then fail
to fast-forward the local branch, because the local branch has diverged or
carries uncommitted changes. The run reports the task incomplete, the local
tracker still names it ready — the rename to done travelled with the delivered
commits, which the local branch never received — and the next run starts a fresh
attempt at work that is already merged. Every lap of that loop spends real agent
time on nothing. This is the loop that burned through LFI-27 on 2026-08-02.

The fix is at the seam where integration decides what a fast-forward failure
means. Delivery to the remote is the moment the task is complete; whether the
local branch could follow is a separate, local problem. When the fast-forward
fails after a successful delivery, the run must still report the task delivered,
name the local divergence as the thing to reconcile, and refuse to start the
next run until the local branch has caught up with the delivered result — refuse,
not degrade, exactly as an unusable isolation prerequisite already stops a run
before any work begins. When the local branch is strictly behind the delivered
result and the working tree allows it, the run may catch up itself, because a
fast-forward that cannot lose anything is reconciliation, not judgment.

## Acceptance criteria

- [ ] A fast-forward failure after successful delivery reports the task as
      delivered, not incomplete, asserted at the integration seam.
- [ ] A run refuses to start while the local default branch lacks commits
      already delivered to the remote default branch, and the refusal names the
      command that reconciles.
- [ ] When the local default branch is strictly behind the delivered result and
      no local commits or conflicting changes stand in the way, the run
      fast-forwards it and says so in the log.
- [ ] A genuinely diverged local branch is never rebased, reset, or merged by
      LFI; the refusal is the whole behaviour.
- [ ] A task delivered to the remote is not offered as runnable by a subsequent
      run, asserted against a tracker whose local copy still names it ready.
- [ ] Existing integration tests pass unchanged for the paths where delivery
      and fast-forward both succeed or both fail.

## Blocked by

None — can start immediately.

## Specification

None.

## Blocked by

None — can start immediately.
