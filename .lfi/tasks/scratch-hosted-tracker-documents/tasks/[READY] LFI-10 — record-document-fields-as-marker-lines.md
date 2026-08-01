---
id: LFI-10
type: task
title: "Record document fields as marker lines"
status: ready
execution_tier: deep
spec: LFI-7
blocked_by:
  - LFI-8
---

> **Task complexity:** `deep`

## What to build

Tracker documents stop carrying a machine-readable header and start carrying
plain marker lines a human can read and edit in place.

`Type:` declares what the document is — a specification, an executable task, or
one of the wayfinding kinds: a research question, a prototype, or a grilling.
`Blocked by:` names the identifiers that gate the document. `Tier:` carries the
execution tier of an executable task. Status is not among them: it stays in the
filename, where it already is, so there is exactly one place to look.

Only a document declaring itself a task is offered to an agent as work. A
document with no `Type:` line is reported as malformed and never executed — a
missing declaration is an error, not an invitation to guess.

Repository-wide identifiers keep being allocated as they are today, counting
past identifiers that appear only in Git history, and branch and log naming are
untouched.

Execution tier keeps routing work to the same model as before; only where the
value is read from changes. A user can still change a tier by editing one
visible line before a run.

The tracker documents already in this repository, including this feature's own
specification and tasks, are rewritten into the new shape as part of the change.
Their location does not move yet.

## Acceptance criteria

- [ ] A tracker document carries no machine-readable header; `Type:`,
      `Blocked by:`, and `Tier:` are read from marker lines in the body.
- [ ] Status is derived from the filename alone, and the status prefixes and
      renaming behaviour are unchanged.
- [ ] Only documents declaring the task kind are offered for execution;
      specifications and the wayfinding kinds are never handed to an agent.
- [ ] A document with no `Type:` line is reported as malformed, naming the file,
      and is not executed.
- [ ] A wayfinding document whose kind is changed to task becomes executable
      without any other edit.
- [ ] Blocking relationships and the derived blocked status behave as they do
      today.
- [ ] Identifier allocation still counts past identifiers found only in Git
      history.
- [ ] Execution tier routes each tier to the same model as before, read from the
      `Tier:` line.
- [ ] Branch names and log file names are unchanged.
- [ ] The tracker documents in this repository are rewritten into the new shape
      and load without error.
- [ ] Tests build a document tree on disk and assert on the loaded model:
      parsing of each marker line, status from filename, the malformed-document
      report, and which kinds are executable.
- [ ] User-facing output remains available in English and Russian.

## Specification

[LFI-7 — Scratch-hosted tracker documents](<../[SPEC] LFI-7 — scratch-hosted-tracker-documents.md>)

## Blocked by

- [LFI-8 — Remove GitHub from the tracker role](<[DONE] LFI-8 — remove-github-from-the-tracker-role.md>)
