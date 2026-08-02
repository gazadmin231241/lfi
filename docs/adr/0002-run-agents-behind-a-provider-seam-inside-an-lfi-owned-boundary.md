---
status: accepted
---

> Amended by ADR-0003: the claim below that a container-based implementation
> could be added without changing the interface did not hold.

# Run agents behind a provider seam inside an LFI-owned boundary

LFI was built as an orchestrator of one coding agent. An execution tier resolved
to a model within that agent, the safety of an unattended run rested on that
agent's own sandbox, and the arrangement whereby the host committed a worker's
changes existed only because that sandbox made Git metadata read-only. A user who
wanted cheaper mechanical work run by a different agent could not express it, and
a second agent could not be added without silently dropping protections LFI never
owned.

LFI now runs agents behind an **agent provider** seam and confines them inside an
**isolation provider** it owns. Three decisions follow from that, and they are
recorded together because each depends on the others.

**An execution tier resolves to an agent and a model, not a model alone.** This
extends ADR-0001 along the axis it established: tiers exist to route work by the
judgment it demands, and which agent runs the work is part of that routing. The
merger role selects its agent independently. Everything else in ADR-0001 holds —
tiers do not raise reasoning effort, an explicitly configured value never
degrades silently, and a rejected model skips other work mapped to it, now keyed
by the agent-and-model pair. The agent is written as a prefix on the model value,
so an unprefixed value still means Codex and existing configurations keep
working. LFI never validates a model name or consults a catalogue: the user
copies the name out of their agent, and the catalogue belongs to the agent.

**Isolation is LFI's own and covers everything a task causes to run.** A
lightweight local mechanism built on user namespaces and mount isolation is the
default, with an explicit opt-out for already-disposable environments; the
interface is shaped so a container-based implementation can be added without
changing it. It applies to every agent, to the merger, to the integration
worktree, and to the project's validation and setup commands — which until now
ran the code an agent had just written, unconfined, on the host. An agent that
brings its own sandbox keeps it as a second layer, adjusted only so that Git
metadata stays writable.

**The agent commits its own work.** With the boundary owned by LFI, the old
arrangement loses its cause: the host committed because another program's sandbox
said it must, not because anyone chose it. Work now arrives structured as the
agent saw fit, and LFI stops inventing a commit message on its behalf. Acceptance
is unchanged — successful exit, an explicit completion status, commits ahead of
the base, a clean worktree.

**Completion is declared through a tagged block in the agent's output**, the same
way for every agent, replacing Codex's provider-enforced output schema. An
agent-independent contract every agent can honour is worth more than a
provider-enforced one only one agent can.

## Considered options

Building on an existing multi-agent harness was considered seriously, since one
exists that already runs five agents behind exactly this pair of abstractions and
supplied several of the decisions above. Forking it was rejected: forking is for
changing someone's core, and this core is the part LFI agrees with — the fork
would carry a large unrelated surface while the tracker, staging, and integration
layers that make LFI what it is would still have to be written. Depending on it
as a library was not rejected and remains open; it would remove most of the
execution layer this ADR describes while costing the project's zero-runtime-
dependency property. The question is settled by whether it will yield control of
worktree and branch lifecycle to LFI's staging model, which is a matter for a
prototype rather than an argument.

## Consequences

The completion contract now depends on the agent following instructions rather
than on a provider rejecting invalid output. No retry by session resumption is
introduced, so a failed extraction is a failed attempt.

An agent can rewrite the history of its own branch, which the previous read-only
Git metadata prevented structurally. This is accepted: the branch is disposable
and nothing inside the boundary holds credentials that could publish.

The default isolation mechanism requires user namespaces, so it is unavailable on
some platforms. There, the explicit opt-out and the agents' own sandboxes are all
that remain, and the diagnostic command says so before a run rather than during
one.
