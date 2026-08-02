Type: task
Blocked by: LFI-19
Tier: standard

> **Task complexity:** `standard`

## What to build

The hole that exists today, with Codex, and that nobody put there on purpose:
the project's validation and worktree-setup commands are run by the host with no
restriction at all — and what they run is the code an agent just wrote, plus
whatever install scripts its dependencies carry.

Once LFI owns an isolation boundary, those commands go through it too. The
boundary is the same one agents get, so everything a task causes to run is
confined the same way, whether an agent typed it or the project's own command
did.

The workflow the boundary protects must keep working: dependency installation
and the test suite are exactly what these commands do, so the caches they need
are writable and the network is available. Combined validation in the
integration worktree and validation repair are covered as well, since both run
the same project command.

Failure output keeps being redacted and reported as it is today; confinement
changes where a command runs, not what the user sees when it fails.

## Acceptance criteria

- [x] The project's validation command runs inside the isolation boundary.
- [x] The worktree-setup command runs inside the isolation boundary.
- [x] Combined validation in the integration worktree and validation repair are
      covered.
- [x] Dependency installation and test execution succeed under the boundary,
      verified by running them.
- [x] The isolation opt-out applies to these commands as it does to agents.
- [x] Failure output is redacted and surfaced exactly as before.
- [x] Tests assert that both commands pass through isolation, using a fake
      isolation executable on the path.

## Specification

[LFI-13 — Pluggable agents and isolation](<../[SPEC] LFI-13 — pluggable-agents-and-isolation.md>)

## Blocked by

- [LFI-19 — Confine agent execution to an isolation boundary](<[DONE] LFI-19 — confine-agent-execution-to-an-isolation-boundary.md>)
