Type: spec
Blocked by: None

## Problem Statement

A user runs LFI against exactly one coding agent: Codex. Every execution tier,
the merger role, the environment checks, the prompts, and the result contract
are written against that one CLI. A user who wants a different agent for some of
the work — a cheaper model from a different provider for mechanical tasks, a
different vendor's subscription for deep work — cannot express that at all.

This matters most at the tier boundary LFI already has. Execution tiers exist
precisely because work differs in required judgment and cost of error, and the
routing decision already accepts that different tiers deserve different models.
But the tier maps to a model name inside a single agent, so the cheapest
available option is bounded by what that one agent's provider offers. The user's
actual question — "this task is mechanical, run it somewhere cheap" — has no
answer when the cheap thing lives behind a different CLI.

Behind that lies a second problem the user cannot see until they hit it. LFI's
safety story is inherited, not owned. Workers run unattended, in parallel,
writing code and running arbitrary shell commands, and the only thing standing
between that and the user's machine is the agent's own sandbox. LFI states this
outright: Git metadata is read-only *because Codex makes it so*, and therefore
the host commits. Any agent without an equivalent sandbox cannot be added
without silently dropping that protection. And the protection was never complete
anyway: the project's validation and worktree-setup commands — which run the
code the agent just wrote, including package installation with its install
scripts — are executed by the host with no restriction at all, today, with
Codex.

So the user faces one request that cannot be granted and one guarantee that does
not hold where they assume it does.

## Solution

LFI stops being a Codex orchestrator and becomes an orchestrator that runs
agents, with two things made explicit that were previously implicit: which agent
runs a piece of work, and what confines it while it runs.

**The agent becomes part of the tier mapping.** Each execution tier, and the
merger role independently, resolves to a pair of an agent and a model rather
than a model alone. This extends the existing routing decision along the axis it
already established: tiers exist to route work by judgment required, and the
agent is now part of what a tier selects. A user who wants mechanical work run
cheaply elsewhere writes that on one line.

The pairing is written as a prefix on the model value the user already
configures, so nothing new appears in the configuration file and an unprefixed
value continues to mean Codex. Existing projects keep working untouched. The
model name itself is whatever the user copied out of their agent — LFI does not
know, validate, or maintain a catalogue of model names for any agent, because
that catalogue changes weekly and belongs to the agent, not to LFI.

**Confinement becomes LFI's own, and covers everything the task produces.**
LFI gains an isolation provider: a boundary it applies itself, to every agent it
runs and to the project's validation and setup commands. This closes the gap
that exists today — the code an agent just wrote is executed by the host — and
it makes agents comparable, because the guarantee no longer depends on which
agent happens to have the better sandbox. Where an agent has its own sandbox, it
keeps it; the two layers do not conflict, and the one that already works is not
switched off for the sake of symmetry.

Inside that boundary the model of work changes to match what the boundary makes
possible. Git metadata is writable and **the agent commits its own work**; the
host reads the resulting commits. This is the opposite of today's arrangement,
and it is deliberate: the old arrangement existed as a consequence of one
agent's sandbox choice, not as a considered design, and it forced LFI to
manufacture a single commit message on the agent's behalf. With the agent
committing, work arrives as the agent chose to structure it, and the acceptance
rules that already exist — successful exit, an explicit completion status,
commits ahead of the base, a clean worktree — carry the same weight as before.

**One result contract for every agent.** The completion signal moves off
Codex's provider-enforced output schema and onto a tagged block that the agent
emits into its output, extracted from the last occurrence, tolerant of
formatting. This is the approach the comparable tool in this space settled on
after supporting five agents, and it is chosen here for the same reason: an
agent-independent contract is worth more than a provider-enforced one that only
one agent can honour. The cost is accepted openly — the contract now depends on
the agent following instructions rather than on the provider rejecting invalid
output.

**Skill references become agent-independent.** Prompts refer to skills through a
placeholder that each agent expands into its own invocation syntax, because the
syntax genuinely differs and a prompt written for one agent silently does
nothing on the other — silently meaning the mandatory code review simply never
happens. A prompt template still carrying the old direct syntax is rejected with
an instruction to update it, rather than run.

