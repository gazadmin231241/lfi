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

**Model binding**:
One configured place that names an agent provider, a model, and a reasoning
effort together. A binding may name none of them, in which case it resolves
through another binding. The six bindings are the fallback, the three execution
tiers, integration, and review.
_Avoid_: Slot, model setting, profile

**Tier mapping**:
The three model bindings that resolve `light`, `standard`, and `deep` to a
concrete model.
_Avoid_: Task model, hard-coded model

**Reasoning policy**:
The reasoning effort a model binding carries, alongside the agent and model it
names. LFI preserves the user-configured value across execution and retries.
Every binding carries its own; nothing forces the three tiers to agree.
_Avoid_: Task reasoning, project reasoning

**Integration model**:
The project-configured model used for merge-conflict resolution and validation
repair independently of task execution tiers. When not configured explicitly,
it resolves through the standard tier mapping before legacy fallbacks.
_Avoid_: Merger tier, highest task model
