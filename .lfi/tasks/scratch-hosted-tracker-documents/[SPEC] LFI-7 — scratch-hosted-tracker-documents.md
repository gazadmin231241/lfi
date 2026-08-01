---
id: LFI-7
type: spec
title: "Scratch-hosted tracker documents"
status: ready
blocked_by:
---

## Problem Statement

A user runs `$to-spec` or `$to-tickets` in an LFI project and the documents land
somewhere LFI does not read, or with a shape LFI does not understand. The user
sees skills that "work strangely and do not know where to put things".

Three separate mechanisms produce this.

**LFI edits other people's skills.** LFI clones the upstream engineering skills
at a pinned commit and splices an "LFI tracker override" block into `to-spec`
and `to-tickets` before installing them into the shared skill directory. That
block restates the tracker layout — directories, filename forms, labels,
execution tiers — in prose, alongside its own opening instruction to go read the
project's tracker document instead. The restatement is a second copy of
knowledge that already exists in the project, and it is the copy that goes
stale: the installed skills currently direct documents at a specification
directory that the spec-scoped layout work removed. The skill confidently names
a directory that no longer exists.

The splice is also brittle by construction. It locates its insertion point by
matching literal sentences in the upstream skill text and aborts installation
when those sentences change, so an upstream rewording breaks LFI setup rather
than the skill.

**The installed skill is global, the layout is per-project.** One copy of each
skill serves every repository on the machine, but each repository carries its
own tracker rules. Nothing reconciles the two, and `lfi doctor` checks only that
skill files exist, never that their embedded instructions still match the
project.

**Skills LFI does not patch get no instructions at all.** `wayfinder` asks the
project's tracker document for a "Wayfinding operations" section describing
where its map and decision tickets live. LFI's tracker document has no such
section, so `wayfinder` falls back to its default and writes to `.scratch/`,
where LFI never looks. `wayfinder` is not in the set of skills LFI patches, and
every future skill will arrive in the same state. Patching does not scale:
teaching each new skill separately is unbounded work.

Underneath all three is one asymmetry. LFI stores its tracker documents in a
private directory of its own invention, while every unconfigured engineering
skill defaults to `.scratch/`. When an agent fails to read the project rules —
the common failure — its output does not land in the wrong format, it lands in a
directory nobody reads, and the work silently disappears.

## Solution

LFI stops teaching skills where to write and instead stores its documents where
unconfigured skills already write.

Tracker documents move to `.scratch/<feature-slug>/`, the conventional local
markdown location. A specification sits at the feature root; its tasks sit in an
`issues/` subdirectory beside it. When an agent ignores the project rules
entirely, its output now lands in the right directory with the wrong shape,
which a human or a subsequent run can see and repair, instead of vanishing.

LFI stops modifying installed skills. Skills are fetched and installed verbatim.
Everything a skill needs to know about this project's tracker lives in the
project's own tracker document, which LFI writes at initialization and which
ships with the repository in version control. This is the mechanism the upstream
skills were designed around: each skill already opens the project tracker
document and follows it. A layout change now touches one file inside the
project, and every skill that reads that file — including skills LFI has never
heard of — picks it up at once.

The tracker document is written as one coherent description of LFI's layout
rather than an upstream template with contradicting amendments layered on top,
because LFI's document naming genuinely differs from the upstream default and a
document that contradicts itself is the failure mode being removed. It includes
a "Wayfinding operations" section expressed in LFI's own naming, so `wayfinder`
becomes configured for the first time.

Documents keep the properties that make LFI usable and drop the ones that only
existed to satisfy a second consumer. Filenames keep their status prefix and
their repository-wide `LFI-N` identifier, because a directory listing that shows
status and identity at a glance is the primary way a human reads the tracker.
Frontmatter is replaced by plain marker lines in the document body — `Type:`,
`Blocked by:`, `Tier:` — matching how local markdown trackers already record
this and keeping the documents readable and hand-editable.

