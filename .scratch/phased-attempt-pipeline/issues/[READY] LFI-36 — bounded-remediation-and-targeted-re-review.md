Type: task
Blocked by: LFI-35
Tier: standard

> **Task complexity:** `standard`

## What to build

A blocking finding should usually end in fixed code, not an abandoned attempt
— but never in an argument that runs all night. When the review phase reports
blocking findings, LFI runs exactly one remediation session in the same
worktree, whose prompt carries the findings verbatim, and then exactly one
targeted re-review session limited to the original findings and regression
risk in the remediated area. The re-review writes a fresh findings file
through the same channel, and LFI gates on it the same way.

The bound is the point. One remediation, one re-review, no third round:
blockers still present after the re-review make the attempt not accepted with
the worktree preserved, exactly as an unremediated blocker does today.
Advisory findings never trigger remediation, in either round. Remediation runs
on the worker model configuration; the remediation session commits nothing
itself — LFI commits the remediated worktree before the re-review, so the
re-reviewer sees committed work.

## Acceptance criteria

- [ ] Blocking findings trigger exactly one remediation session whose prompt
      contains the findings verbatim.
- [ ] The remediated worktree is committed by LFI before the re-review.
- [ ] Exactly one targeted re-review follows remediation and reports through
      the findings-file channel.
- [ ] A clean re-review yields an accepted attempt.
- [ ] Blockers surviving the re-review end the attempt not accepted with the
      worktree preserved; no third review round ever runs.
- [ ] Advisory findings trigger no remediation in either round.
- [ ] Remediation and re-review log under their own log names, and the attempt
      summary names the phase that failed.

## Specification

[LFI-34 — Phased attempt pipeline](<../[SPEC] LFI-34 — phased-attempt-pipeline.md>)

## Blocked by

- [LFI-35 — Run a review phase after execute](<[DONE] LFI-35 — run-a-review-phase-after-execute.md>)