## User Stories

1. As a developer with mechanical and demanding work in one backlog, I want each
   execution tier to select an agent as well as a model, so that cheap work runs
   cheaply without me routing tasks by hand.
2. As a developer, I want the merger role to select its own agent and model
   independently of the tiers, so that conflict resolution and validation repair
   can stay on the agent I trust most.
3. As a developer, I want the agent written as a prefix on the model value I
   already configure, so that no new configuration concept appears for a choice
   I make once.
4. As a developer with an existing project, I want an unprefixed model value to
   keep meaning Codex, so that upgrading LFI requires no edit to my
   configuration.
5. As a developer, I want to copy a model name out of my agent's own model
   picker and paste it into the configuration, so that I am not limited to names
   LFI happens to know about.
6. As a developer, I want LFI not to validate model names against any catalogue,
   so that a model released today is usable today.
7. As a developer, I want a model my agent rejects to be reported as such rather
   than silently substituted, so that I learn my configuration is wrong instead
   of paying for something I did not ask for.
8. As a developer, I want other tasks routed to a model that has proven
   unavailable to be skipped for the rest of the run, so that one bad
   configuration value does not burn every task in the queue.
9. As a developer running a mixed configuration, I want a model to be considered
   unavailable only for the agent that rejected it, so that the same model name
   under a different agent is still attempted.
10. As a developer, I want the configuration keys that name Codex renamed to
    agent-neutral names, so that my configuration does not read as a lie when it
    points at a different agent.
11. As a developer with an existing project, I want the old key names still
    honoured as deprecated aliases, so that nothing breaks before I get around
    to updating them.
12. As a developer, I want a single project-wide reasoning level to keep
    applying to workers, so that the routing decision that tiers select only the
    model is not quietly reversed.
13. As a developer, I want a reasoning level that some configured agent cannot
    honour to be rejected before the run starts, so that I fix the configuration
    instead of discovering it mid-run.
14. As a developer, I want that rejection to name which agent cannot honour the
    value, so that I know whether to change the level or the agent.
15. As a developer, I want every agent to report completion through the same
    contract, so that acceptance means the same thing regardless of which agent
    did the work.
16. As a developer, I want the completion block extracted from the last
    occurrence in the agent's output and tolerant of surrounding formatting, so
    that a conversational agent that wraps its answer still produces a valid
    result.
17. As a developer, I want an agent that produced no valid completion block to
    be treated as not completed, so that a malformed result is never mistaken
    for success.
18. As a developer, I want a prompt template that does not instruct the agent to
    emit the completion block to fail at the start of the run, so that I do not
    watch a full run produce an unusable result.
19. As a developer, I want prompts to reference skills through an
    agent-independent placeholder, so that one template works with every agent.
20. As a developer, I want the placeholder expanded into each agent's own
    invocation syntax, so that the mandatory implementation and review skills
    actually load.
21. As a developer with a prompt template written in the old direct syntax, I
    want the run to stop with an instruction to update it, so that I am not
    handed a run that quietly skipped code review.
22. As a developer, I want every agent LFI runs to be confined by an isolation
    boundary LFI applies itself, so that the guarantee does not depend on which
    agent I chose.
23. As a developer, I want an agent that has its own sandbox to keep it inside
    that boundary, so that adding a second layer does not cost me the layer that
    already works.
24. As a developer, I want the project's validation and worktree-setup commands
    run inside the same boundary, so that the code an agent just wrote is not
    executed unconfined on my machine.
25. As a developer, I want package installation and test execution to keep
    working inside the boundary, so that confinement does not cost me the
    workflow it protects.
26. As a developer, I want my credentials for the code host kept outside the
    boundary, so that an agent cannot reach the account that publishes my work —
    which it never needed, because the host publishes.
27. As a developer, I want network access to remain available inside the
    boundary, so that dependency installation and the agent's own API calls keep
    working.
28. As a developer, I want the agent to create its own commits inside the
    boundary, so that work arrives structured as the agent saw fit rather than
    squashed under a message LFI invented.
