Type: task
Blocked by: LFI-35
Tier: light

> **Task complexity:** `light`

## What to build

Review is a different job from implementation, and the operator may want to
spend a different model on it — stronger, cheaper, or on a different provider
tier. A reviewer model configuration is added alongside the existing worker
and merger configurations, and the review and re-review sessions resolve
through it. When unset, it falls back to the worker resolution, so existing
configurations keep today's behaviour without edits. Remediation stays on the
worker configuration: fixing code is implementation work.

Prior art is the merger routing; the reviewer configuration follows the same
shape, including reasoning-effort handling per agent provider.

## Acceptance criteria

- [x] Review and re-review sessions resolve model, provider, and reasoning
      through the reviewer configuration.
- [x] An unset reviewer configuration falls back to the worker resolution;
      existing config files behave unchanged.
- [x] Remediation sessions keep resolving through the worker configuration.
- [x] Configuration parsing and fallback are covered at the same seam as the
      existing model-routing tests.

## Specification

[LFI-34 — Phased attempt pipeline](<../[SPEC] LFI-34 — phased-attempt-pipeline.md>)

## Blocked by

- [LFI-35 — Run a review phase after execute](<[DONE] LFI-35 — run-a-review-phase-after-execute.md>)
