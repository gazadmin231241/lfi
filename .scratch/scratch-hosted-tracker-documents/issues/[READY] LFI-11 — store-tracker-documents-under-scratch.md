Type: task
Blocked by: LFI-10
Tier: standard

> **Task complexity:** `standard`

## What to build

Tracker documents move to the conventional local markdown location, so that a
skill which never read this project's rules still writes into a directory LFI
reads.

Each feature owns a directory under the scratch root. Its specification sits at
the feature root; its executable tasks sit in an issues subdirectory beside it.
A task with no specification sits at the scratch root. Completed work stays
beside its specification, as it does today.

Everything the status listing already does keeps working from the new location:
grouping by feature, derived status prefixes, ordering, filters, blocker
annotations, and both languages.

LFI's private directory keeps only its runtime data — logs, run state, and
worktrees. The previous tracker directory is removed, and so are the ignore
rules LFI wrote for it, so that no stale rule shadows the new location. Tracker
documents are tracked in version control, so an agent working in a worktree sees
the same tasks as the main checkout.

This feature's own specification and tasks move as part of the change.

## Acceptance criteria

- [ ] Specifications, their tasks, and specification-less tasks are discovered
      at the new locations, and nowhere else.
- [ ] Documents written by LFI land at the new locations, and renaming on status
      change keeps a document in its feature directory.
- [ ] The status listing groups by feature and is otherwise unchanged in
      content, ordering, filters, and annotations.
- [ ] LFI's private directory contains only logs, run state, and worktrees.
- [ ] The previous tracker directory is gone and the ignore rules LFI wrote for
      it are removed from the project.
- [ ] Tracker documents are visible to a task running in a worktree.
- [ ] This feature's own documents are in the new location and load without
      error.
- [ ] Tests build a document tree at the new locations and assert on discovery,
      on where written documents land, and on the grouped listing.
- [ ] User-facing output remains available in English and Russian.

## Specification

[LFI-7 — Scratch hosted tracker documents](<../[SPEC] LFI-7 — scratch-hosted-tracker-documents.md>)

## Blocked by

- [LFI-10 — Record document fields as marker lines](<[DONE] LFI-10 — record-document-fields-as-marker-lines.md>)
