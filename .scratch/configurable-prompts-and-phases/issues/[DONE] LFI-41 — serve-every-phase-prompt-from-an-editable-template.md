Type: task
Blocked by: None
Tier: deep

> **Task complexity:** `deep`

## What to build

A maintainer opens the runner's prompts directory and finds one Markdown
template per phase — task, review, remediation, re-review, and merge — and
whatever they write there is what the phase's agent receives. Resolution
precedence per phase: the phase file in the prompts directory, then (for the
task phase only) the legacy task prompt file at its current location, then
the built-in default. Deleting a template returns the phase to stock
behaviour; existing projects keep working without touching anything.

Templates carry only the editable substance of a phase. The protocol the
orchestrator parses or relies on — the completion block contract for every
phase, the findings-file contract for review and re-review, and the
staging/commit prohibition where LFI records the worktree — is appended by
the runner outside the template, so no edit can silently break result
parsing. The task phase's safety constraint list likewise stays
runner-owned. Placeholders are phase-scoped: the task phase keeps its
existing ones; review and re-review receive the base ref and the
findings-file path; re-review and remediation receive the findings verbatim;
merge receives the integration context and, when scoped, the allowed paths.
The agent-independent skill placeholder expands in every template. The run
log names the template source (custom file or built-in default) for each
phase that runs.

## Acceptance criteria

- [x] A custom template for each of the five phases replaces the built-in
      wording of that phase's prompt.
- [x] An end-to-end attempt with a fake agent shows a customized review
      template reaching the review agent's prompt.
- [x] With no prompts directory, every phase behaves exactly as today,
      including the legacy task prompt file being honoured.
- [x] Protocol blocks appear in every phase prompt even when the custom
      template omits them, and the built-in defaults no longer duplicate
      them inside the editable portion.
- [x] Phase-scoped placeholders substitute correctly, and the skill
      placeholder expands per agent provider in every template.
- [x] The run log states, per phase, whether a custom or built-in template
      was used.

## Specification

[LFI-40 — Configurable prompts and phases](<../[SPEC] LFI-40 — configurable-prompts-and-phases.md>)

## Blocked by

None — can start immediately.
