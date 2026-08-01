---
id: LFI-6
type: task
title: "Document the spec-scoped layout for agents and users"
status: ready
execution_tier: standard
spec: LFI-1
blocked_by:
  - LFI-3
---

> **Task complexity:** `standard`

## What to build

Every place that describes where tracker documents live describes the new
layout, and only the new layout — so that an agent publishing a specification or
a batch of tickets writes to the right paths on its first attempt, and a person
reading the documentation sees what is actually on disk.

That covers the tracker contract written into the project's agent guide, the
overrides LFI injects into the specification and ticket skills, both READMEs,
and the project specification's description of local storage. The old
specifications directory and completed-tasks archive disappear from the prose.
Everything stays available in English and Russian.

Projects whose agent guide or contract still carries the previous managed text
have it rewritten in place on the next configuration run, rather than gaining a
second copy.

## Acceptance criteria

- [ ] The tracker contract describes the spec-scoped layout: a directory per
      specification, tasks inside it, tasks without a specification at the root,
      no archive directory.
- [ ] The injected overrides for the specification and ticket skills instruct
      agents to publish to the new paths.
- [ ] Both READMEs and the project specification show the new layout.
- [ ] Regenerating the contract over previously generated text replaces it
      rather than appending a second copy.
- [ ] All user-facing text is present in English and Russian.
- [ ] Tests cover contract generation over an existing managed block and the
      adapted skill overrides.

## Specification

[LFI-1 — Spec-scoped tracker layout](<../specs/[SPEC] LFI-1 — spec-scoped-tracker-layout.md>)

## Blocked by

- [LFI-3 — Store each specification and its tasks in one directory](<[BLOCKED] LFI-3 — store-each-specification-and-its-tasks-in-one-directory.md>)
