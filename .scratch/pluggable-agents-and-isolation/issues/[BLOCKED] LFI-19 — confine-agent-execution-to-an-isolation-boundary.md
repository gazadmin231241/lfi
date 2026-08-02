Type: task
Blocked by: LFI-14
Tier: deep

> **Task complexity:** `deep`

## What to build

LFI stops borrowing its safety story from whichever agent it happens to run and
starts owning it.

An **isolation provider** confines a command to a boundary LFI defines. Two
implementations ship: a lightweight local one built on user namespaces and mount
isolation, which is the default, and an explicit opt-out for environments that
are already disposable. The interface must be able to accept a container-based
implementation later without changing, which means it carries line-by-line
output streaming, idle-timeout support, and delivery of a long prompt through
standard input rather than as an argument.

Inside the boundary the filesystem is read-only except for the task's worktree,
the repository's Git metadata, a temporary filesystem, and the caches package
managers need. Credentials for the code host are not present at all — the host
publishes results, so no agent ever needed them. Network access remains, because
dependency installation and the agent's own API calls require it.

Every agent LFI runs goes through the boundary, including the merger role and
work in the integration worktree. An agent that brings its own sandbox keeps it,
running inside LFI's boundary; the two layers coexist and the working one is not
switched off.

Because Git metadata is writable inside the boundary, the commit model inverts
in this same task — it cannot be separated, since either half alone leaves the
run broken. **The agent commits its own work** and LFI stops staging and
committing on its behalf, and stops inventing a commit message for it. The
prompt instructions that forbade committing are replaced by instructions that
require it. Acceptance is unchanged: successful exit, completed status, at least
one commit ahead of the base, clean worktree. No history-integrity check is
added; that risk is accepted, and is bounded by the branch being disposable and
by nothing inside the boundary being able to publish.

One consequence must be handled explicitly: Codex's own sandbox currently makes
Git metadata read-only, which would prevent the agent from committing. Codex
keeps its sandbox, but must be run so that Git metadata is writable — its
protection of everything else is retained, and LFI's boundary now covers what it
stops covering.

Whether the boundary actually works cannot be settled by reasoning and must be
established by running it: a worktree's Git pointer has to resolve inside the
boundary, and package installation and the project's test suite have to succeed
under it.

## Acceptance criteria

- [ ] Wrapping a command for the boundary is a pure function of the command and
      the isolation configuration, tested without spawning a process.
- [ ] The worktree is writable and the rest of the filesystem is not.
- [ ] Code-host credentials are absent inside the boundary.
- [ ] Network access is available inside the boundary.
- [ ] The opt-out returns the command unchanged and is selectable by
      configuration.
- [ ] Agent execution for workers, for the merger, and in the integration
      worktree all pass through the boundary, verified with a fake isolation
      executable on the path.
- [ ] An agent with its own sandbox still runs it, inside the boundary, and can
      write Git metadata.
- [ ] The agent creates the commits; LFI no longer stages or commits worker
      changes and no longer composes a commit message.
- [ ] Prompts instruct the agent to commit, in English and Russian.
- [ ] Acceptance rules are unchanged and tests assert acceptance of an attempt
      whose commits the agent made.
- [ ] Verified by running, not by reasoning: a worktree's Git pointer resolves
      inside the boundary, and dependency installation and the project's test
      suite succeed under it.

## Specification

[LFI-13 — Pluggable agents and isolation](<../[SPEC] LFI-13 — pluggable-agents-and-isolation.md>)

## Blocked by

- [LFI-14 — Route work through an agent provider seam](<[READY] LFI-14 — route-work-through-an-agent-provider-seam.md>)
