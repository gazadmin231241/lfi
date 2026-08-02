Type: spec
Blocked by: None

## Problem Statement

LFI's isolation boundary exists, but it only exists on Linux. The default
provider is built on user namespaces and mount isolation, and the diagnostic
command tells a user on macOS the truth: the mechanism is missing, install it or
turn isolation off. There is nothing to install. For that user the only working
configuration is the explicit opt-out — the one the configuration file itself
describes as safe only inside an already disposable container or CI job. So the
user least able to reason about the risk is the one running unattended agents
with no boundary at all, on their own machine, with their own credentials on it.

The second problem is one the user meets the moment the first is solved. LFI runs
workers in parallel by design; a run with five eligible tasks is five worktrees
executing at once. Each one runs the project's setup command, and each one
installs the project's dependencies. If every worker is confined to an
environment of its own with nothing shared, those five installs download the
same packages five times. Confinement that costs a fivefold download on every
run is confinement people switch off, which returns them to the first problem.

Behind both sits a claim that turns out to be wrong. The existing decision record
states that the isolation interface is shaped so that a container-based
implementation can be added without changing it. It cannot. The interface is a
synchronous rewriter of one command into one command — it has no before and no
after — while a container is a resource with a lifetime that must be created
before the first command, reused by the next two, and destroyed even when the
run is aborted. The prediction was made in good faith and it did not hold.

## Solution

LFI gains a second isolation provider that runs each attempt inside a container,
so that the boundary is available on macOS as well as Linux, and so that a user
who wants a harder boundary on Linux can choose one.

**The image belongs to the project, not to LFI, but only half of it.**
Initialization scaffolds a Dockerfile into the project describing the base image
and the project's own toolchain — its language runtimes, its system libraries,
whatever the tests need. That file is the user's, committed to the repository and
edited freely. On top of it LFI builds a layer of its own, from a template that
is not in the repository: the agent user with an aligned identity, the CLIs of
the agents the configuration actually names, and the entry point. The user never
edits what LFI owns and LFI never edits what the user owns, which is what makes
upgrading LFI possible at all: a new version that needs a newer agent CLI
rebuilds its own layer and leaves the user's file untouched. This is the same
division of ownership the project already made when it decided the project, not
LFI, supplies the worktree setup command.

**The agent behaves the way the user configured it.** Each agent provider
declares which of its host configuration constitutes its profile — its settings
file, its hooks, its subagent definitions, its instructions file, its
credentials — and that profile, together with the shared skills directory, is
projected into the container's home. What is not projected is everything else
that happens to live beside it: conversation history, past sessions,
attachments, browser state, caches. On the machine this was designed against
that distinction is the difference between kilobytes and 2.2 gigabytes, but size
is not the reason. The reason is that a run puts several workers inside the
boundary at once, and a shared writable history file and session database is a
race, not an isolation mechanism.

**Paths inside the container are the paths outside it.** The worktree and the
repository's Git metadata are mounted where they already live. Nothing is
translated, because a worktree's Git pointer, a package manager's linked binaries
and store references, a build cache, and every absolute path printed by the
project's own validation command are all correct only if the path is the same on
both sides. This also keeps the two providers comparable: a task that behaves one
way under one provider and another way under the other would make the boundary
two things wearing one name.

**Package caches are shared, exactly as they already are.** The list of package
manager cache directories the existing provider makes writable is not extended or
replaced — it is the project's already-settled statement of what counts as
shareable and non-secret, and the container provider applies the same list by a
different mechanism. Five parallel workers hit one warm cache, on the first run,
because it is the user's own cache and it is already warm.

**A missing prerequisite stops the run; it never downgrades it.** If the
container runtime is unreachable, if the image does not match the user's
identity, if the user's Dockerfile changed since the image was built, or if LFI
itself was upgraded, the run stops before it starts and says which of those it
was. It does not fall back to the lighter provider and it does not fall back to
no boundary. The project already decided that an explicitly configured value
never degrades silently; a security boundary is the last place to make an
exception. The one thing LFI does without being asked is build the image when no
image exists at all, because a tool built to run unattended should not require a
separate manual step before its first run.

