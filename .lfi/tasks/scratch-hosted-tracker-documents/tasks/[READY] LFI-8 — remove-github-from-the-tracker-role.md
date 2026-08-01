---
id: LFI-8
type: task
title: "Remove GitHub from the tracker role"
status: ready
execution_tier: deep
spec: LFI-7
blocked_by:
---

> **Task complexity:** `deep`

## What to build

GitHub stops being a place where tasks exist. A task lives in exactly one
place — the local tracker — and nothing mirrors it, imports it, or labels it
anywhere else.

Mirroring tracker documents to Issues, importing Issues into tracker documents
and the command that does it, and the LFI-managed type and execution-tier labels
all go away. So does the environment checking that only those facilities
required.

Everything GitHub does for the delivery of code is untouched: repository
detection, branches, worktrees, integration, and the delivery of agent results
work exactly as before. A user running tasks end to end after this change sees
no difference in how work reaches a branch.

Execution tiers keep working. Where a tier was previously read from an Issue
label it is read from the local document, and routing behaviour does not change.

This is deliberately first: it removes the second consumer of the tracker
document model, so the format and location changes that follow are made in one
place instead of two.

## Acceptance criteria

- [ ] Tracker documents are never written to, read from, or reconciled against
      GitHub Issues.
- [ ] The Issue import command is gone, and invoking it reports an unknown
      command rather than failing part-way.
- [ ] The LFI-managed specification, task, and execution-tier labels are neither
      created nor applied nor read.
- [ ] Running a task still creates its branch and worktree, and still delivers
      its result, with no change in behaviour.
- [ ] Execution tier still routes work to the same model it routed to before, in
      every tier.
- [ ] The environment report no longer requires GitHub facilities used solely by
      the removed tracker role, and still requires what code delivery needs.
- [ ] Tests covering mirroring, Issue import, and the removed label vocabulary
      are removed together with the code they covered; tests covering branches,
      worktrees, integration, and model routing still pass.
- [ ] User-facing output remains available in English and Russian.

## Specification

[LFI-7 — Scratch-hosted tracker documents](<../[SPEC] LFI-7 — scratch-hosted-tracker-documents.md>)

## Blocked by

None — can start immediately.
