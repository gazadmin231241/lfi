---
id: LFI-9
type: task
title: "Install upstream skills verbatim"
status: completed
execution_tier: light
spec: LFI-7
blocked_by:
completed_at: 2026-08-01T19:46:15.332Z
---

> **Task complexity:** `light`

## What to build

LFI stops editing other people's skills. A user who installs skills through LFI
gets exactly what upstream published at the pinned commit, so they can diff an
installed skill against upstream and find no difference.

The adaptation step, the tracker override text it inserted, and the matching
against literal upstream sentences that guarded it are all removed. With them
goes the failure they produced: installation no longer aborts when upstream
rewords an instruction.

Skill installation is otherwise unchanged — the same skills are fetched at the
same pinned commit, the update flow and its confirmation prompt behave as
before, and each installed skill still gets its agent metadata.

A user working in a repository that is not an LFI project now sees these skills
behave exactly as upstream intends.

## Acceptance criteria

- [x] Every installed skill is byte-identical to the same skill in the fetched
      bundle.
- [x] No installed skill contains an LFI tracker override marker or text.
- [x] Installation succeeds against skill text that would previously have
      aborted it because the expected upstream sentences were absent.
- [x] The set of installed skills, the pinned commit, the update flow, and its
      confirmation prompt are unchanged.
- [x] Each installed skill still carries its agent metadata, and installation
      still fails loudly when that metadata is missing from the bundle.
- [x] Tests assert byte-identical installation and the absence of any
      adaptation, driving installation from a local source and destination
      rather than the network.
- [x] User-facing output remains available in English and Russian.

## Specification

[LFI-7 — Scratch-hosted tracker documents](<../[SPEC] LFI-7 — scratch-hosted-tracker-documents.md>)

## Blocked by

None — can start immediately.
