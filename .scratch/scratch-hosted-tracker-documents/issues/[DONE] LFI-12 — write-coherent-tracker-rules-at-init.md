Type: task
Blocked by: LFI-11
Tier: standard

> **Task complexity:** `standard`

## What to build

Initializing LFI in a repository leaves behind one document that tells every
skill everything it needs to know about this project's tracker.

That document describes the layout once, in LFI's own words, with no section
that a later section contradicts. It covers where a feature's specification and
tasks live, how filenames carry status and identity, what the `Type:`,
`Blocked by:`, and `Tier:` lines mean, which kinds are executable, and that a
missing `Type:` is an error. It keeps the marker that lets a consumer recognise
it as LFI's tracker contract.

It also covers wayfinding — where a map and its decision tickets live and how
they are named — expressed in the same naming as everything else, so that a
wayfinding artifact is a tracker document like any other and one convention
covers the whole tracker.

The pointer block written into the project's agent instructions file is
unchanged, so an agent that never opens the tracker document still learns it
exists.

After this, a user initializing a fresh project and running the spec, ticket,
and wayfinding skills gets documents in the right place, in the right shape,
with no skill edited and nothing else configured.

## Acceptance criteria

- [x] Initialization writes the project's tracker document describing the
      current layout, retaining the contract marker.
- [x] The document describes each rule once; no statement in it is contradicted
      by another.
- [x] The document covers locations, filename status and identity, every marker
      line, the kind vocabulary, which kinds are executable, and the malformed
      case.
- [x] The document covers wayfinding locations and naming, using the same naming
      rules as the rest of the tracker.
- [x] The pointer block in the project's agent instructions file is written as it
      is today, and re-initializing does not duplicate it.
- [x] Re-initializing an already configured project does not damage a user's
      edits to surrounding content.
- [x] This repository's own tracker document is regenerated and matches the
      current layout.
- [x] Tests assert on the text written into the project — the contract marker,
      the wayfinding coverage, and the pointer block — and on re-initialization
      being safe.
- [x] User-facing output remains available in English and Russian.

## Specification

[LFI-7 — Scratch hosted tracker documents](<../[SPEC] LFI-7 — scratch-hosted-tracker-documents.md>)

## Blocked by

- [LFI-11 — Store tracker documents under scratch](<[DONE] LFI-11 — store-tracker-documents-under-scratch.md>)