29. As a developer, I want the existing acceptance rules to keep deciding
    whether an attempt succeeded, so that the change in who commits does not
    change what counts as done.
30. As a developer, I want the prompt instructions that forbid committing
    replaced by instructions that require it, so that the agent is not told the
    opposite of what the system now expects.
31. As a developer on a machine without the isolation mechanism, I want to be
    told before the run rather than during it, so that I can fix the environment
    first.
32. As a developer who is already inside a container or a disposable CI job, I
    want to declare that no further isolation is needed, so that I am not forced
    to nest confinement I already have.
33. As a developer, I want `lfi doctor` to check only the agents my
    configuration actually names, so that I am not told to install and log into
    an agent I never chose.
34. As a developer, I want `lfi doctor` to check the isolation mechanism when
    isolation is enabled, so that a missing prerequisite surfaces before a run.
35. As a developer, I want the Codex-specific skill metadata check to apply only
    when Codex is configured, so that a project running only the other agent is
    not marked unhealthy for a file it does not need.
36. As a developer, I want `lfi doctor` never to print or log agent
    credentials, so that running a diagnostic command is never a disclosure.
37. As a developer, I want `lfi init` to keep offering the model preset it
    offers today, so that the common path is unchanged for people who are happy
    with Codex.
38. As a developer, I want to configure the second agent by editing the
    configuration directly, so that LFI does not maintain a recommendation list
    for a catalogue of models it does not own.
39. As a developer, I want skill installation unchanged, so that the skills I
    already have keep serving both agents.
40. As a developer reading the logs, I want to see which agent ran each task, so
    that I can attribute a bad result to the routing I chose.
41. As a developer, I want agent errors surfaced in the task summary regardless
    of which stream the agent wrote them to, so that an authentication or rate
    limit failure is legible instead of appearing as an empty result.

## Implementation Decisions

**Agent provider.** A new domain concept: the agent provider is the CLI that
executes a piece of work — currently Codex or Pi. It owns everything that
differs between agents: how a command is built, how its event stream is read,
how its output yields the structured result, how a skill reference is written,
which reasoning levels it accepts, and how an unavailable-model error is
recognised in its output. Nothing outside the provider branches on which agent
is in use.

**Tier resolution.** Each execution tier and the merger role resolve to a pair
of agent provider and model. The routing decision recorded in the existing ADR
is extended along the axis it established: a tier selects an agent and a model,
not a model alone. Everything else in that decision is retained — tiers do not
raise reasoning effort, an explicitly configured value never degrades silently,
and a rejected model skips other tasks mapped to it. Unavailability is now keyed
by the pair, so the same model name under a different agent is still attempted.

**Configuration format.** The agent is a prefix on the existing model value,
separated from the model by the first colon; the remainder is passed to the
agent verbatim, including any provider and thinking syntax the agent itself
defines. An unprefixed value means Codex, which makes every existing
configuration valid without migration. LFI performs no validation of the model
portion and consults no model catalogue.

**Key naming.** The two configuration keys that name Codex become agent-neutral.
The former names are read as deprecated aliases and replaced by the canonical
names the next time LFI writes the configuration.

**Reasoning level.** Remains one project-wide value for workers, and a separate
one for the merger, as the routing ADR requires. The accepted vocabulary differs
per agent; configuration loading validates the value against the vocabularies of
the agents actually named in the configuration and fails before the run with a
message naming the offending agent. Values no configured agent accepts are an
error, not a downgrade.

**Result contract.** One contract for all agents: the agent emits a tagged block
containing the completion status and summary; LFI extracts the last occurrence,
tolerates surrounding formatting including code fences, parses it, and validates
its shape. Codex's provider-enforced output schema is no longer used. Absence of
a valid block yields a non-completed status, which the existing acceptance rules
already reject. Before starting a run, LFI verifies that the prompt actually
instructs the agent to emit the block and fails immediately if it does not. No
retry mechanism is introduced; a failed extraction is a failed attempt, handled
by the existing retry-the-task path.

