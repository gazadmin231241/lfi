Type: task
Blocked by: LFI-3
Tier: light

> **Task complexity:** `light`

## What to build

Importing a GitHub tracker writes its documents where they belong the first
time. Each imported specification creates its feature directory, and every
imported task is written into that specification's tasks subdirectory, instead
of landing in the removed specifications directory and waiting to be relocated.

The import itself is otherwise unchanged: identifier allocation, parent and
dependency relationships, execution tiers, and the checkpoint commit all behave
as they do today.

## Acceptance criteria

- [x] Imported specifications and tasks are written directly into the
      spec-scoped layout.
- [x] Imported tasks with no parent specification land at the tasks root.
- [x] Identifier allocation, relationships, execution tiers, and the checkpoint
      commit are unaffected.
- [x] The import test suite asserts on the resulting file locations.

## Specification

[LFI-1 — Spec scoped tracker layout](<../[SPEC] LFI-1 — spec-scoped-tracker-layout.md>)

## Blocked by

- [LFI-3 — Store each specification and its tasks in one directory](<[DONE] LFI-3 — store-each-specification-and-its-tasks-in-one-directory.md>)
