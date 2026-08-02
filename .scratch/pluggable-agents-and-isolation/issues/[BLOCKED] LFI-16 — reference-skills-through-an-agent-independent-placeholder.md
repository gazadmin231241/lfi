Type: task
Blocked by: LFI-15
Tier: standard

> **Task complexity:** `standard`

## What to build

Prompts stop being written in one agent's invocation syntax.

A prompt refers to a skill through a placeholder naming that skill, and the
agent provider expands it into whatever syntax that agent understands. This
joins the placeholders prompt templates already support for the task identifier
and title.

The reason this matters is the shape of the failure it prevents. Agents differ
in how a skill is invoked, and a prompt written in the wrong syntax does not
produce an error — the agent simply reads it as ordinary text, and the run
proceeds without the implementation skill and without the mandatory code
review. The user gets a finished-looking run whose required process never
happened.

For the same reason, a prompt template still written in the old direct syntax is
refused rather than run. When LFI finds a direct reference to a skill that is
actually installed, it stops and names the placeholder to write instead.

The built-in worker and merger prompts are rewritten to use placeholders in both
languages.

## Acceptance criteria

- [ ] A prompt template references a skill through a placeholder naming it.
- [ ] Each agent provider expands the placeholder into its own invocation
      syntax; expansion is a pure function and is tested per agent.
- [ ] A template containing a direct reference to an installed skill is refused
      before the run starts, with a message naming the placeholder to use.
- [ ] A direct reference to something that is not an installed skill does not
      trigger the refusal.
- [ ] Built-in worker and merger prompts use placeholders in English and
      Russian.
- [ ] The mandatory review instruction still reaches the agent for every
      supported agent.

## Specification

[LFI-13 — Pluggable agents and isolation](<../[SPEC] LFI-13 — pluggable-agents-and-isolation.md>)

## Blocked by

- [LFI-15 — Adopt the completion block as the result contract](<[READY] LFI-15 — adopt-the-completion-block-as-the-result-contract.md>)
