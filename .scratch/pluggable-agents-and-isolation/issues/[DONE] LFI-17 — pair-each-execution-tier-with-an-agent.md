Type: task
Blocked by: LFI-14
Tier: standard

> **Task complexity:** `standard`

## What to build

A user says which agent runs which kind of work, on the line where they already
say which model runs it.

Each execution tier, and the merger role independently, resolves to a pair of an
agent and a model instead of a model alone. The agent is written as a prefix on
the model value, separated by the first colon; everything after it is passed to
the agent untouched, including any provider or thinking syntax that agent
defines for itself. A value with no prefix means Codex, so every existing
configuration keeps working with no edit.

LFI does not know what models exist. The user copies a model name out of their
agent and pastes it in; LFI never validates it against a catalogue and never
consults one. A model the agent rejects is reported as rejected — never
silently replaced.

The two configuration keys that name Codex are renamed to agent-neutral names.
The old names are still read, as deprecated aliases, and replaced by the
canonical ones the next time LFI writes the configuration.

The reasoning level stays one project-wide value for workers and one for the
merger, as the routing decision requires. What changes is that its accepted
vocabulary differs per agent, so the configuration is checked against the
vocabularies of the agents it actually names, and a value some named agent
cannot honour is rejected before the run with a message saying which agent
cannot honour it.

Skipping other tasks mapped to a model that proved unavailable is retained, but
keyed by the agent-and-model pair: the same model name under a different agent
is still attempted.

## Acceptance criteria

- [x] A tier and the merger role each resolve to an agent-and-model pair.
- [x] An agent prefix on a model value selects the agent; the remainder is
      passed through unmodified.
- [x] A value with no prefix resolves to Codex, and existing configurations load
      unchanged.
- [x] An unknown agent prefix is a configuration error naming the value.
- [x] The renamed keys are canonical; the former names load as deprecated
      aliases and are rewritten on the next save.
- [x] A reasoning level unsupported by an agent named in the configuration is
      rejected at load, naming that agent.
- [x] A reasoning level no configured agent supports is an error, never a
      downgrade.
- [x] Tier fallback behaviour from the routing decision is preserved.
- [x] Unavailability is keyed by the agent-and-model pair.
- [x] Model-routing tests are extended, not replaced; routing by tier is proven
      unchanged.

## Specification

[LFI-13 — Pluggable agents and isolation](<../[SPEC] LFI-13 — pluggable-agents-and-isolation.md>)

## Blocked by

- [LFI-14 — Route work through an agent provider seam](<[DONE] LFI-14 — route-work-through-an-agent-provider-seam.md>)
