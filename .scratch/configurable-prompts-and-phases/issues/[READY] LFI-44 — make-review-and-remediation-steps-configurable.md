Type: task
Blocked by: None
Tier: standard

> **Task complexity:** `standard`

## What to build

A maintainer of a cheap or low-risk project turns the review phase off in the
configuration file and attempts go straight from execute to validation:
review, remediation, and re-review are skipped entirely, and nothing in the
attempt summary or logs suggests a review was expected. A separate setting
bounds remediation: the remediation-round count defaults to one (today's
behaviour) and accepts zero, where a blocking review ends the attempt not
accepted immediately, with no remediation or re-review session. Re-review
remains one targeted pass per remediation round. Invalid values — a
non-boolean switch, a negative or non-integer round count — fail
configuration validation with a clear message before any run starts.
Validation keeps its existing semantics (an empty validation command disables
the phase); merge and delivery remain non-configurable.

## Acceptance criteria

- [ ] With the review switch off, an end-to-end attempt with a fake agent
      runs execute and validation only; no review, remediation, or re-review
      session starts.
- [ ] With remediation rounds set to zero, a blocking review ends the attempt
      not accepted with the worktree preserved and no remediation session.
- [ ] Defaults preserve today's behaviour: review on, one remediation round.
- [ ] Invalid values for either setting fail configuration validation with a
      message naming the setting.
- [ ] The generated configuration file documents both settings in reading
      order alongside the existing execution settings.

## Specification

[LFI-40 — Configurable prompts and phases](<../[SPEC] LFI-40 — configurable-prompts-and-phases.md>)

## Blocked by

None — can start immediately.
