Type: spec
Blocked by: None

## Problem Statement

A user browsing a project's LFI documents in a file tree sees three sibling
directories under `.lfi`: `specs/`, `state/`, and `tasks/`. Everything that
belongs to one feature is split across two of them, and completed work is split
again into `tasks/completed/`. To read a specification and then the tasks that
implement it, the user opens two directories, scans two flat lists that grow
with every feature in the project, and mentally re-joins them through the
`spec: LFI-N` frontmatter field. The relationship that matters most — this
specification, these tasks — is the one the storage layout hides.

The same flat lists make it impossible to keep feature material together.
There is nowhere to put a diagram, a scratch note, or a research excerpt that
belongs to one feature, because both collections are flat directories of
tracker documents and any other Markdown file there fails validation.

## Solution

One directory per specification, holding that specification and its tasks.

```
.lfi/
  config.env
  state/                                   ← unchanged
  logs/                                    ← unchanged
  tasks/
    ai-review-pipeline/
      [SPEC] LFI-1 — ai-review-pipeline.md
      notes.md                             ← user's own file, ignored by LFI
      diagram.png                          ← user's own file, ignored by LFI
      tasks/
        [DONE]  LFI-2 — parse-diff.md
        [READY] LFI-3 — post-comment.md
    telemetry/
      [SPEC] LFI-5 — telemetry.md
      tasks/
        [READY] LFI-6 — emit-run-metrics.md
    [READY] LFI-4 — fix-flaky-test.md      ← task with no specification
```

Opening one directory shows a whole feature: what was decided, what work it
decomposes into, what is done, and any material the user chose to keep beside
it. `.lfi/specs/` disappears. `.lfi/tasks/completed/` disappears; completion is
already visible in the `[DONE]` filename prefix, and grouping by feature removes
the clutter that the archive directory existed to hide.

Existing repositories move themselves. The reader understands both layouts, and
the reconciliation pass that already renames files on every command relocates
old documents into the new structure on first use.

## User Stories

1. As a developer reviewing a feature, I want the specification and its tasks in
   one directory, so that I can read the whole feature without cross-referencing
   two flat lists.
2. As a developer opening a project for the first time, I want the file tree to
   show me the project's features, so that I can orient myself by feature rather
   than by document type.
3. As a developer, I want a task's location to tell me which specification it
   implements, so that I do not have to open the file and read frontmatter.
4. As a developer with many completed tasks, I want them to stay beside the
   feature they belong to, so that a feature's history reads as one sequence.
5. As a developer, I want completed tasks to remain visible in their feature
   directory, so that I never have to look in a separate archive to reconstruct
   what was done.
6. As a developer, I want to keep a diagram, a note, or a draft next to the
   specification it explains, so that feature context does not scatter into
   unrelated directories.
7. As a developer, I want those extra files versioned with the specification, so
   that a teammate who clones the repository sees the same context I do.
8. As a developer filing a one-off task, I want to create it without inventing a
   specification for it, so that small work stays cheap to record.
9. As a developer, I want a standalone task to sit at the top of `.lfi/tasks/`,
   so that it is visible rather than buried in a single-file directory.
10. As a developer renaming a specification, I want its directory to follow the
    new title, so that directory names never drift from the documents inside.
11. As a developer renaming a specification, I want the links between its tasks
    and the specification to keep working, so that renaming is safe.
12. As a developer re-pointing a task's `spec` field, I want the task file to
    move to the new specification's directory automatically, so that the layout
    stays true without manual file management.
13. As a developer clearing a task's `spec` field, I want the task to move back
    to the top of `.lfi/tasks/`, so that an unowned task is not hidden inside a
    feature it no longer belongs to.
14. As a developer with two similarly titled specifications, I want LFI to
    disambiguate their directories automatically, so that publishing never fails
    on a name collision.
15. As a developer upgrading LFI on an existing project, I want my documents
    moved into the new layout on the first command, so that I do not have to
    perform a migration or learn a migration command.
16. As a developer upgrading LFI, I want the move to preserve every LFI-N,
    relationship, and status, so that nothing about my tracker changes except
    where the files sit.
17. As an agent following the tracker contract, I want the contract document to
    describe exactly one layout, so that I publish specifications and tasks to
    the right paths.
18. As an agent running `$to-spec`, I want the specification's directory created
    for me, so that publishing a specification is a single write.
19. As an agent running `$to-tickets`, I want to publish tasks into the
    specification's own `tasks/` directory, so that the relationship is recorded
    by placement as well as by frontmatter.
20. As a developer running `lfi status`, I want output grouped by feature, so
    that the CLI and the file tree tell the same story.
21. As a developer running `lfi status`, I want standalone tasks in their own
    trailing group, so that they are neither lost nor mixed into a feature.
22. As a developer committing tracker changes, I want the gitignore rules to
    cover the whole `.lfi/tasks/` subtree, so that nested tasks and feature
    material are versioned without further configuration.
23. As a developer, I want transient run state and logs to stay ignored and
    untouched, so that the layout change does not affect running work.

