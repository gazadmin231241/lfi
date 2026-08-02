Type: task
Blocked by: LFI-29
Tier: standard

> **Task complexity:** `standard`

## What to build

Two isolation providers are one boundary only if they answer the same questions
the same way. Right now that cannot even be stated: the boundary assertions are
written against one mechanism, so a second one could diverge without anything
noticing.

The assertions are written once and executed against every available provider:
the worktree is writable, the repository's Git metadata is writable, a file
outside the worktree is unreachable, code-host credentials are unreachable, the
network is reachable. A provider whose prerequisite is absent skips, following
the platform-skip pattern the existing boundary test already uses, rather than
failing. Adding a provider later means answering the same questions, not writing
new ones.

Two things about the container provider cannot be settled by reasoning and must
be established by running, then reported with the work rather than assumed:

**Whether a package manager that hard-links from a shared store can still do
so** when the store and the worktree arrive as two separate mounts of the same
host filesystem. They should be one filesystem and the link should succeed, but
if it does not, the manager silently falls back to copying and the shared cache
becomes twice the disk for none of the speed.

**Whether a shared cache reached through the macOS file-sharing layer actually
beats downloading again.** That layer is slow on large numbers of small files,
which is exactly what a package cache and a Git directory are. Sharing the cache
was chosen to keep parallel workers from downloading the same dependencies five
times; if it turns out slower than downloading, that reasoning does not hold on
that platform and the decision must be revisited rather than left standing.

An unfavourable answer to either does not fail this task. It changes what the
cache decision buys, and the point is that the change is visible.

## Acceptance criteria

- [ ] The boundary assertions exist once and are executed against every
      available isolation provider.
- [ ] The assertions cover: worktree writable, Git metadata writable, a file
      outside the worktree unreachable, code-host credentials unreachable,
      network reachable.
- [ ] A provider whose prerequisite is absent is skipped, not failed.
- [ ] The existing local-provider assertions still pass unchanged.
- [ ] Hard-linking from a shared package store across separate mounts of one
      host filesystem is measured by running, and the result is reported.
- [ ] Shared-cache performance through the macOS file-sharing layer is measured
      against downloading again, and the result is reported.
- [ ] An unfavourable measurement is recorded as a reconsideration of the cache
      decision rather than silently absorbed.

## Specification

[LFI-25 — Run attempts inside a container](<../[SPEC] LFI-25 — run-attempts-inside-a-container.md>)

## Blocked by

- [LFI-29 — Run an attempt inside a container](<[CANCELLED] LFI-29 — run-an-attempt-inside-a-container.md>)
