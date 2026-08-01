---
id: LFI-4
type: task
title: "Group status output by feature"
status: ready
execution_tier: standard
spec: LFI-1
blocked_by:
  - LFI-3
---

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

- [ ] Status output prints each feature as a group, specification first, then
      its tasks.
- [ ] Tasks with no specification appear in a single trailing group with its own
      heading.
- [ ] Status prefixes, completion ordering, filters, and blocker annotations
      behave as before.
- [ ] Group headings are available in both English and Russian.
- [ ] Tests assert on formatted output for a tracker with several features and
      at least one task without a specification.

## Specification

[LFI-1 — Spec-scoped tracker layout](<../specs/[SPEC] LFI-1 — spec-scoped-tracker-layout.md>)

## Blocked by

- [LFI-3 — Store each specification and its tasks in one directory](<completed/[DONE] LFI-3 — store-each-specification-and-its-tasks-in-one-directory.md>)
