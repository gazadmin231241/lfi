Type: task
Blocked by: LFI-2
Tier: deep

> **Task complexity:** `deep`

## What to build

The core of the layout change. A specification and the tasks that implement it
live in one directory named after the specification's title; the tasks sit in a
`tasks` subdirectory beside it. A task with no specification is a file at the
top of the tasks root. Opening one directory shows a whole feature.

The reconciliation pass that already renames files on every command becomes
responsible for placement too. It derives each document's target path from the
document set and moves whatever is not already there, which makes every one of
these behaviours fall out of the same mechanism:

- renaming a specification moves its directory, with its tasks inside it;
- re-pointing a task at another specification moves the task between
  directories;
- clearing a task's specification returns it to the tasks root;
- two specifications whose titles slugify identically get a numeric suffix on
  the second directory;
- an existing project in the old layout is converted on the first command that
  loads the tracker, because the loader still reads the old paths while only
  the new ones are ever written.

Completed tasks stop moving into an archive directory — they stay beside their
feature, where the status prefix already marks them done. Empty directories are
left alone, since a user's own files may still be in them.

Validation follows the new shape: exactly one specification per feature
directory, every task in that directory referencing it, and a task at the root
carrying no specification reference. Files that are not tracker documents are
ignored rather than rejected, so notes and diagrams can sit beside a
specification.

Migration keeps every identifier, relationship, status, and completion
timestamp intact; the only thing that changes is where files sit. The shared
identifier sequence, including recovery of identifiers from Git history,
behaves as before.

## Acceptance criteria

- [x] A specification and its tasks are stored in one directory named from the
      specification's title, with tasks in a subdirectory; a task with no
      specification is stored at the tasks root.
- [x] The loader reads both the old and the new layout; only the new layout is
      written.
- [x] A project in the old layout is fully converted by the first command that
      loads the tracker, with identifiers, relationships, statuses, and
      completion timestamps unchanged.
- [x] Renaming a specification moves its directory and its tasks, and the
      generated specification and blocker links in every affected task still
      resolve.
- [x] Changing or clearing a task's specification reference moves the task to
      the matching location.
- [x] Two specifications with colliding slugs produce distinct directories via a
      numeric suffix, and the reserved archive name is never used as a feature
      directory name.
- [x] Completed tasks remain in their feature directory.
- [x] Validation rejects a feature directory with no specification or more than
      one, and a task placed under a specification it does not reference;
      non-document files anywhere in the subtree are ignored.
- [x] Tests exercise the loader and the reconciliation pass against real
      directories, covering the new layout, migration from the old one, renames,
      re-pointing, and collisions.

## Specification

[LFI-1 — Spec scoped tracker layout](<../[SPEC] LFI-1 — spec-scoped-tracker-layout.md>)

## Blocked by

- [LFI-2 — Prepare tracker storage and ignore rules for nested documents](<[DONE] LFI-2 — prepare-tracker-storage-and-ignore-rules-for-nested-documents.md>)
