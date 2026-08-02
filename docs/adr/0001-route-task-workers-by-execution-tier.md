---
status: accepted
superseded-in-part-by: 0002
---

# Route task workers by execution tier

> Superseded in part by ADR-0002. A tier now resolves to an agent and a model
> rather than a model alone, and the restriction to the Codex execution boundary
> stated below no longer holds. Every other decision here stands.

LFI assigns every executable task a model-independent execution tier of
`light`, `standard`, or `deep`. The task-creation agent proposes the tier from
an explicit rubric, and a user may override it before execution. Tasks store
the tier on a visible `Tier:` marker line. Missing tier metadata resolves to
`standard` with a warning.

Each tier resolves through `LIGHT_MODEL`, `STANDARD_MODEL`, or `DEEP_MODEL`.
An absent tier mapping falls back to the existing `CODEX_MODEL`; an explicitly
configured model that Codex rejects never falls back silently. LFI skips other
tasks mapped to that unavailable model for the remainder of the run, logs the
failure explicitly, and continues tasks whose models remain available.

Execution tiers select only the worker model. `CODEX_REASONING_EFFORT` remains
the user's project-wide worker setting and is never raised automatically.
Retries preserve both the task's assigned tier and the configured reasoning
effort. Merge-conflict resolution and validation repair remain an independent
role configured by `MERGER_MODEL` and `MERGER_REASONING_EFFORT`;
`MERGER_MODEL` falls back through `STANDARD_MODEL`, then `CODEX_MODEL`.

The first version remains on the existing Codex CLI execution boundary. It
does not introduce other agent providers, automatic model escalation, retry
policy changes, usage accounting, price calculation, or persisted
classification rationale. Interactive initialization offers the current
Luna/Terra/Sol mapping as a preset; non-interactive initialization keeps empty
tier mappings unless `--model` is supplied, in which case that model is used
for all three tiers.

The classification rubric is based on required judgment and cost of error, not
file count: bounded mechanical work is `light`, ordinary feature and bug work
is `standard`, and ambiguous, cross-boundary, security-, concurrency-, or
data-sensitive work is `deep`. Doubt is resolved upward.
