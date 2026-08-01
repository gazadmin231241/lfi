---
id: LFI-2
type: task
title: "Prepare tracker storage and ignore rules for nested documents"
status: completed
execution_tier: standard
spec: LFI-1
blocked_by:
completed_at: 2026-08-01T15:49:34.971Z
---

> **Task complexity:** `standard`

## What to build

A freshly initialised project gets a tracker directory that can hold the
spec-scoped layout, and Git keeps everything inside it. `lfi init` creates only
the tasks root — no separate specifications directory, no completed-tasks
archive. The managed ignore block exposes the whole tasks subtree, so documents
at any depth, plus notes and images a user keeps beside a specification, are
versioned without further configuration. Upgrading an existing project rewrites
the managed block in place, dropping the rules that named the old directories.

Transient state and logs stay ignored exactly as they are today.

This lands first on purpose: once documents start moving into nested
directories, ignore rules that only reach the top level would silently leave
them out of version control.

## Acceptance criteria

- [x] Initialising a project creates the tasks root and no longer creates a
      specifications directory or a completed-tasks directory.
- [x] The managed ignore block keeps the entire tasks subtree out of the ignore
      rules, at any depth, for any file type — not only Markdown.
- [x] Re-running initialisation on a project that carries the old managed block
      replaces it, leaving no stale rules for the removed directories.
- [x] Run state, logs, worktrees, and configuration remain ignored, at their
      current paths.
- [x] Tests cover a fresh initialisation and an upgrade over the old block,
      asserting on the resulting directories and ignore file.

## Specification

[LFI-1 — Spec-scoped tracker layout](<../../specs/[SPEC] LFI-1 — spec-scoped-tracker-layout.md>)

## Blocked by

None — can start immediately.
