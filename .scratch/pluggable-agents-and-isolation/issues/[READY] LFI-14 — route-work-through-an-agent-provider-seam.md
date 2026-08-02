Type: task
Blocked by: None
Tier: standard

> **Task complexity:** `standard`

## What to build

A prefactor. Nothing a user can observe changes; everything that follows becomes
possible.

Today the knowledge of how to run a coding agent — how its command is built,
how its event stream is read, how its output yields a result, how an
unavailable-model error is recognised in its text — is spread through the single
Codex execution module and assumed by its callers. This task gathers that
knowledge behind one concept, the **agent provider**, so that a second agent can
be added later without any caller learning about it.

Codex remains the only provider and behaves exactly as it does now: same
command, same sandbox flags, same structured output schema, same log format,
same terminal output, same acceptance. A run before and after this task produces
the same result.

The execution seam is generalised from "run Codex" to "run an agent" and stays
the only place a process is spawned for agent work. Two pure functions come out
from behind it — one that builds the invocation from an agent, a model, a
reasoning level and a prompt, and one that recognises an unavailable-model error
in an agent's output — so that both can be tested without spawning anything.

## Acceptance criteria

- [ ] A single exported seam runs an agent; the worker and merger paths both
      reach an agent only through it.
- [ ] Building the invocation is a pure function of the agent, model, reasoning
      level and prompt, and is tested without spawning a process.
- [ ] Recognising an unavailable-model error is owned by the provider and tested
      as a pure function.
- [ ] No module outside the provider branches on which agent is in use.
- [ ] Codex behaviour is unchanged: identical command, identical log content,
      identical structured result handling, identical acceptance outcomes.
- [ ] Existing tests covering agent execution and model routing pass unmodified
      except where a symbol was renamed.
- [ ] User-facing output remains available in English and Russian.

## Specification

[LFI-13 — Pluggable agents and isolation](<../[SPEC] LFI-13 — pluggable-agents-and-isolation.md>)

## Blocked by

None — can start immediately.