**The seam becomes a session.** Opening the boundary, running commands inside it,
and closing it become three things instead of one, and the lighter provider
implements the same shape with an empty open and an empty close. What crosses the
boundary is declared once per attempt, in one place, and each provider derives
its own mechanics from that declaration: the lighter provider computes what to
cut away from a filesystem it inherits whole, the container provider computes
what to mount into one that starts empty.

## User Stories

1. As a developer on macOS, I want an isolation boundary that works on my
   machine, so that running agents unattended is not a choice between no
   confinement and no LFI.
2. As a developer on Linux, I want to choose a container boundary over the
   lighter one, so that I can decide how much of my filesystem an unattended
   agent can read.
3. As a developer, I want the container boundary configured by one value in the
   configuration file, so that switching to it is a decision and not a project.
4. As a developer, I want no new configuration keys for image names, resource
   limits, or mounts, so that I am not offered combinations nobody tested.
5. As a developer, I want `lfi init` to scaffold a Dockerfile describing my
   project's toolchain, so that I have a working starting point instead of a
   blank file.
6. As a developer, I want that Dockerfile to be mine — committed, edited, and
   never rewritten by LFI — so that my project's toolchain is expressed where I
   expect it.
7. As a developer, I want the agent CLIs, the container user, and the entry point
   supplied by LFI in a layer I do not maintain, so that upgrading LFI does not
   hand me a merge conflict in my own file.
8. As a developer, I want only the agents my configuration actually names
   installed into the image, so that I am not paying build time for an agent I
   never chose.
9. As a developer, I want LFI to build the image when none exists, so that my
   first run works without a separate step I had to know about.
10. As a developer, I want that first build's output in the same log as
    everything else, with a line saying why it started, so that a long first run
    is explained rather than mysterious.
11. As a developer who edited the Dockerfile, I want the next run to stop and
    tell me the image is stale, so that I am not debugging a run that used my
    previous toolchain.
12. As a developer who upgraded LFI, I want the next run to stop and tell me the
    image predates the upgrade, so that I am not running last version's agent
    CLIs.
13. As a developer, I want LFI never to rebuild silently, so that a run's
    duration is never a surprise and never someone else's decision.
14. As a developer whose container runtime is not running, I want to be told
    before the run starts, so that I fix it once instead of watching every worker
    fail.
15. As a developer, I want `lfi doctor` to check the runtime, the image, and the
    identity match when the container provider is configured, so that a broken
    setup surfaces outside a run.
16. As a developer, I want those checks skipped entirely when I configured a
    different provider, so that the diagnostic keeps reporting only on what I
    actually use.
17. As a developer, I want LFI never to fall back to a weaker boundary, so that
    the confinement I configured is the confinement I get or the run does not
    happen.
18. As a developer on Windows, I want to be told plainly that the container
    provider is not supported there, so that I am not debugging path translation
    failures inside a tool that never claimed to work.
19. As a developer, I want my agent's settings, hooks, subagents, and
    instructions available inside the boundary, so that the agent works the way I
    configured it rather than the way a bare install does.
20. As a developer, I want my installed skills available inside the boundary, so
    that the implementation and review skills the prompts reference actually
    load.
21. As a developer, I want my agent's credentials available inside the boundary,
    so that the agent can authenticate without me building credentials into an
    image.
22. As a developer, I want my conversation history, past sessions, and
    attachments left outside the boundary, so that an unattended agent working on
    one task is not handed everything I have ever discussed with it.
23. As a developer running several workers at once, I want each of them to have
    its own copy of the agent's settings, so that parallel workers do not
    corrupt one shared history file and session database.
24. As a developer, I want the profile defined by each agent rather than by a
    single hardcoded list, so that a second agent's configuration is projected
    correctly instead of approximately.
25. As a developer whose hook calls a tool that is not in the image, I want a
    legible failure, so that I know to add the tool rather than wonder why the
    agent behaves differently.
26. As a developer, I want my worktree mounted at the path it already has, so
    that Git's own pointers between the worktree and the repository resolve
    without patching.