GitHub stops being a tracker. Mirroring documents to Issues, importing Issues
into documents, and the LFI-managed type and tier labels are removed. GitHub
remains what it is for the rest of LFI: the host for branches, worktrees, and
the delivery of agent results.

## User Stories

1. As a developer running `$to-spec` in an LFI project, I want the specification
   to be written into the project's feature directory under `.scratch/`, so that
   LFI finds it without further intervention.
2. As a developer running `$to-tickets`, I want each ticket written as its own
   document in the feature's `issues/` directory, so that tasks stay grouped
   with the specification that motivated them.
3. As a developer whose agent skipped reading the project tracker rules, I want
   its output to still land inside `.scratch/`, so that the work is recoverable
   rather than lost.
4. As a developer browsing the repository, I want a feature's specification and
   its tasks visible in one directory, so that I can read the whole feature
   without cross-referencing directories.
5. As a developer listing a feature directory, I want each filename to show its
   status and its identifier, so that I can see the state of the work without
   opening any file.
6. As a developer, I want every tracker document to carry a repository-wide
   `LFI-N` identifier, so that I can refer to a task in conversation, in a
   branch name, and in a log file with one short unambiguous token.
7. As a developer, I want the identifier sequence to keep counting past
   identifiers that appear only in Git history, so that a deleted document never
   causes a number to be reused.
8. As a developer, I want each document to declare its kind on a `Type:` line,
   so that LFI can tell an executable task from a specification or a decision
   question.
9. As a developer, I want LFI to execute only documents declaring `Type: task`,
   so that specifications and open questions are never handed to an agent as
   work.
10. As a developer, I want a document with no `Type:` line to be reported as
    malformed rather than assumed executable, so that a truncated or misplaced
    document fails loudly instead of being run.
11. As a developer, I want each executable task to carry a `Tier:` line, so that
    LFI keeps routing work to a model by execution tier as decided in the
    routing ADR.
12. As a developer, I want to change a task's tier by editing one visible line in
    the document, so that I can override the assigned tier before a run without
    tooling.
13. As a developer, I want blocking relationships recorded on a `Blocked by:`
    line naming the blocking identifiers, so that dependency edges are readable
    in the document itself.
14. As a developer, I want status recorded only in the filename, so that there is
    exactly one place to look and no possibility of two sources disagreeing.
15. As a developer, I want LFI to rename a document's file when its status
    changes, so that the directory listing stays accurate as work progresses.
16. As a developer running `lfi status`, I want documents read from the new
    location, so that the command reflects reality after the move.
17. As a developer running a task, I want the branch and log file named from the
    task identifier as they are today, so that my existing habits for finding a
    run's branch and log continue to work.
18. As a developer initializing LFI in a repository, I want `lfi init` to write
    the project's tracker document describing this layout, so that every skill
    that consults it is configured in one step.
19. As a developer, I want the tracker document to describe the layout once,
    without a section that later sections contradict, so that an agent reading it
    top to bottom cannot arrive at the wrong answer.
20. As a developer, I want `lfi init` to keep writing the pointer block in the
    project's agent instructions file, so that an agent that never opens the
    tracker document still learns it exists.
21. As a developer using `$wayfinder`, I want the tracker document to describe
    where its map and decision tickets live, so that wayfinding artifacts land in
    the tracker instead of an unread directory.
22. As a developer, I want wayfinding decision tickets named and numbered by the
    same rules as every other document, so that one convention covers the whole
    tracker.
23. As a developer, I want wayfinding decision tickets marked with a non-task
    `Type:`, so that LFI does not hand an open question to an agent as work.
24. As a developer, I want a wayfinding ticket that has become real work to be
    marked `Type: task` and become executable, so that a resolved question can
    turn into a run without being re-filed.
25. As a developer installing skills through LFI, I want the upstream skills
    installed exactly as published, so that I can diff them against upstream and
    trust what I am reading.
