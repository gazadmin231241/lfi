Type: task
Blocked by: LFI-29
Tier: standard

> **Task complexity:** `standard`

## What to build

A boundary that quietly becomes a weaker boundary is worse than no boundary,
because the user still believes they have the one they configured. The project
already decided that an explicitly configured value never degrades silently;
this applies it where it matters most.

When the container provider is configured, the run verifies its prerequisites
before any work begins and stops if any of them fails: the runtime must respond,
the image must exist, and it must be fresh against the user's Dockerfile, the
LFI version, and the invoking identity. The message names which one diverged and
the command that fixes it. There is no fallback to the local provider and none
to the opt-out, under any failure.

One case LFI resolves itself: no image at all. A tool built to run unattended
should not demand a manual step before its first run, so LFI builds, streaming
the build into the same run log as everything else and stating on its first line
why it began. It never rebuilds silently — a stale image stops the run instead,
because the duration of a run should never be someone else's decision.

The diagnostic command derives its checks from the configuration, as it already
does for agents and for the local mechanism: with the container provider
configured it reports on the runtime, the image, its freshness, the identity
match, and any containers LFI left behind. With a different provider configured
it says none of this. Orphans left by abnormal termination are removed by label
at the start and end of every run.

On Windows the provider is reported as unsupported, by name, before anything is
attempted — identical paths are impossible there, and failing later on a path
that cannot exist would look like a defect rather than a boundary of the design.

## Acceptance criteria

- [ ] With the container provider configured, the run verifies runtime, image
      existence, freshness, and identity match before any work begins.
- [ ] A failed prerequisite stops the run with a message naming what diverged
      and the command that fixes it.
- [ ] There is no fallback to another isolation provider under any failure.
- [ ] An absent image is built automatically, streaming into the run log with a
      line stating why the build began.
- [ ] A stale image stops the run; LFI never rebuilds silently.
- [ ] The diagnostic command reports runtime, image, freshness, identity, and
      orphaned containers only when the container provider is configured.
- [ ] Containers left by abnormal termination are removed by label at the start
      and end of every run.
- [ ] On Windows the container provider is reported as unsupported by name,
      before anything is attempted.

## Specification

[LFI-25 — Run attempts inside a container](<../[SPEC] LFI-25 — run-attempts-inside-a-container.md>)

## Blocked by

- [LFI-29 — Run an attempt inside a container](<[READY] LFI-29 — run-an-attempt-inside-a-container.md>)
