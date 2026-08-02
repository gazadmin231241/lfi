Type: task
Blocked by: LFI-41
Tier: standard

> **Task complexity:** `standard`

## What to build

A maintainer initializing a project starts from working, readable prompts
instead of a blank page. Initialization writes all five default phase
templates into the prompts directory in the configured language, so the user
immediately sees what each phase says and can edit any of it. An existing
template file is never overwritten — re-running initialization preserves
every customization. The written defaults contain only the editable phase
substance, matching the split where protocol blocks stay runner-owned.

## Acceptance criteria

- [x] Initialization creates the prompts directory with all five phase
      templates in the configured language.
- [x] Re-running initialization never overwrites an existing template file.
- [x] A freshly initialized project produces the same phase prompts as a
      project with no prompts directory at all.
- [x] The written templates contain no protocol blocks.

## Specification

[LFI-40 — Configurable prompts and phases](<../[SPEC] LFI-40 — configurable-prompts-and-phases.md>)

## Blocked by

- [LFI-41 — Serve every phase prompt from an editable template](<[DONE] LFI-41 — serve-every-phase-prompt-from-an-editable-template.md>)
