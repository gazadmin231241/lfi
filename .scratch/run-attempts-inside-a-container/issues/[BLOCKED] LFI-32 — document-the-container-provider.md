Type: task
Blocked by: LFI-30
Tier: light

> **Task complexity:** `light`

## What to build

The user-facing account of the second isolation provider, written last on
purpose: documentation describes what works, not what is planned.

The product specification gains the container provider alongside the local one
and the opt-out — what crosses the boundary, that the setup command, the agent,
and the validation command share one environment for the length of an attempt,
that a missing prerequisite stops the run rather than weakening it, and which
platforms are supported.

Both language READMEs explain when to choose it — chiefly that the local
mechanism needs user namespaces and is therefore unavailable on macOS — what the
scaffolded Dockerfile is for and that it belongs to the user, that the agent
tooling on top of it belongs to LFI, and that an image is personal because it
carries the builder's identity and so cannot be shared with a team.

The generated configuration file's comment for the isolation setting gains a
line naming the container provider and when it is the right choice, in both
supported languages, alongside the lines already there.

Two things are stated rather than omitted, because a reader who discovers them
alone will assume they were overlooked: the package cache is shared between
workers that are otherwise isolated from each other, so a poisoned entry reaches
all of them and the host; and the agent's own credentials are inside the
boundary by design, with unfiltered network, so a compromised agent can leak its
key — while the code-host credentials that would let it publish remain outside.

## Acceptance criteria

- [ ] The product specification describes the container provider, what crosses
      the boundary, the shared environment for the length of an attempt, refusal
      instead of degradation, and the supported platforms.
- [ ] Both READMEs explain when to choose the provider, who owns the scaffolded
      Dockerfile, who owns the layer above it, and why an image is personal.
- [ ] The generated configuration comment names the container provider in both
      languages.
- [ ] The shared-cache trade-off and the agent-credential trade-off are both
      stated plainly.

## Specification

[LFI-25 — Run attempts inside a container](<../[SPEC] LFI-25 — run-attempts-inside-a-container.md>)

## Blocked by

- [LFI-30 — Refuse before the run rather than degrade](<[BLOCKED] LFI-30 — refuse-before-the-run-rather-than-degrade.md>)
