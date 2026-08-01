Type: task
Blocked by: LFI-3
Tier: standard

> **Task complexity:** `standard`

## What to build

The status listing tells the same story as the file tree. Documents are printed
one feature at a time: the specification first, then the tasks that implement
it. Tasks with no specification form a final group of their own, so they are
neither lost among features nor mixed into one.

Everything else about the listing is unchanged: derived status prefixes, the
ordering of recent completions, the filters, the blocker annotations, and both
languages.

## Acceptance criteria

- [x] Status output prints each feature as a group, specification first, then
      its tasks.
- [x] Tasks with no specification appear in a single trailing group with its own
      heading.
- [x] Status prefixes, completion ordering, filters, and blocker annotations
      behave as before.
- [x] Group headings are available in both English and Russian.
- [x] Tests assert on formatted output for a tracker with several features and
      at least one task without a specification.

## Specification

[LFI-1 — Spec scoped tracker layout](<../[SPEC] LFI-1 — spec-scoped-tracker-layout.md>)

## Blocked by

- [LFI-3 — Store each specification and its tasks in one directory](<[DONE] LFI-3 — store-each-specification-and-its-tasks-in-one-directory.md>)
