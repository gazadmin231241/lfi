<!-- lfi:tracker-contract:begin -->
<!-- lfi:tracker-contract -->
# Issue tracker: LFI

## Documents

Tracker documents live in `.scratch/`. A feature has one `Type: spec` document in
`.scratch/<feature-slug>/` and its tasks in
`.scratch/<feature-slug>/issues/`; a task without a specification is directly
in `.scratch/`. Completed documents stay in place; there is no archive.

Every tracker document uses the filename
`[STATUS] LFI-N — <slug>.md`. `[SPEC]`, `[READY]`, `[RUNNING]`,
`[BLOCKED]`, and `[DONE]` are the status values; this filename is the only
place status is recorded. `LFI-N` is the stable, repository-wide identifier,
allocated monotonically even across identifiers found only in Git history. LFI
renames a document when its status changes.

## Marker lines

Every document has a mandatory `Type:` line: `spec`, `task`, `research`,
`prototype`, or `grilling`. Only `Type: task` is executable; every other
type is non-executable. A missing `Type:` line is an error.

`Blocked by:` lists comma-separated blocking `LFI-N` identifiers, or `None`
when there are none. A `Type: task` document also has `Tier: light`,
`Tier: standard`, or `Tier: deep`; the tier expresses required judgment and
cost of error, and LFI configuration maps it to a model.

## Wayfinding operations

Used by `$wayfinder`. A wayfinding map is a tracker document at
`.scratch/<effort-slug>/[STATUS] LFI-N — map-<slug>.md`; its decision tickets
are tracker documents at
`.scratch/<effort-slug>/issues/[STATUS] LFI-N — <slug>.md`. The map uses a
non-task `Type:`; a decision ticket uses `Type: research`, `prototype`,
`grilling`, or `task`. A ticket changed to `Type: task` becomes executable
without moving it. Blocking and the frontier use the `Blocked by:` and status
rules above.
<!-- lfi:tracker-contract:end -->
