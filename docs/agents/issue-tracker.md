<!-- lfi:tracker-contract:begin -->
<!-- lfi:tracker-contract -->
# Issue tracker: LFI

Each specification has its own directory at
`.lfi/tasks/<specification-slug>/`. It contains one `type: spec` document
and a `tasks/` subdirectory for its executable `type: task` documents.
Tasks without a specification are files directly in `.lfi/tasks/`. Completed
tasks stay beside their specification; there is no archive directory. All
documents share one monotonically increasing `LFI-N` ID sequence, including
IDs found in Git history. A task links to its specification with `spec: LFI-N`
and to blockers with `blocked_by`. Executable tasks store exactly one
`execution_tier` value: `light`, `standard`, or `deep`. LFI also renders
clickable `Specification` and `Blocked by` sections at the end of each task
and keeps their file links current. Approved tasks use `status: ready`.

`$to-spec` creates `.lfi/tasks/<specification-slug>/` and publishes one
`type: spec` document there. `$to-tickets` publishes one `type: task`
document per ticket in `.lfi/tasks/<specification-slug>/tasks/` and records
its `spec` relationship; tickets without a specification go directly in
`.lfi/tasks/`. Filenames start with the derived status, then the stable ID:
`[READY] LFI-N — slug.md`. LFI renames them when status changes.

Task creation assigns an abstract execution tier from required judgment and
cost of error; it never chooses a concrete model. LFI configuration maps tiers
to models.

Use `[SPEC]`, `[READY]`, `[RUNNING]`, `[BLOCKED]`, and `[DONE]` for local
filenames and status output. Specifications are never executable.
<!-- lfi:tracker-contract:end -->
