# [SPEC] LFI-40 — configurable-prompts-and-phases

Type: spec
Blocked by: None

## Problem Statement

The runner sends five different prompts to agents — task, review, remediation,
re-review, and merge — but only the task prompt is a file the user can edit.
The other four are hardcoded inside the runner, together with the worker
constraint list. A user who wants to tune how the reviewer reviews, how the
remediator is briefed, or how the merger resolves conflicts has to fork the
runner source. Projects inspired by sandcastle expect the opposite experience:
open the project's runner directory, see every prompt as a plain file, edit
it, and re-run. The pipeline's steps are similarly fixed: there is no way to
switch off the review phase for a cheap project or change how many remediation
rounds are allowed without touching code.

## Solution

The project's runner directory gains a prompts directory with one template
file per phase. Initialization writes the built-in defaults there, so the user
immediately sees what each phase says and can edit any of it. A template that
is absent falls back to the built-in default, so existing projects keep
working unchanged. Placeholders carry the per-phase data (task identity, base
ref, findings, integration context) and the existing agent-independent skill
placeholder keeps templates portable across agent providers.

The parts of a prompt that the orchestrator itself parses or relies on — the
completion block contract, the findings-file contract, and the "do not stage
or commit" rule — are not part of the editable template. The runner appends
them itself, so a customized prompt can change the substance of a phase but
can never silently break the protocol the runner depends on.

Step configuration stays declarative in the existing configuration file: a
switch for the review phase and a bounded remediation-round count join the
existing validation and model settings. The pipeline's phase order and the
set of phases remain fixed; the runner stays a CLI, not a library.

## User Stories

1. As a project maintainer, I want every phase prompt to live as a file in the runner directory, so that I can read exactly what each agent is told without opening the runner source.
2. As a project maintainer, I want initialization to write the default templates into the prompts directory, so that I start from working prompts instead of a blank page.
3. As a project maintainer, I want to edit the review template, so that reviewers focus on the standards my project cares about.
4. As a project maintainer, I want to edit the remediation template, so that remediators receive project-specific repair guidance.
5. As a project maintainer, I want to edit the re-review template, so that targeted re-reviews match my review customizations.
6. As a project maintainer, I want to edit the merge template, so that the merger follows my project's integration conventions.
7. As a project maintainer, I want to edit the task template in the same directory as every other template, so that all prompts are configured in one place.
8. As an existing user, I want my current task prompt file to keep working, so that upgrading the runner does not break my project.
9. As a project maintainer, I want a deleted template to fall back to the built-in default, so that I can always return to stock behaviour by removing a file.
10. As a project maintainer, I want templates to support placeholders for per-phase data, so that my custom wording still receives the task, base ref, findings, and context the phase needs.
11. As a project maintainer, I want the agent-independent skill placeholder to work in every template, so that my prompts survive switching agent providers.
12. As a project maintainer, I want the runner to reject a template that references an installed skill directly, so that provider-specific syntax cannot sneak into a portable template.
13. As a project maintainer, I want the runner to reject a template containing an unknown placeholder before any agent runs, so that a typo fails fast instead of sending a broken prompt.
14. As a project maintainer, I want the completion contract and findings contract appended by the runner rather than written in my template, so that my edits can never break result parsing.
15. As a project maintainer, I want a configuration switch that disables the review phase, so that cheap or low-risk projects can skip review cost.
16. As a project maintainer, I want to configure how many remediation rounds are allowed, so that I control the cost ceiling of a failing review.
17. As a runner operator, I want configuration errors in templates or step settings reported before agents start, so that a misconfigured run fails in seconds, not after minutes of agent time.
18. As a runner operator, I want the run to record which template source was used, so that logs make clear whether a phase ran a custom or default prompt.
19. As a non-English user, I want initialization to write default templates in my configured language, so that editing starts from prompts I can read.
20. As a project maintainer, I want documentation of the prompts directory, its placeholders, and the step settings, so that I can configure the pipeline without reading runner source.

