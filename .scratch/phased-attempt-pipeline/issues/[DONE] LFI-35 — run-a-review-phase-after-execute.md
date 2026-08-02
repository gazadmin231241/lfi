Type: task
Blocked by: None
Tier: deep

> **Task complexity:** `deep`

## What to build

An attempt no longer ends when the worker reports completion; the work is not
done until someone who did not write it has looked at it. After the execute
phase completes and LFI commits the worktree, LFI opens a fresh agent session
in the same worktree and isolation session and asks it to review the committed
diff against the base ref using the installed code-review skill, invoked
through the existing skill-placeholder mechanism so it works on every agent
provider without relying on subagent mechanics.

The reviewer does not talk to LFI in prose. Its prompt names an absolute
findings file path that LFI provides outside the worktree, in the run's
log/state directory, so findings never dirty the diff. The file is JSON: a
list of findings, each with an axis (`standards` or `spec`), a severity
(`blocking` or `advisory`), and a description. The completion-block contract
is unchanged for every phase; the findings file is the only new channel.

LFI decides acceptance from the file, not from the reviewer's summary. No
blocking findings means the attempt is accepted as today. Any blocking finding
makes the attempt not accepted with the worktree preserved and a summary that
names the review phase — remediation is a later task, and until it lands a
blocked attempt simply stops. A review session that completes without leaving
a parsable findings file is a review failure, never a clean review. Advisory
findings never affect acceptance.

The worker prompt keeps its current constraints for now; removing the
in-prompt review protocol is a separate task gated on the bounded remediation
loop replacing it.

## Acceptance criteria

- [x] A completed execute phase is followed by a review session in a fresh
      agent conversation in the same worktree, prompted via the
      skill-placeholder mechanism.
- [x] The reviewer is told the base ref to diff against and the absolute
      findings file path, and that path lies outside the worktree.
- [x] Findings are parsed from the JSON file; each finding carries axis,
      severity, and description, and unknown shapes are rejected.
- [x] An attempt with no blocking findings is accepted; commits and delivery
      inputs match today's accepted attempt.
- [x] An attempt with a blocking finding is not accepted, preserves the
      worktree, and its summary names the review phase.
- [x] A completed review session with a missing or unparsable findings file
      ends the attempt not accepted as a review failure.
- [x] Advisory-only findings do not change acceptance.
- [x] Review runs in its own log name; execute logs are unchanged.
- [x] The reused-dirty-worktree short-circuit behaves exactly as before.

## Specification

[LFI-34 — Phased attempt pipeline](<../[SPEC] LFI-34 — phased-attempt-pipeline.md>)

## Blocked by

None — can start immediately.
