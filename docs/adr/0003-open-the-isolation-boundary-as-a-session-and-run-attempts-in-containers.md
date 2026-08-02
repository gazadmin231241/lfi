---
status: accepted
---

# Open the isolation boundary as a session, and run attempts in containers

ADR-0002 gave LFI an isolation boundary of its own and predicted that the
interface was "shaped so a container-based implementation can be added without
changing it". That prediction was wrong, and correcting it is the first thing
this record does. The interface is a synchronous rewriter of one command into one
command: it has no before and no after. A container is a resource with a
lifetime — created before the first command, reused by the setup command, the
agent, and the validation command, and destroyed even when the run is aborted.
No amount of care inside a rewriter produces a lifetime.

So the boundary becomes a **session**: opened once per attempt, running any
number of commands, closed with a guarantee. The lighter provider implements the
same shape with an empty open and an empty close and behaves exactly as before.
What crosses the boundary is declared once per session in provider-independent
terms — worktree, Git metadata, package caches, agent profile, sanitized Git
configuration — and each provider derives its own mechanics: the lighter one
computes what to cut from a filesystem it inherits whole, the container one
computes what to mount into a filesystem that starts empty. The declaration being
shared is what makes "the boundary" one promise rather than two implementations
under one name, and it is what lets a single set of assertions be executed
against every provider.

**The motive for containers is platform reach, not reproducibility.** The
existing mechanism needs user namespaces, so on macOS the only working
configuration is the opt-out — which the configuration file itself describes as
safe only inside an already disposable environment. The user least equipped to
judge the risk was the one running without a boundary. LFI does not thereby take
ownership of the project's toolchain: it never has, which is why the worktree
setup command exists.

**Ownership of the image is split along that same line.** The project owns a
scaffolded Dockerfile carrying the base image and its toolchain, committed and
edited freely. LFI owns a generated layer on top: the agent user, the aligned
identity, the CLIs of the agents the configuration names, the entry point. The
upgrade problem does not get solved so much as removed — the file the user edits
contains nothing of LFI's, so LFI updates its own layer without touching it.

**Paths are identical on both sides.** A worktree's Git pointer, a package
manager's linked binaries and store references, build caches, and every absolute
path in the project's own validation output are correct only under identity.
Translation would also make the two providers behave differently on the same
task. The cost is that Windows is out of scope, because identity there is
impossible.

**Identity is aligned when the image is built**, by passing the invoking user's
identity as build arguments, with non-unique identifiers permitted so a
collision with the base image does not fail the build, and with a numeric user
directive so the image's identity can be read back and checked before a run.
Ownership is never rewritten at startup.

**Package caches are shared, by the same list the lighter provider already
shares.** That list is the project's settled statement of what is shareable and
non-secret; applying it by a different mechanism is right, and inventing a second
policy is not. It is also what makes the container provider usable at all for a
tool that runs several workers at once.

**Containers do not outlive their attempt**, and a missing prerequisite stops the
run rather than downgrading it — no fallback to a lighter provider, none to no
boundary. Building an absent image is the single thing LFI does unasked.

## Considered options

**Keeping the rewriter and hiding containers in a registry keyed by worktree** was
rejected: the signature would survive, but the lifetime would become invisible
global state, and "who destroys this container" would stop being answerable from
the code.

**One container per command** would have preserved the interface literally, and
was rejected because the setup command, the agent, and the validation command
must see one environment; a setup command that installs anything outside the
worktree would otherwise stop working silently.

**A container outliving its attempt while the task is unfinished** was attractive,
since worktrees already persist and a warm environment would make retries cheap.
It was deferred rather than refused: with a shared package cache the remaining
benefit is small, while invalidation on image and configuration changes, garbage
collection of abandoned tasks, and stopped-state handling are real obligations.
It is reconsidered if evidence shows the cache is insufficient. The comparable
tool surveyed for this decision reaches the same split from the other direction —
it reuses worktrees by explicit decision and names its containers with random
identifiers so that reuse is impossible.

**Projecting the agent's whole home directory** was rejected on parallelism before
size: several workers sharing one writable history file and session database is a
race. Declaring a profile per agent also puts the knowledge where ADR-0002 already
put everything else that differs between CLIs.

**Egress filtering and per-container resource limits** were both rejected as
belonging elsewhere: network confinement is what an agent's own sandbox layer
claims, and the parallelism setting already expresses how much machine a run may
use, more honestly than throttling each worker.

**A user-supplied prebuilt image** was rejected for this version because it
defeats both the identity check and the LFI-owned layer, making it a second mode
rather than one setting.

## Consequences

ADR-0002's claim about the interface no longer holds and should be read together
with this record. Reshaping the seam touches every caller of the boundary, and
the existing boundary test is the regression evidence: its assertions must
continue to pass unchanged for the lighter provider.

The built image is personal — it carries the builder's identity — so it cannot be
published or shared with a team. This makes the pre-run identity check mandatory
rather than a nicety: without it the failure is a permission error in the middle
of a run.

The shared package cache is a writable surface common to workers that are
otherwise isolated from one another, so a poisoned entry reaches every worker and
the host. This is not a regression, but choosing a stronger boundary must not be
mistaken for choosing this away.

The agent's credentials are inside the boundary by design and the network is
unfiltered, so a compromised agent can leak its own key. The code-host
credentials remain outside, which is the guarantee that matters and is unchanged.

Two questions are left to be answered by running rather than by argument, and
reported with the implementation: whether a package manager that hard-links from
a shared store can still do so when the store and the worktree arrive as separate
mounts of one host filesystem, and whether a shared cache reached through the
macOS file-sharing layer beats downloading again.
