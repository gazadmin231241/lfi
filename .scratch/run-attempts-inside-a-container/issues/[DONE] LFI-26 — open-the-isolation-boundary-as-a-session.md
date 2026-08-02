Type: task
Blocked by: None
Tier: deep

> **Task complexity:** `deep`

## What to build

A prefactor, and a correction. Nothing a user can observe changes; everything
that follows becomes possible.

The isolation provider is a synchronous rewriter today: one command in, one
command out. ADR-0002 predicted that a container implementation would fit this
interface unchanged. It does not, and ADR-0003 records why — a container is a
resource with a lifetime, created before the first command, reused by the setup
command, the agent, and the validation command, and destroyed even when the run
is aborted. A rewriter has no before and no after.

The boundary becomes an **isolation session**: opened once, running any number
of commands, closed with a guarantee that holds on abnormal termination as well
as normal completion. One session serves one attempt; the integration step and
the merger open their own. Both existing providers implement the new shape — the
local one with an empty open and an empty close, the opt-out by returning
commands untouched — and neither changes behaviour in any observable way.

Alongside it, what crosses the boundary is declared once per session in
provider-independent terms: the task's worktree, the repository's Git metadata,
the package manager cache directories, and the sanitized Git configuration. Each
provider derives its own mechanics from that one declaration. The local provider
computes what to cut away from a filesystem it inherits whole — which is what
its current configuration of credential directories and files really is — and
keeps producing exactly what it produces today. Building the process environment
becomes part of the same provider-owned derivation rather than a single shared
function, with the set of variables that may cross the boundary declared once.

The declaration and the session are one task because neither is coherent alone:
a session with nothing to receive on open has no reason to exist, and a
declaration nobody opens has no consumer.

Today the isolation provider is threaded through five layers as a bare value and
the boundary configuration is resolved again for every command, rescanning the
home directory each time. With a session it is resolved once per attempt, and
where the boundary begins and ends becomes visible in the code rather than
implied by a repeated argument.

## Acceptance criteria

- [x] The isolation seam is a session: open, run any number of commands, close.
- [x] Closing is guaranteed after a failed command and after an abort, not only
      after normal completion.
- [x] One session serves one attempt; the integration step and the merger each
      open their own.
- [x] What crosses the boundary is declared once per session in
      provider-independent terms, and each provider derives its own mechanics
      from it.
- [x] The process environment is derived by the provider from the same
      declaration, with the permitted variables declared in one place.
- [x] The boundary configuration is resolved once per session rather than once
      per command.
- [x] The local provider's behaviour is byte-for-byte what it is today, and the
      existing boundary integration test passes with its assertions unchanged.
- [x] The opt-out still returns commands unchanged.
- [x] Agent execution, the merger, the integration worktree, the validation
      command, and the worktree setup command all run through the session.

## Specification

[LFI-25 — Run attempts inside a container](<../[SPEC] LFI-25 — run-attempts-inside-a-container.md>)

## Blocked by

None — can start immediately.
