# Execution Routing

This context defines how LFI describes and resolves the capability required to
execute a task without coupling tasks to a particular model generation or
provider.

## Language

**Execution tier**:
A model-independent capability and cost class assigned to a task when the task
is created. Its canonical values are `light`, `standard`, and `deep`.
_Avoid_: Model label, model tier, difficulty

**Tier assignment**:
The execution tier proposed by the task-creation agent using the project's
routing rubric. A user may override it before task execution; LFI does not
change it during execution or retries.
_Avoid_: Model selection, automatic routing

**Tier mapping**:
The project configuration that resolves each execution tier to a concrete
model. It does not determine reasoning effort.
_Avoid_: Task model, hard-coded model

**Reasoning policy**:
The project-level reasoning effort applied to workers independently of their
execution tiers. LFI preserves the user-configured value across execution and
retries; integration work may use a separate project-level setting.
_Avoid_: Task reasoning, tier reasoning

**Integration model**:
The project-configured model used for merge-conflict resolution and validation
repair independently of task execution tiers. When not configured explicitly,
it resolves through the standard tier mapping before legacy fallbacks.
_Avoid_: Merger tier, highest task model