26. As a developer, I want LFI installation to survive upstream rewording of
    skill instructions, so that an unrelated upstream edit never breaks my setup.
27. As a developer, I want to benefit from upstream skill improvements by
    updating skills, so that I do not maintain a private fork.
28. As a developer using these skills in a repository that is not an LFI project,
    I want them to behave exactly as upstream intends, so that LFI's presence on
    my machine does not leak into unrelated work.
29. As a developer, I want the tracker documents committed to the repository, so
    that agents working in worktrees see the same tasks as the main checkout.
30. As a developer, I want LFI's private directory to hold only logs, run state,
    and worktrees, so that the distinction between LFI's runtime data and my
    project's tracked documents is obvious.
31. As a developer, I want the ignore rules LFI previously added for its tracker
    directory removed, so that stale rules do not shadow the new location.
32. As a developer, I want GitHub Issue mirroring, Issue import, and the
    LFI-managed type and tier labels removed, so that there is exactly one place
    where a task exists.
33. As a developer, I want branches, worktrees, and result delivery through
    GitHub to keep working unchanged, so that removing the tracker role does not
    cost me the delivery workflow.
34. As a developer, I want `lfi doctor` to stop requiring GitHub tracker
    facilities it no longer uses, so that its report reflects what LFI actually
    needs.
35. As a developer with completed work in the previous layout, I want no
    migration machinery, so that the project does not carry conversion code for a
    one-time move of finished documents.

## Implementation Decisions

**Storage location.** Tracker documents live under `.scratch/<feature-slug>/`.
The specification is a file at the feature root; executable tasks are files in
an `issues/` subdirectory. The directory is tracked in version control, matching
existing practice for local markdown trackers, so worktrees see the same
documents as the main checkout. The previous private tracker directory and the
ignore rules LFI wrote for it are removed; LFI's private directory retains only
logs, run state, and worktrees.

**Document naming.** One convention covers every document in the tracker:
`[STATUS] LFI-N — informative-slug.md`. The status prefixes are the existing
set — specification, ready, running, blocked, done. LFI renames the file when
status changes. Status appears nowhere else.

**Identity.** The repository-wide `LFI-N` sequence is retained, allocated
monotonically and accounting for identifiers present only in Git history. It
identifies documents, names branches, and names log files exactly as it does
today; the branch and log naming code is unchanged.

**Document body.** Frontmatter is dropped. Structured fields become plain marker
lines in the body: `Type:`, `Blocked by:`, and, for executable tasks, `Tier:`.

**Type vocabulary.** `spec`, `task`, `research`, `prototype`, `grilling`. Only
`task` is executable. The line is mandatory on every tracker document; a
document without it is reported as malformed rather than defaulted, because a
silent default is precisely the class of behaviour this work removes. The
non-task values are the vocabulary wayfinding already uses, so a wayfinding
ticket that becomes real work is marked `task` and becomes executable without
being re-filed.

**Execution tier.** The tier vocabulary and the routing decision recorded in the
model-routing ADR are unchanged; only the storage of the value moves from
frontmatter and GitHub labels to the `Tier:` line. Assignment remains derived
from required judgment and cost of error, and remains overridable by editing the
line before a run.

**Skill installation.** LFI no longer adapts installed skills. The adaptation
step, the override text, and the upstream-anchor matching that guarded it are
removed, together with the installation failure mode they produced. Skills are
fetched at the pinned commit and installed verbatim. The existing behaviour of
ensuring agent metadata accompanies each installed skill is retained.

**Project tracker document.** `lfi init` writes the project's tracker document
as one coherent description of the layout above, authored by LFI rather than
assembled from an upstream template with amendments. The reason is that LFI's
document naming differs from the upstream local-markdown default, so an
amendment approach would produce a document whose later sections contradict its
earlier ones — the exact ambiguity this work exists to remove. The document
retains its existing contract marker so that consumers can detect it, and
includes a "Wayfinding operations" section expressed in LFI's naming so that
wayfinding artifacts are covered by the same conventions as everything else.
The pointer block written into the project's agent instructions file is
unchanged.