27. As a developer, I want absolute paths in installed packages, build caches,
    and validation output to be the paths on my machine, so that nothing has to
    be translated back before I can read it.
28. As a developer, I want the container's home directory to be the container's
    own, so that the boundary around my personal home directory is a boundary and
    not a mount.
29. As a developer, I want my package manager caches shared with the container,
    so that five parallel workers do not download the same dependencies five
    times.
30. As a developer, I want the same set of caches shared as the lighter provider
    already shares, so that switching provider does not change how long a run
    takes.
31. As a developer, I want files the container writes into those caches to belong
    to me, so that my next install outside LFI does not fail on permissions.
32. As a developer, I want the container's user identity aligned with mine when
    the image is built, so that ownership is right without anything being
    rewritten at startup.
33. As a developer whose identity does not match the image, I want to be told
    which identity the image was built for and how to rebuild, so that the
    failure names its own remedy.
34. As a developer, I want network access inside the boundary, so that dependency
    installation and the agent's own API calls keep working.
35. As a developer, I want the setup command, the agent, and the validation
    command to run in one environment, so that what setup installed outside the
    worktree is still there when the tests run.
36. As a developer, I want that environment destroyed when the attempt ends, so
    that confinement does not accumulate on my disk.
37. As a developer who aborts a run, I want its containers removed anyway, so
    that Ctrl-C does not leave me cleaning up by hand.
38. As a developer, I want any container LFI left behind to be identifiable as
    LFI's, so that I can find and remove it without guessing.
39. As a developer, I want my code-host credentials outside the boundary under
    this provider too, so that the guarantee does not depend on which provider I
    chose.
40. As a developer, I want the same boundary assertions verified against both
    providers, so that "the boundary" is one promise rather than two
    implementations sharing a name.
41. As a developer, I want the merger and the integration worktree confined the
    same way as workers, so that the last thing to touch my code before delivery
    is not the least confined.
42. As a developer with an existing project on the lighter provider, I want
    nothing about my configuration or behaviour to change, so that this work is
    an addition rather than an upgrade I have to survive.

## Implementation Decisions

**Isolation session.** The isolation seam changes shape from a command rewriter
to a session: it is opened once, runs any number of commands, and is closed. The
session's lifetime is one attempt, which is the unit the domain already defines
as a worker's complete effort at a task; the integration step and the merger open
their own. Closing is guaranteed on abnormal termination as well as normal
completion. The lighter provider implements the same shape with an empty open and
an empty close, and its per-command behaviour is unchanged. This supersedes the
existing decision record's expectation that a container implementation would fit
the previous interface; a new record states why the prediction failed.

**Boundary declaration.** What crosses the boundary is declared once per session,
in provider-independent terms: the task's worktree, the repository's Git
metadata, the package manager cache directories, the agent's profile, and the
sanitized Git configuration. Each provider derives its own mechanics from that
one declaration — the lighter provider computes what to remove from a filesystem
it inherits whole, the container provider computes what to mount into one that
starts empty. The current configuration structure, which enumerates credential
directories and files to cut away, is specific to the first mechanism and is
replaced by this declaration; the lighter provider derives that list from it and
keeps its present behaviour exactly.

**Environment construction** becomes part of the same provider-owned derivation.
The lighter provider inherits a filtered host environment as it does today; the
container provider takes its path and home from the image and supplies the
agent's own variables and the Git identity. The set of variables that may cross
the boundary is declared once and shared.

**Agent profile.** Each agent provider declares the host paths that constitute
its configuration — the settings file, hooks, subagent definitions, instructions
file, and credentials for that CLI — and the shared skills directory is declared
once for all agents. The isolation session projects the declared paths into the
container's home as private copies, so that parallel sessions cannot interfere
with each other or write back to the host. Nothing outside the declared profile
crosses the boundary; history, sessions, attachments, and caches do not.
Projection failures are reported as such rather than silently producing a
differently configured agent.

**Path identity.** Mounted paths are identical on both sides. No path translation
is performed anywhere. The container's home directory is the image's own and is
not the user's; nothing in the boundary declaration depends on the two being the
same.

