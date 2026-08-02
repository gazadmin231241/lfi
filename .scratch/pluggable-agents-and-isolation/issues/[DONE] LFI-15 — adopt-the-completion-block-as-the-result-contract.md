Type: task
Blocked by: LFI-14
Tier: deep

> **Task complexity:** `deep`

## What to build

Acceptance stops depending on one agent's provider-enforced output schema and
starts depending on a contract every agent can honour.

An agent declares that it finished by emitting a tagged block containing its
completion status and a summary. LFI takes the last such block in the agent's
output, tolerates whatever surrounds it — prose before and after, markdown code
fences around it — parses it, and checks its shape. An agent that produced no
valid block did not complete, and the existing acceptance rules reject the
attempt as they already do for an incomplete status.

Because the contract now lives in the prompt rather than in a provider flag, a
prompt that never instructs the agent to emit the block would produce a run that
cannot succeed. LFI refuses to start such a run and says so, rather than
discovering it after the work is done.

The built-in prompts in both languages are updated to require the block. Codex's
output-schema and result-file flags are removed.

This is the riskiest change in the specification: it trades a guarantee the
provider enforced for one the agent must follow. The tests for extraction carry
that risk and should be the densest in the whole effort.

## Acceptance criteria

- [x] Extraction is a pure function from agent output to a completion status and
      summary, or to a reported contract failure.
- [x] The last occurrence of the block wins when several are present.
- [x] Surrounding prose and markdown code fences do not prevent extraction.
- [x] Malformed content, a block of the wrong shape, and a missing block each
      yield a non-completed result rather than an exception escaping the seam.
- [x] A run whose prompt does not instruct the agent to emit the block fails
      before any work starts, with a message saying what is missing.
- [x] Codex no longer receives output-schema or result-file arguments.
- [x] Built-in worker and merger prompts require the block in English and
      Russian.
- [x] Acceptance outcomes are otherwise unchanged: successful exit, completed
      status, commits ahead of base, clean worktree.

## Specification

[LFI-13 — Pluggable agents and isolation](<../[SPEC] LFI-13 — pluggable-agents-and-isolation.md>)

## Blocked by

- [LFI-14 — Route work through an agent provider seam](<[DONE] LFI-14 — route-work-through-an-agent-provider-seam.md>)
