Type: task
Blocked by: LFI-41
Tier: standard

> **Task complexity:** `standard`

## What to build

A typo in a template costs seconds, not minutes of agent time. Before any
agent starts, the runner validates every template it resolved: a placeholder
the phase does not define is a configuration error naming the template and
the offending placeholder; an empty or whitespace-only template file is an
error rather than a silent fallback to the default; and the existing guard
against direct references to installed skills applies to every phase's
template, not only the task template. The run refuses with a clear message
and no worktree, agent session, or tracker state is touched.

## Acceptance criteria

- [ ] An unknown placeholder in any phase template fails the run before any
      agent starts, naming the template and placeholder.
- [ ] An empty or whitespace-only template file is reported as an error, not
      silently replaced by the built-in default.
- [ ] A direct installed-skill reference in any phase template is rejected
      with the same guidance the task template gives today.
- [ ] A valid configuration passes validation with no behaviour change.

## Specification

[LFI-40 — Configurable prompts and phases](<../[SPEC] LFI-40 — configurable-prompts-and-phases.md>)

## Blocked by

- [LFI-41 — Serve every phase prompt from an editable template](<[DONE] LFI-41 — serve-every-phase-prompt-from-an-editable-template.md>)
