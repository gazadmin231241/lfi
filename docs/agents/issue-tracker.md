<!-- lfi:tracker-contract:begin -->
<!-- lfi:tracker-contract -->
# Issue tracker: LFI

Specifications are flat files in `.lfi/specs/`; executable tasks are
files in `.lfi/tasks/`. Completed tasks move immediately to
`.lfi/tasks/completed/`. Both collections share one monotonically
increasing `LFI-N` ID sequence, including IDs found in Git history. A task
links to its specification with `spec: LFI-N` and to blockers with
`blocked_by`. Executable tasks store exactly one `execution_tier` value:
`light`, `standard`, or `deep`. LFI also renders clickable
`Specification` and `Blocked by`
sections at the end of each task and keeps their file links current. Approved
tasks use `status: ready`.

`$to-spec` publishes one `type: spec` document in `.lfi/specs/`.
`$to-tickets` publishes one `type: task` document per ticket in
`.lfi/tasks/` and records its `spec` relationship. Filenames start with
the derived status, then the stable ID: `[READY] LFI-N — slug.md`. LFI
renames them when status changes.

Local `type: spec` and `type: task` map exactly to GitHub `lfi:spec` and
`lfi:task`. Task creation assigns an abstract execution tier from required
judgment and cost of error; it never chooses a concrete model. LFI
configuration maps tiers to models.

Use `[SPEC]`, `[READY]`, `[RUNNING]`, `[BLOCKED]`, and `[DONE]` only
for local filenames and local status output. GitHub Issue titles use the stable
`LFI-N — title` form without status prefixes. Specifications are never
executable.
<!-- lfi:tracker-contract:end -->
