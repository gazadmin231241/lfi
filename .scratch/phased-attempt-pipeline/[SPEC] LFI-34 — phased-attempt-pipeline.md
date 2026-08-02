# LFI-34 — Phased attempt pipeline

Type: spec
Blocked by: None

## Problem Statement

Today a single worker session carries the whole delivery protocol: the task
prompt tells one agent to implement, then invoke code review on its own work,
then apply a confirmation matrix, then run validation — all inside one
conversation. This has two failure modes the operator feels directly:

1. The protocol depends on provider-specific subagent mechanics. The
   code-review skill spawns parallel reviewer subagents, and the constraints
   even carry a codex-only note about full-history forks. Moving the worker to
   the pi agent provider breaks the assumption that the provider's subagent
   machinery matches what the skill expects.
2. The reviewer shares the implementer's context. An agent reviewing code it
   just wrote, in the same session, inherits its own blind spots. The review
   step exists but is not independent.

The result is a long, fragile prompt protocol that LFI cannot observe, verify,
or retry at any granularity finer than "the whole attempt".

## Solution

LFI itself orchestrates each attempt as an explicit pipeline of phases, in the
style of the execute → review → merge flow that inspired this project
(sandcastle — inspiration only; the earlier decision not to fork it stands):

1. **Execute** — a worker session implements the task using the implement
   skill. LFI commits the worktree afterwards, so later phases see a clean
   committed diff against the base ref.
2. **Review** — a fresh agent session in the same worktree runs the
   code-review skill against the base ref and writes structured findings to a
   file LFI provides outside the worktree. If blocking findings exist, LFI
   runs one bounded remediation session, then one targeted re-review round.
3. **Validate** — LFI runs the project validation command deterministically in
   the worktree instead of trusting an agent's claim that validation passed.

Merge and delivery stay exactly where they are today: the existing integration
flow (merge agent, integration validation, delivery) is unchanged. The change
is that review leaves the worker prompt and becomes orchestration code, so it
works identically on every agent provider and needs no subagent support.

## User Stories

1. As an LFI operator, I want each attempt split into execute, review, and
   validate phases driven by LFI, so that the pipeline works on any agent
   provider regardless of its subagent mechanics.
2. As an LFI operator, I want the review phase to run in a fresh agent session
   with no implementer context, so that review findings are independent.
3. As an LFI operator, I want the worker prompt reduced to the implementation
   task and safety constraints, so that a worker agent no longer has to
   self-administer a multi-step review protocol.
4. As an LFI operator, I want review findings recorded as a structured file
   outside the worktree, so that LFI can decide whether blockers exist without
   parsing free-form agent prose.
5. As an LFI operator, I want the remediation loop bounded by LFI (one
   remediation session, one targeted re-review), so that a disagreeing
   reviewer and fixer cannot loop forever.
6. As an LFI operator, I want an attempt with unresolved blocking findings to
   end as not accepted with the worktree preserved, so that I can inspect and
   resume the work.
7. As an LFI operator, I want LFI to run the project validation command itself
   after review, so that a passing attempt is backed by an observed exit code
   rather than an agent's report.
8. As an LFI operator, I want the review phase to route through its own model
   configuration falling back to the worker model, so that I can spend a
   stronger or cheaper model on review independently of implementation.
9. As an LFI operator, I want each phase to log into its own named run log
   section, so that I can tell from the logs which phase produced which
   output.
10. As an LFI operator, I want a phase failure reported with the phase name in
    the attempt summary, so that a failed attempt tells me whether
    implementation, review, remediation, or validation broke.
11. As an LFI operator, I want the completion-block contract (status and
    summary only) unchanged in every phase, so that existing prompt templates,
    parsers, and the merge flow keep working.
12. As an LFI operator, I want the reused-dirty-worktree and merge-conflict
    handling in the attempt to behave exactly as before, so that the phased
    pipeline does not regress existing recovery paths.
13. As a maintainer of LFI, I want the review protocol expressed as TypeScript
    control flow instead of prompt constraints, so that its rules are unit
    tested rather than entrusted to model discipline.
14. As a maintainer of LFI, I want the codex-specific subagent constraint and
    the confirmation-matrix constraints deleted from the worker prompt, so
    that prompts contain no provider-conditional review instructions.
