Type: task
Blocked by: LFI-43, LFI-44
Tier: light

> **Task complexity:** `light`

## What to build

A maintainer configures the pipeline without reading runner source. The
agents documentation describes the prompts directory: one template per
phase, the resolution precedence including the legacy task prompt file, the
placeholders each phase defines, the protocol blocks the runner appends
outside the template, and the fail-fast validation rules. It also documents
the step settings — the review-phase switch and the remediation-round bound —
next to the existing configuration documentation, including their defaults
and interaction with the validation command switch.

## Acceptance criteria

- [ ] The documentation lists all five phase templates with their
      phase-scoped placeholders.
- [ ] The resolution precedence and the never-overwrite behaviour of
      initialization are documented.
- [ ] The runner-owned protocol blocks are documented as non-editable.
- [ ] The review-phase switch and remediation-round settings are documented
      with defaults and validation rules.

## Specification

[LFI-40 — Configurable prompts and phases](<../[SPEC] LFI-40 — configurable-prompts-and-phases.md>)

## Blocked by

- [LFI-43 — Write default templates at init](<[BLOCKED] LFI-43 — write-default-templates-at-init.md>)
- [LFI-44 — Make review and remediation steps configurable](<[READY] LFI-44 — make-review-and-remediation-steps-configurable.md>)