**Skill references in prompts.** Prompts reference skills through a placeholder
resolved by the agent provider into that agent's invocation syntax, joining the
placeholders the prompt template already supports. Built-in prompts in both
languages are rewritten to use it. A template containing the old direct syntax
for a skill that is installed is rejected at load with an instruction naming the
replacement, because the failure it would otherwise produce is a run that
skipped its mandatory review without saying so.

**Isolation provider.** A second new domain concept, independent of the agent
provider: the isolation provider confines a command to a boundary LFI defines.
Two implementations ship: a lightweight local mechanism using user namespaces
and mount isolation, which is the default; and an explicit opt-out for
environments that are already disposable. The interface is designed so that a
container-based implementation can be added later without changing it, which
means it must carry line-by-line output streaming, idle-timeout support, and
delivery of a long prompt through standard input rather than as an argument.

**Isolation boundary.** The filesystem is read-only except for the task's
worktree, the repository's Git metadata, a temporary filesystem, and the caches
required by package managers. Credentials for the code host are not exposed
inside the boundary — the host publishes results, so no agent needs them.
Network access remains available. The boundary applies to every agent LFI runs,
to the merger role, to the integration worktree, and to the project's validation
and worktree-setup commands.

**Layered sandboxes.** An agent that provides its own sandbox keeps it, running
inside LFI's boundary. The layers are not mutually exclusive and the working one
is not disabled for symmetry. One adjustment is required rather than optional:
an agent whose sandbox makes Git metadata read-only must be run so that it does
not, because the commit model below requires the agent to commit. That agent's
sandbox continues to protect everything else, and LFI's boundary now covers what
it stops covering.

**Commit model.** Git metadata is writable inside the boundary and the agent
commits its own work; LFI no longer stages or commits on the agent's behalf, and
no longer composes a commit message for it. Prompt instructions that forbade
committing are inverted. Acceptance is unchanged: successful exit, an explicit
completion status, at least one commit ahead of the base, and a clean worktree.
No additional history-integrity check is introduced; the risk that an agent
rewrites its own branch history is accepted, mitigated by the branch being
disposable, by the absence of publishing credentials inside the boundary, and by
the integration step operating on the branch as it finds it.

**Environment checks.** The diagnostic command's required checks are derived
from the configuration: an agent is checked only when some tier or the merger
names it; the isolation mechanism is checked when isolation is enabled; the
Codex-specific skill metadata requirement applies only when Codex is
configured. Version control and code-host checks remain unconditional. Agent
authentication is checked only to the extent it can be done without invoking a
credential-printing command, because the diagnostic output is shown to the user
and credentials must never appear in it; for an agent offering no
credential-free status command, presence on the path is the check.

**Initialization.** Unchanged. The existing model preset remains the offered
default and is expressed in the unprefixed form, which continues to mean Codex.
No preset is invented for the second agent, because its model catalogue spans
many providers whose availability depends on the user's own subscriptions. The
non-interactive model option accepts a prefixed value.

**Skill installation.** Unchanged. The installed skills are already compatible
with both agents; the Codex-specific metadata file that accompanies each skill
is simply ignored by the other agent.

**Error surfacing.** One agent reports authentication, rate limit, and API
failures as events on standard output rather than on the error stream. The
agent provider is responsible for recognising these and contributing them to the
task summary, so that acceptance failures are legible rather than empty.

## Testing Decisions

A good test here drives an exported seam with real input and asserts on
observable output — the command that would be executed, the parsed result, the
loaded configuration, the rendered prompt, the documents on disk — and never on
how the code arrived there. The bulk of this work is decision logic, not
input/output, so the bulk of the tests should not need processes or a
filesystem.

Seven seams carry this work; three are new and are deliberately pure functions,
four already exist.

- **Agent execution** — the existing single point at which an agent is run,
  generalised from Codex to any agent. This remains the only place a process is
  spawned for agent work. Tests drive it against fake agent executables placed on
  the path, asserting on the streamed log content, the captured summary, and the
  reported status for both agents. Prior art: the existing agent-output test,
  which already builds a fake executable and asserts on the log it produces.
- **Command construction** — new, pure. Given an agent, a model, a reasoning
  level, and a prompt, it returns the command, its arguments, and the input to
  be written to the process. Tests assert the shape of the command per agent
  without spawning anything, including that the model portion is passed through
  untouched and that reasoning maps to each agent's own option.
