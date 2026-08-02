Type: task
Blocked by: LFI-36
Tier: standard

> **Task complexity:** `standard`

## What to build

Once orchestration owns review, the worker prompt telling the agent to review
its own work is not just redundant — it is a second, competing protocol that
can disagree with the real one. The execute-phase prompt drops every
review-protocol constraint: the code-review invocation, the confirmation
matrix, the completion-with-blockers rules, and the codex-specific note about
full-history forks. What stays is the implementation instruction (the
implement skill and TDD guidance), the safety constraints (no deploy, no SSH,
no force-push, no self-commit, no secrets in logs, verify commands by running
them), and the completion contract.

After this task no prompt rendered by LFI contains provider-conditional review
instructions; the only review logic anywhere is the orchestrated phase
sequence. Custom task templates keep working unchanged — the simplification
lives in the constraints LFI appends, not in the user's template.

## Acceptance criteria

- [ ] The rendered execute prompt contains no code-review invocation,
      confirmation matrix, completion-with-blockers rule, or codex
      full-history-fork note.
- [ ] Implementation guidance, safety constraints, and the completion contract
      remain, in both languages.
- [ ] No rendered prompt varies its review instructions by agent provider.
- [ ] An existing customized task template renders and runs unchanged.
- [ ] Prompt-shape tests extend the existing prompt tests rather than adding a
      new seam.

## Specification

[LFI-34 — Phased attempt pipeline](<../[SPEC] LFI-34 — phased-attempt-pipeline.md>)

## Blocked by

- [LFI-36 — Bounded remediation and targeted re review](<[DONE] LFI-36 — bounded-remediation-and-targeted-re-review.md>)