## Implementation Decisions

**Storage model.** `.lfi/tasks/` holds spec directories and standalone task
files. A spec directory contains exactly one `type: spec` document and a
`tasks/` subdirectory holding the `type: task` documents whose `spec` field
names that specification. A task with no `spec` field is a file directly in
`.lfi/tasks/`. `.lfi/specs/` and `.lfi/tasks/completed/` are no longer part of
the model.

**Naming.** A spec directory is named with the slug of its specification's
title — no ID, no status prefix, so that directory names stay stable across
status changes. Filenames keep their current form, `[STATUS] LFI-N — slug.md`,
for both specifications and tasks. Directory-name collisions resolve with a
numeric suffix (`telemetry`, `telemetry-2`). The name `completed` is reserved
and never used as a spec-directory slug, so that migration can distinguish the
legacy archive directory from a feature.

**Reconciliation.** The existing reconciliation pass — which today only renames
files — becomes responsible for placement as well: it derives each document's
target path from the document set and moves anything that is not already there.
This covers specification renames (directory and its contents move), `spec`
re-pointing (task moves between directories), `spec` clearing (task moves to the
root), and migration from the old layout (a one-way move performed the first
time any command loads a tracker). Empty directories are not removed, because
they may still hold the user's own files.

**Reading.** The tracker loader recognises both layouts while reading, so a
repository is never unreadable between versions. Only the new layout is ever
written.

**Validation.** A spec directory must hold exactly one specification, and each
task inside its `tasks/` subdirectory must reference that specification. A task
at the root of `.lfi/tasks/` must have no `spec`. Non-document files anywhere in
the subtree are ignored rather than rejected, which is what makes it safe for a
user to keep notes and images beside a specification.

**Ignore rules.** The managed gitignore block becomes `.lfi/*` plus negations
that expose the whole `.lfi/tasks/` subtree, so that nested documents and user
material are versioned. `state/` and `logs/` stay ignored, at their current
paths, with no changes to run state, the run lock, or log links in CLI output.

**CLI output.** `lfi status` groups documents by spec directory: the
specification first, then its tasks; standalone tasks form a final group. Status
prefixes, ordering rules, filters, and localisation are unchanged.

**Documentation.** The tracker contract written into `docs/agents/issue-tracker.md`,
the `$to-spec` and `$to-tickets` skill overrides, and both READMEs describe the
new layout only. GitHub mode, the mirror, the document format, and the shared
`LFI-N` sequence — including ID recovery from Git history — are untouched.

## Testing Decisions

A good test here exercises a real directory on disk through the module's
exported entry points and asserts on observable results: where files ended up,
what the loader returns, what the CLI prints. It never reaches into path-building
helpers or asserts on intermediate structures, because the point of the change is
the arrangement a user sees, not the code that computes it.

No new seams. The existing ones carry the change:

- `loadLocalTracker(lfiRoot)` — reads the new layout, still reads the old one,
  and enforces the placement rules. Prior art: the reference, cycle, and shared
  ID-sequence tests in `test/local-tracker.test.ts`.
- `reconcileTrackerFilenames(tracker, active)` — placement and renaming,
  including specification rename, `spec` re-pointing and clearing, collision
  suffixes, and migration from the old layout. Prior art: the derived-status
  filename test in `test/local-tracker.test.ts`, which already builds a tracker
  in a temporary directory and inspects the resulting files.
- `formatLocalStatus(...)` — grouped output, including the standalone-task
  group. Prior art: the display-prefix and completion-ordering tests in
  `test/local-tracker.test.ts`.
- `configureLocalTrackerStorage(cwd)` — created directories and the managed
  gitignore block. Prior art: the configuration tests in
  `test/config-and-logs.test.ts`.

Migration is tested as a side effect of reconciliation rather than through a
dedicated entry point, because that is how a user encounters it: an old-layout
repository, one ordinary command, a new-layout repository with every ID,
relationship, and status intact.

## Out of Scope

- GitHub Issues mode, the GitHub mirror, and `lfi migrate` (the GitHub-to-local
  import), beyond writing their imported documents into the new layout.
- The document format: frontmatter fields, the `LFI-N` sequence, execution
  tiers, status values, and the managed relationship sections stay as they are.
- Filename shape. `[STATUS] LFI-N — slug.md` is unchanged.
- `.lfi/state/`, `.lfi/logs/`, `.lfi/worktrees/`, and the run lock.
- Nesting specifications inside other specifications; the hierarchy stays one
  level deep.
- Any archival mechanism for finished features. Completed work stays in place.

## Further Notes

The path `.lfi/tasks/<feature>/tasks/` repeats the word "tasks". Renaming the
root to something neutral was considered and rejected: it would churn gitignore
rules, both READMEs, the agent contract, the skill overrides, and the Git-history
scan that recovers used IDs, in exchange for cosmetics.

Directory names derive from titles and therefore move when titles change. The
stable identifier remains `LFI-N` in frontmatter — paths have never been stable
in this tracker, since filenames already carry a status prefix that changes as
work progresses.