- **Result extraction** — new, pure. Given the agent's output, it returns the
  completion status and summary or reports a contract failure. Tests cover the
  last-occurrence rule, surrounding prose, code fences, malformed content, and
  complete absence of the block. This seam carries most of the risk of the
  contract change and deserves the densest tests in the work.
- **Isolation wrapping** — new, pure. Given a command and an isolation
  configuration, it returns the command that actually runs. Tests assert that
  the worktree is writable, that the rest of the filesystem is not, that
  host credentials are absent, that network access is retained, and that the
  opt-out returns the command unchanged. An end-to-end test with a fake
  isolation executable on the path asserts that agent execution and the
  project's validation and setup commands both pass through it.
- **Configuration** — existing. Tests cover prefix parsing, the unprefixed
  default, deprecated key aliases and their rewriting, reasoning validation
  against the agents named in the configuration, and tier resolution to an
  agent-and-model pair. Prior art: the existing configuration and model-routing
  tests, which already assert on parsed values and tier resolution.
- **Prompt rendering** — existing. Tests cover placeholder expansion per agent
  and rejection of a template carrying the old direct syntax. Prior art: the
  existing prompt tests.
- **Environment checks** — existing. Tests cover which checks are required for a
  given configuration and assert that no check output containing a credential is
  ever placed in the reported detail. Prior art: the existing diagnostic tests.

Model-routing tests are retained and extended rather than replaced: routing
behaviour by tier must not change, and those tests are the evidence. Tests
asserting that the host creates the worker's commit are removed with the
behaviour they cover, and replaced by tests asserting acceptance of an attempt
whose commits the agent made.

The isolation boundary itself cannot be fully settled by reasoning: whether a
worktree's Git pointer resolves inside the boundary, and whether package
installation and the test suite still work under it, must be established by
running them. That verification belongs in the implementation work, not in the
unit tests, and is called out as such.

## Out of Scope

- A container-based isolation implementation. The interface is designed to
  accept one; none is built. Systems without the local mechanism have the
  explicit opt-out and the agents' own sandboxes.
- Any isolation mechanism for platforms without user namespaces. The
  consequence is stated plainly rather than papered over.
- Retrying a failed result extraction by resuming the agent's session. LFI has
  no concept of an agent session, and introducing one to support a retry is a
  larger change than the contract it would protect.
- Session capture, resumption, or forking for any agent.
- Per-task agent selection. The agent is chosen by tier and by role, not written
  on individual task documents; an agent is infrastructure, not a property of
  the work.
- A recommended model preset for the second agent, and any form of model
  catalogue, validation, or discovery.
- Changing which judgment a tier expresses or how a tier is assigned. Only what
  a tier resolves to changes.
- Cost accounting, price calculation, or automatic escalation between agents.
- Additional integrity checks on the branch history an agent produces.
- Changing branch naming, worktree lifecycle, integration, or delivery.
- Changing the tracker, its documents, or the skills bundle.

## Further Notes

This work reverses one sentence of the existing routing ADR — that the first
version stays on the Codex execution boundary — and extends the rest of it. It
also replaces the reasoning behind the current commit arrangement: the host
committed because one agent's sandbox made Git metadata read-only, and with
LFI owning the boundary that constraint is LFI's to choose. It chose the
opposite.

Two decisions here are deliberate losses, recorded so that a later reader does
not mistake them for oversights. Dropping the provider-enforced output schema
trades a guarantee that one agent could offer for a contract every agent can
honour. Letting the agent commit trades a structural protection against history
rewriting for a working arrangement across agents; the mitigations are that the
branch is disposable and that nothing inside the boundary can publish.

The design draws directly on a comparable tool that already runs five agents
behind one interface. Three of its conclusions are adopted: separate the agent
abstraction from the isolation abstraction, use a tagged block rather than
provider-specific structured output, and fail at the start of a run when the
prompt does not satisfy the contract. One is rejected: that tool requires a
container, which suits a library embedded in other programs but not a CLI whose
current prerequisites are version control, a code-host client, and an agent.