## Implementation Decisions

- A prompts directory inside the runner's project directory holds one
  Markdown template per phase: task, review, remediation, re-review, and
  merge. Templates are plain text with placeholders; they are not executable.
- Template resolution precedence for each phase: the phase file in the
  prompts directory, then (for the task phase only) the legacy task prompt
  file at its current location, then the built-in default. Absence at every
  level is impossible because built-in defaults always exist.
- Initialization writes all five default templates in the configured
  language. It never overwrites an existing template file.
- Placeholders are phase-scoped. The task phase keeps its existing
  placeholders (task identifier, issue URL, number, title). The review and
  re-review phases receive the base ref and the findings-file path; the
  re-review phase also receives the original findings verbatim. The
  remediation phase receives the findings verbatim. The merge phase receives
  the integration context and, when validation repair is scoped, the allowed
  paths. The agent-independent skill placeholder is valid in every template.
- A template containing a placeholder that its phase does not define is a
  configuration error reported before any agent starts. An empty or
  whitespace-only template file is likewise an error, not a silent fallback.
- The existing guard against direct references to installed skills applies to
  every template, not only the task template.
- The runner appends the protocol blocks itself, outside the editable
  template: the completion block contract for every phase, the findings-file
  contract for review and re-review, and the staging/commit prohibition for
  phases where the runner records the worktree. The safety constraint list
  attached to the task prompt also stays runner-owned and non-editable.
- Step configuration lives in the existing environment-style configuration
  file. A review-phase switch (enabled by default) skips review, remediation,
  and re-review entirely when off. A remediation-round setting (default one,
  zero allowed) bounds how many remediation attempts follow a blocking
  review; re-review remains one targeted pass per remediation. Validation
  keeps its existing switch semantics (an empty validation command disables
  the phase). The merge and delivery phases are not configurable.
- Phase order and the set of phases are fixed. There is no user-supplied
  executable configuration; the runner remains a CLI with declarative
  configuration, per the standing decision not to fork sandcastle's
  script-as-product model.
- Run logs name the template source (custom file or built-in default) for
  each phase that runs.
- The agents documentation describes the prompts directory, the per-phase
  placeholders, the protocol blocks the runner appends, and the step
  settings.

## Testing Decisions

- Good tests observe external behaviour: the prompt text an agent process
  actually receives, the phases that actually run, and the errors surfaced
  before agents start — never the internal shape of the resolver.
- The template resolver is tested at the module seam: a phase file is used
  when present, the legacy task file is honoured, the built-in default is
  used when nothing is on disk, placeholders substitute per phase, unknown
  placeholders and empty templates are rejected, the direct-skill guard
  fires, and the protocol blocks are appended outside the template.
- One end-to-end test runs through the existing attempt seam with the fake
  agent binary on PATH: a customized review template demonstrably reaches
  the review agent's prompt, and the review-phase switch demonstrably skips
  review while remediation-round zero stops after the first blocking review.
- Step-setting parsing and validation are covered where configuration
  parsing is already tested.
- Prior art: the existing attempt-pipeline tests that drive a fake agent
  through execute, review, and remediation, and the existing prompt and
  configuration unit tests.

## Out of Scope

- A user-supplied executable pipeline definition (a run script), hooks, or
  any other way to run user code between phases.
- Custom phases, reordering phases, or per-phase agent providers beyond the
  existing model routing.
- Changes to the tracker contract, the completion block contract, or the
  findings-file schema.
- Per-task or per-tier template overrides; templates are per-project.
- Migrating or deleting the legacy task prompt file automatically.

## Further Notes

The editable-template versus runner-owned-protocol split is the load-bearing
decision: it delivers sandcastle-style "everything is a file you can edit"
ergonomics while keeping every contract the orchestrator parses out of reach
of accidental breakage. If real projects later need programmability that
declarative templates cannot express, the recorded escape hatch is hooks
between phases — not a forkable run script.