**Container lifetime.** One container per session, named deterministically from
the run and the task, labelled as LFI's, started on open and removed on close.
Containers do not survive a run. The alternative — keeping a container alive
while its task remains unfinished, to preserve a warm environment between
attempts — is deliberately not taken in this work; the shared package cache
removes most of its benefit, and it introduces invalidation, garbage collection,
and stopped-state handling that are not worth buying before the need is
demonstrated. Orphans left by abnormal termination are removed by label at the
start and end of every run, and are reported by the diagnostic command.

**Worker image.** Two layers. The lower is scaffolded into the project at
initialization, is owned and committed by the user, and carries the base image
and the project's toolchain; it must end as the image's root user so that the
upper layer can create the agent user. The upper is generated by LFI from a
template that does not live in the repository, and carries the agent user with an
aligned identity, a numeric user directive, the CLIs of the agents the
configuration names, and the entry point. The image tag is derived from the
project; no configuration key names it.

**Identity alignment** happens at build time, by passing the invoking user's
identity as build arguments and applying it to the image's existing user, with
non-unique identifiers permitted so that an identifier already present in the
base image does not fail the build. The user directive is numeric so that the
image's identity can be read back. Runtime rewriting of ownership is not used.

**Image freshness.** Before a run, LFI compares the built image against the
user's Dockerfile, the LFI version, and the invoking identity. A mismatch stops
the run with a message naming which of them diverged and the command that
rebuilds. An absent image is the only case LFI resolves itself, by building; the
build streams into the run log with a line stating why it began.

**Prerequisites and refusal.** When the container provider is configured, the run
verifies the runtime and the image before any work begins, and stops if either is
unusable. There is no fallback to another provider under any failure. The
provider is unavailable on Windows and says so by name rather than failing later
on a path that cannot exist.

**Network.** Ordinary outbound network access, unfiltered, matching the lighter
provider. Egress filtering is not attempted; the boundary LFI owns is a
filesystem and credential boundary, and network confinement is what an agent's
own sandbox layer claims. The provider's network is expressible internally so
that a future option needs no change of shape.

**Resource limits** are not introduced. The existing parallelism setting already
expresses how much of the machine a run may use, and it does so more honestly
than throttling each worker.

**Diagnostics.** The diagnostic command derives its checks from the
configuration, as it already does for agents and for the lighter provider's
mechanism: with the container provider configured it checks that the runtime
responds, that the image exists and is fresh, that its identity matches, and that
no orphaned containers remain. On Windows it reports the provider as
unsupported.

**Configuration.** One new accepted value for the existing isolation setting. No
other key is added. The generated configuration file's comment for that setting
gains a line describing when the container provider is the right choice, in both
supported languages.

**Initialization** additionally offers the container provider and scaffolds the
user's Dockerfile when it is chosen. The scaffold carries comments stating that
the file is the user's, that it must end as root, and that the agent tooling is
supplied by LFI.

## Testing Decisions

A good test here drives an exported seam with real input and asserts on
observable output — the declaration a session produces, the command that would be
executed, the arguments a build would receive, the reported diagnosis, the state
of the filesystem after a real boundary ran — and never on how the code reached
it. Most of this work is decision logic and should not need a container to test;
the part that genuinely requires one is small, sharply bounded, and skipped when
no runtime is present, following the platform-skip pattern the existing boundary
test already uses.

Five seams carry this work; two are new, three exist.

- **Isolation session** — the reshaped existing seam, and the highest one
  available: every command that runs inside the boundary passes through it, for
  both providers and for workers, merger, integration, setup, and validation
  alike. Tests drive it with a fake runtime executable on the path and assert on
  the commands it would issue for open, run, and close, including that close
  happens after a failed run and after an abort. Prior art: the existing tests
  that place fake executables on the path and assert on the resulting command.
- **Boundary declaration** — new, pure. Given a worktree, a repository, a home
  directory, and an agent, it returns what crosses the boundary. Tests assert
  that the worktree, Git metadata, package caches, agent profile, and skills are
  included; that history, sessions, attachments, and code-host credentials are
  not; and that the lighter provider's cut-away list derived from it matches what
  that provider produces today. This seam is where the two providers are proven
  to be one boundary.
