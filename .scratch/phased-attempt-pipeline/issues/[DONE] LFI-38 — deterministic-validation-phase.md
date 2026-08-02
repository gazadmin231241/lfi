Type: task
Blocked by: None
Tier: standard

> **Task complexity:** `standard`

## What to build

"Validation passed" is currently a sentence an agent writes, and LFI believes
it. This task makes it an exit code LFI observes. After the agent phases of an
attempt finish, LFI runs the configured validation command in the worktree
through the existing project-command mechanism and gates acceptance on the
observed exit code: a failing validation ends the attempt not accepted with
the worktree preserved and a summary that names validation as the failing
phase and carries the command's output.

When no validation command is configured, the phase is skipped, matching how
equivalent flows treat an absent command today. The command's output lands in
the run log the way integration validation logs today. This task is
independent of the review phase: it hardens the current single-session
attempt on its own and slots in unchanged once review phases exist.

## Acceptance criteria

- [x] An accepted attempt implies the validation command was run in the
      worktree and exited zero.
- [x] A failing validation ends the attempt not accepted, preserves the
      worktree, and the summary names validation and includes its output.
- [x] No configured validation command means the phase is skipped and
      acceptance is unchanged.
- [x] Validation command, output, and exit code appear in the run log.
- [x] Agent-reported success cannot make an attempt accepted when the
      observed validation exit code is non-zero.

## Specification

[LFI-34 — Phased attempt pipeline](<../[SPEC] LFI-34 — phased-attempt-pipeline.md>)

## Blocked by

None — can start immediately.
