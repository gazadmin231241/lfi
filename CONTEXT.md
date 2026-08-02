# LFI

LFI turns local Markdown tasks into reviewed, validated commits by running
coding agents unattended in isolated Git worktrees. This glossary fixes the
vocabulary those documents, prompts, and modules share.

The agent and isolation terms were settled in LFI-13 and are not yet reflected
everywhere in the code; where the code still says otherwise, the code is the
thing that is out of date.

## Tracker

**Tracker document**:
A Markdown file in the tracker that carries one unit of thinking or work. Its
kind, status, and identifier are all visible without opening it.
_Avoid_: note, card, file

**Specification**:
A tracker document describing a problem and its solution from the user's
perspective. Never executable.
_Avoid_: PRD, design doc, story

**Task**:
The only executable kind of tracker document: one piece of work an agent can be
handed and finish.
_Avoid_: issue, ticket, story

**Execution tier**:
The judgment a task demands and the cost of getting it wrong, expressed as
`light`, `standard`, or `deep`. It is a property of the work, deliberately
independent of any model or price.
_Avoid_: complexity, difficulty, priority, model tier

**Blocking**:
A declared dependency of one tracker document on another that is not yet
complete. A blocked task is never handed to an agent.
_Avoid_: dependency, prerequisite

## Execution

**Run**:
One invocation of LFI that carries eligible tasks from the tracker through to
validated code on the default branch.
_Avoid_: job, batch, session

**Stage**:
One round within a run, in which a bounded number of workers execute in
parallel.
_Avoid_: iteration, pass, cycle

**Worker**:
The role that implements a single task in its own worktree and reviews its own
work. One worker serves one task.
_Avoid_: agent, bot, runner

**Attempt**:
One worker's complete effort at a task, ending in acceptance or rejection.
A rejected attempt leaves its worktree in place for a later one.
_Avoid_: try, execution, invocation

**Merger**:
The role that resolves conflicts between accepted branches and repairs
validation failures. Configured independently of any tier, because it answers a
different kind of question than implementation does.
_Avoid_: resolver, integrator, conflict agent

**Integration**:
Combining accepted branches into one branch and validating the result, before
anything reaches the default branch.
_Avoid_: merge, assembly

**Validation**:
The project's own command that decides whether combined work is sound. LFI
supplies the command's context, never its criteria.
_Avoid_: CI, checks, tests

## Agents and confinement

**Agent provider**:
The coding-agent CLI that executes a piece of work, and the sole owner of
everything that differs between such CLIs. Currently Codex or Pi.
_Avoid_: agent (unqualified), backend, vendor, model provider

**Isolation provider**:
The boundary LFI applies itself to confine anything a task causes to run — the
agent, the validation command, the setup command. Distinct from any sandbox an
agent brings of its own.
_Avoid_: sandbox (unqualified), container, jail

**Completion block**:
The tagged block an agent emits to declare whether it finished and what it did.
The single agent-independent signal on which acceptance depends.
_Avoid_: structured output, output schema, result JSON, final message

**Acceptance**:
The host's judgment that an attempt succeeded, made from observable facts about
the process and the worktree rather than from the agent's own claim alone.
_Avoid_: success, pass, approval

**Skill**:
A named, self-contained instruction package an agent loads on demand — the unit
in which LFI expresses how work should be done. Referenced in prompts
independently of any one agent's invocation syntax.
_Avoid_: command, plugin, tool