- **Worker image** — new. Covers tag derivation, the generated upper layer for a
  given set of configured agents, the build arguments carrying the invoking
  identity, and the freshness comparison against Dockerfile, version, and
  identity. Tests assert on the arguments a build would receive and on the
  verdict of a freshness check for each way it can diverge, using a fake runtime
  executable rather than building anything.
- **Diagnostics** — existing. Tests assert which checks are required for a
  configuration naming the container provider, that they are absent for one that
  does not, and that the Windows case reports unsupported. Prior art: the
  existing diagnostic tests, which already derive required checks from
  configuration.
- **Configuration and initialization** — existing. Tests cover accepting and
  rejecting the isolation value, the generated comment in both languages, and
  the scaffolded Dockerfile's presence and ownership notice. Prior art: the
  existing configuration and log tests.

The boundary assertions themselves — the worktree is writable, Git metadata is
writable, a file outside the worktree is unreachable, code-host credentials are
unreachable, the network is reachable — are written once and executed against
every available provider, so that adding a provider means answering the same
questions rather than writing new ones. The existing boundary test is the
starting point and its assertions must continue to pass unchanged for the
lighter provider; that is the regression evidence for reshaping the seam.

Two questions cannot be settled by testing logic and must be answered by running
the real thing during implementation, and reported with the work: whether a
package manager that links from a shared store can still hard-link when the store
and the worktree arrive as two separate mounts of the same host filesystem, and
whether a shared cache reached through the macOS file-sharing layer is actually
faster than downloading again. If either answer is unfavourable it changes what
the cache decision buys, and that must be visible rather than assumed.

## Out of Scope

- Windows support for the container provider, and therefore any path translation
  between host and container.
- A container that outlives its attempt to keep a warm environment between
  attempts. Recorded as a reconsideration, gated on evidence that the shared
  cache is insufficient.
- Configuring a prebuilt image the user brings themselves. It defeats both the
  identity check and the LFI-owned layer, so it is a second mode rather than one
  setting.
- Egress filtering, network allowlists, and proxying.
- Resource limits per container.
- Additional mounts configurable by the user.
- Publishing, sharing, or registry distribution of the built image. The image is
  personal by construction, because it carries the builder's identity.
- Any change to which agents exist, how tiers route work, how completion is
  declared, or how acceptance is decided.
- Any change to the tracker, the skills bundle, the worktree lifecycle,
  integration, or delivery.
- Removing or deprecating the lighter provider or the opt-out.

## Further Notes

This work corrects a stated expectation rather than merely extending it. The
existing decision record claims the isolation interface was shaped to accept a
container implementation unchanged; it was not, because a container has a
lifetime and the interface had none. The correction is recorded as its own
decision so that the reader of the earlier record is not left believing a
prediction that failed.

The design was checked against a comparable tool that runs containers behind a
sandbox abstraction, and three of its conclusions are adopted with its evidence:
scaffold a Dockerfile the user owns rather than abstracting image composition;
align identity at build time rather than rewriting ownership at startup, which
that project tried and removed for being slow and failing on read-only mounts;
and make the container disposable while the worktree persists, which it enforces
by naming containers unpredictably. Two of its conclusions are rejected for
reasons specific to LFI. It translates paths because it supports Windows and
remote sandboxes and has no choice; LFI has a choice and keeps paths identical.
And it shares no package cache between parallel sandboxes, which is acceptable
for a library invoked once and unacceptable for a tool whose defining behaviour
is running several workers at once.

One trade-off is accepted openly. The shared package cache is a writable surface
common to workers that are otherwise isolated from each other, so a poisoned
cache entry reaches every worker and the host. This is not a regression — the
lighter provider shares the same caches today — but the container provider does
not fix it either, and choosing a stronger boundary should not be mistaken for
choosing this one away.

A second is accepted for the same reason: the agent's credentials are inside the
boundary by design, since the agent must authenticate, and network access is
unfiltered. A compromised agent can therefore leak its own key. The code-host
credentials that would let it publish are still outside, which is the guarantee
that actually matters, and it is unchanged.