15. As a user of a customized task prompt template, I want my template to keep
    working with skill placeholders, so that switching to the phased pipeline
    does not force me to rewrite `.lfi/task-prompt.md`.

## Implementation Decisions

- The attempt module keeps its current interface and remains the single entry
  point; the phases are internal to it. Worktree creation, isolation sessions,
  origin refresh, and the reused-dirty-worktree path are untouched.
- Phase 1 (execute) renders the existing task template. The worker constraints
  lose every review-protocol item: the code-review invocation, the
  confirmation matrix, the "never report completion with a known blocker"
  rules, and the codex full-history-fork note. Safety constraints (no deploy,
  no SSH, no force-push, no self-commit) and the completion contract stay.
- After a completed execute phase LFI commits the worktree (as today), so the
  review phase always reviews a committed diff against the base ref.
- Phase 2 (review) opens a new agent session in the same worktree and
  isolation session. Its prompt invokes the code-review skill via the existing
  skill-placeholder mechanism, names the base ref to diff against, and names
  an absolute findings file path that LFI provides in the run's log/state
  directory — outside the worktree, so findings never dirty the diff.
- The findings file is JSON: a list of findings, each with an axis
  (`standards` or `spec`), a severity (`blocking` or `advisory`), and a
  description. LFI treats a missing or unparsable findings file from a
  completed review session as a review failure, not as a clean review.
- Blocker policy: blocking findings trigger exactly one remediation session
  (same worktree, prompt carries the findings verbatim), followed by exactly
  one targeted re-review session limited to the original findings and
  regression risk in the remediated area. Blockers still present after the
  re-review make the attempt not accepted; the worktree is preserved.
  Advisory findings never trigger remediation.
- Phase 3 (validate) runs the configured validation command via the existing
  project-command mechanism and gates acceptance on its exit code. When no
  validation command is configured, the phase is skipped as it is today in
  equivalent flows.
- Model routing: a reviewer model configuration is added alongside the
  existing worker and merger configurations, defaulting to the worker
  resolution when unset. Remediation runs on the worker configuration.
- The completion-block contract is unchanged for every phase; the findings
  file is the only new channel, and only the review phases use it.
- Attempt acceptance means: execute completed, review ended with no blocking
  findings, and validation passed. The attempt summary names the phase that
  failed. Phase logs use distinct log names per phase.
- The merge agent, integration validation, and delivery flows are not
  modified.

## Testing Decisions

- Tests exercise external behavior only: given a task and a scripted agent,
  the attempt returns accepted/not-accepted with the right summary, commits,
  and preserved worktree — never the internal phase functions.
- The seam is the existing one: tests call the attempt entry point with a fake
  agent binary on PATH that emits scripted completion blocks (and, for review
  phases, writes a scripted findings file). Prior art: the current attempt
  tests and the agent-event helpers in the test helpers directory.
- Scenarios to cover at that seam: clean pipeline (no findings) is accepted;
  blocking findings followed by successful remediation and clean re-review is
  accepted; blockers surviving re-review end not accepted with the worktree
  preserved; a review session that completes without writing a parsable
  findings file ends not accepted; validation failure ends not accepted; the
  reused-dirty-worktree path still short-circuits as before; prompts rendered
  for each phase contain the right skill invocation per provider and no
  review-protocol constraints in the execute phase.
- Prompt-shape assertions extend the existing prompt tests rather than adding
  a new test seam.

## Out of Scope

- Forking or vendoring sandcastle, or copying its code.
- Any change to the merge agent, integration validation, delivery, or push
  behavior.
- Changes to the tracker contract, task documents, or status lifecycle.
- Changes to isolation providers, worker images, or the agent-provider
  invocation/parsing layer beyond what phase prompts need.
- New or modified skills; the pipeline composes the installed implement,
  code-review, and merge-conflict skills as they are.
- Retrying the execute phase on review failure (an attempt still runs each
  phase at most the bounded number of times; whole-attempt retries remain the
  runner's concern).

## Further Notes

- Primary motivation is the move to the pi agent provider: the pipeline must
  not depend on any provider's subagent support. After this change the only
  provider-specific review logic left should be none.
- The deleted worker constraints are the ones describing review invocation,
  the confirmation matrix, and completion-with-blockers; they are superseded
  by orchestration, not lost.
- Sandcastle remains inspiration only, per the recorded decision not to fork
  it; this spec borrows the phase idea, not the implementation.
