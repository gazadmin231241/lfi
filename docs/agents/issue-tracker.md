<!-- lfi:tracker-contract:begin -->
<!-- lfi:tracker-contract -->
# Issue tracker: LFI

Each specification has its own directory at
`.scratch/<specification-slug>/`. It contains one `Type: spec` document
and an `issues/` subdirectory for its executable `Type: task` documents.
Tasks without a specification are files directly in `.scratch/`. Completed
tasks stay beside their specification; there is no archive directory. All
documents share one monotonically increasing `LFI-N` ID sequence, including
IDs found in Git history. The filename carries the only status and the stable
ID: `[READY] LFI-N — slug.md`. The body declares `Type:`, `Blocked by:`,
and, for executable tasks, `Tier: light`, `Tier: standard`, or `Tier: deep`.
Only `Type: task` is executable; `spec`, `research`, `prototype`, and
`grilling` are not. A missing `Type:` is an error. LFI renders clickable
`Specification` and `Blocked by` sections and keeps their links current.

`$to-spec` creates `.scratch/<specification-slug>/` and publishes one
`Type: spec` document there. `$to-tickets` publishes one `Type: task`
document per ticket in `.scratch/<specification-slug>/issues/`; tickets
without a specification go directly in `.scratch/`. LFI renames files when
their derived status changes.

Task creation assigns an abstract execution tier from required judgment and
cost of error; it never chooses a concrete model. LFI configuration maps tiers
to models.

Use `[SPEC]`, `[READY]`, `[RUNNING]`, `[BLOCKED]`, and `[DONE]` for
local filenames and status output. Specifications are never executable.
<!-- lfi:tracker-contract:end -->