**GitHub.** The tracker role is removed: Issue mirroring, Issue import and its
command, the mirror adapter, and the LFI-managed type and tier labels. The
hosting role is retained in full: repository detection, branches, worktrees, and
delivery of agent results. Environment checks are reduced to what the retained
role requires.

**Migration.** None. The documents in the previous layout are complete work
whose value is in Git history. No conversion command is written and
initialization does not detect or offer to convert the old layout.

## Testing Decisions

A good test here exercises an exported seam with real inputs and asserts on
observable output — the documents on disk, the parsed model, the text written
at initialization — never on how a module reaches that result. The layout change
touches many modules, so tests should be concentrated at as few seams as
possible rather than spread across every module that moves.

Three seams carry this work, all of them existing:

- **Tracker reconciliation** — the function that loads a tracker root and
  returns the reconciled documents. This is the highest seam for the whole
  storage change. Tests build a `.scratch/` tree on disk and assert that
  specifications and tasks are discovered in their new locations, that status is
  derived from the filename, that `Type:`, `Blocked by:`, and `Tier:` are parsed
  from the body, that a missing `Type:` is reported as malformed, that only
  `task` documents are offered for execution, and that identifier allocation
  continues past identifiers seen only in history. Prior art: the existing local
  tracker tests, which already construct document trees in a temporary directory
  and assert on the loaded model.
- **Project configuration** — the function that performs local tracker setup.
  Tests assert on the text of the tracker document written into the project,
  including the presence of the contract marker and the wayfinding section, on
  the pointer block written into the agent instructions file, and on the removal
  of the ignore rules for the previous location. Prior art: the existing tests
  covering setup output and ignore-rule editing.
- **Skill installation** — the function that installs the skill bundle. Tests
  assert that installed skill content is byte-identical to the source bundle and
  that no adaptation marker appears, and that installation succeeds against
  source text that would previously have failed anchor matching. Prior art: the
  existing skills tests, which already drive installation against a local source
  root and destination root rather than the network.

Existing tests covering GitHub mirroring, Issue import, and label vocabulary are
removed with the code they cover. Model routing tests are retained and adjusted
to source the tier from the document body rather than frontmatter or labels;
routing behaviour itself must not change, and the retained tests are the evidence
of that.

## Out of Scope

- Converting documents from the previous layout. Existing documents are complete
  and stay in Git history.
- Reintroducing GitHub as a tracker in any form. The retained `LFI-N` identifier
  makes mirroring technically possible again, but no mirroring is built.
- Changing which model each execution tier maps to, or how a tier is chosen.
  Only where the value is stored changes.
- Changing branch naming, worktree handling, integration, or result delivery.
- Vendoring or forking the upstream skills. They continue to be fetched at a
  pinned commit.
- Adding a check that verifies installed skills against project rules. Once
  skills carry no project knowledge, there is nothing to drift.
- Triage label vocabulary and the domain document layout that the upstream setup
  skill also configures.

## Further Notes

The change is a net deletion. Removed: the skill adaptation step with its
override text and anchor matching, the GitHub tracker role across mirroring,
import, and labels, the previous tracker directory and its ignore rules, and
frontmatter parsing. Added: a coherent tracker document written at
initialization, and marker-line parsing for `Type:`, `Blocked by:`, and `Tier:`.

This reverses the spec-scoped tracker layout work that introduced the previous
directory structure, and removes the Issue import feature outright. The
directory-per-feature idea that work established survives intact — it is the
same shape, relocated to a directory that unconfigured skills already write to.

The load-bearing property is the failure mode, not the directory name. Storing
documents where an unconfigured skill writes by default means the common failure
— an agent that never opened the project rules — produces a recoverable wrong
shape in the right place rather than silent loss. Every other benefit follows
from removing duplicated knowledge, and would hold even if the directory were
named differently.
