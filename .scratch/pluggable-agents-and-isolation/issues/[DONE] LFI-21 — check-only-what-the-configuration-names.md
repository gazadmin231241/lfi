Type: task
Blocked by: LFI-17, LFI-18, LFI-19
Tier: light

> **Task complexity:** `light`

## What to build

`lfi doctor` stops reporting a healthy project as broken.

Today it unconditionally requires Codex to be installed and logged in, and
requires every installed skill to carry Codex-specific metadata. A user who
configured only the other agent is told to fix things they deliberately do not
use.

The required checks are derived from the configuration instead. An agent is
checked only when some tier or the merger names it. The Codex-specific skill
metadata requirement applies only when Codex is configured. The isolation
mechanism is checked when isolation is enabled, so a missing prerequisite
surfaces before a run rather than during one. Version control and code-host
checks stay unconditional, because LFI needs them regardless.

One rule constrains how an agent may be checked: the diagnostic output is shown
to the user, and credentials must never appear in it. An agent whose only way to
report authentication is to print the credential itself is therefore checked for
presence on the path and nothing more — a weaker check is correct here, and
disclosure is not an acceptable price for a stronger one.

## Acceptance criteria

- [x] An agent is a required check only when the configuration names it.
- [x] The Codex-specific skill metadata check applies only when Codex is
      configured.
- [x] The isolation mechanism is checked when isolation is enabled and reported
      as missing with an actionable message.
- [x] Version control and code-host checks remain unconditional.
- [x] No check places credential-bearing command output into the reported
      detail, asserted by test.
- [x] A project configured only for the second agent reports healthy without
      Codex installed.
- [x] Diagnostic output remains available in English and Russian.

## Specification

[LFI-13 — Pluggable agents and isolation](<../[SPEC] LFI-13 — pluggable-agents-and-isolation.md>)

## Blocked by

- [LFI-17 — Pair each execution tier with an agent](<[DONE] LFI-17 — pair-each-execution-tier-with-an-agent.md>)
- [LFI-18 — Run tasks with the pi agent](<[DONE] LFI-18 — run-tasks-with-the-pi-agent.md>)
- [LFI-19 — Confine agent execution to an isolation boundary](<[DONE] LFI-19 — confine-agent-execution-to-an-isolation-boundary.md>)
