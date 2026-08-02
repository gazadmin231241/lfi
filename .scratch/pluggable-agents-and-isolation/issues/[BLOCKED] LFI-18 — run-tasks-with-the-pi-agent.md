Type: task
Blocked by: LFI-15, LFI-16, LFI-17
Tier: standard

> **Task complexity:** `standard`

## What to build

The point of the whole effort: a user writes a Pi agent and model on a tier, and
tasks at that tier actually run on Pi.

A second agent provider is added. It knows how to invoke Pi non-interactively
with a JSON event stream and the prompt on standard input, how to read that
stream into the readable task-log details and terminal lines LFI already
produces, how to expand a skill placeholder into Pi's own invocation syntax,
which reasoning vocabulary Pi accepts, and how to recognise an unavailable
model in Pi's output.

One difference deserves care. Pi reports authentication failures, rate limits
and API errors as events on standard output rather than on the error stream. If
those are not recognised, an attempt that failed for an obvious reason arrives
with an empty summary and the user cannot tell why. The provider must surface
them in the task summary.

Nothing outside the provider learns that Pi exists. The tiers, the merger role,
acceptance, logging, staging and integration treat a Pi attempt exactly as they
treat a Codex one.

Skills need no work: the installed bundle already lives where Pi discovers it,
and the Codex-specific metadata beside each skill is simply ignored by Pi.

## Acceptance criteria

- [ ] A tier configured with a Pi agent runs its tasks on Pi end to end, through
      to an accepted attempt.
- [ ] The invocation is built as a pure function and tested without spawning a
      process, including that the model value is passed through untouched.
- [ ] Pi's event stream produces the same kinds of task-log detail and terminal
      output LFI produces for Codex.
- [ ] Authentication, rate-limit and API errors reported by Pi on standard
      output appear in the task summary.
- [ ] The skill placeholder expands into Pi's invocation syntax, and the
      mandatory implementation and review skills load.
- [ ] Pi's reasoning vocabulary is enforced by configuration validation.
- [ ] An unavailable model under Pi is recognised and skips other tasks mapped
      to that same agent-and-model pair only.
- [ ] A mixed configuration — some tiers on Codex, some on Pi, merger on either
      — completes a run with staging, integration and delivery unchanged.
- [ ] Skill installation is untouched.

## Specification

[LFI-13 — Pluggable agents and isolation](<../[SPEC] LFI-13 — pluggable-agents-and-isolation.md>)

## Blocked by

- [LFI-15 — Adopt the completion block as the result contract](<[DONE] LFI-15 — adopt-the-completion-block-as-the-result-contract.md>)
- [LFI-16 — Reference skills through an agent independent placeholder](<[READY] LFI-16 — reference-skills-through-an-agent-independent-placeholder.md>)
- [LFI-17 — Pair each execution tier with an agent](<[DONE] LFI-17 — pair-each-execution-tier-with-an-agent.md>)
