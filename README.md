# LFI — Let’s Fucking Implement

[Русский](README.ru.md)

LFI turns local Markdown tasks into reviewed, validated commits using pluggable
coding agents and isolated Git worktrees. Tasks never leave the local tracker;
GitHub hosts the repository and receives validated code.

> LFI pushes validated changes directly to the default branch. Start with
> `lfi run --dry-run`.

## Requirements

- Node.js 22+
- Git
- [GitHub CLI](https://cli.github.com/) authenticated with `gh auth login`
- at least one configured agent: [Codex CLI](https://developers.openai.com/codex/cli/)
  authenticated with `codex login`, or Pi authenticated for its configured
  provider
- pnpm for building/linking LFI from source

## Install from source

```bash
git clone https://github.com/gazadmin231241/lfi.git
cd lfi
pnpm install
pnpm build
npm link
```

`npm link` is used because it works with the active Node installation. If your
pnpm global bin directory is configured, `pnpm link --global` is equivalent.

Then, in a target repository:

```bash
lfi skills install
lfi init
lfi doctor
lfi run --dry-run
lfi run
```

`lfi skills install` installs a pinned minimal bundle from
[`mattpocock/skills`](https://github.com/mattpocock/skills). Open Codex in the
target repository and use `to-spec`/`to-tickets`; local initialization writes
the project's tracker contract automatically. Skills are installed exactly as
published upstream, so they behave the same in LFI and non-LFI repositories.

## Task storage

`lfi init` creates the Local Markdown tracker:

```text
.scratch/
  local-first-workflow/
    [SPEC] LFI-1 — local-first-workflow.md
    issues/
      [READY] LFI-2 — implement-parser.md
      [DONE] LFI-3 — publish-release.md
  [READY] LFI-4 — one-off-maintenance.md
```

Each specification has its own directory: its specification document is at the
root and its tasks are in `issues/`. Tasks without a specification sit directly
at `.scratch/`. LFI preserves the directory name chosen when the specification
is created, including when the specification document is renamed. Completed tasks remain beside their specification; there is
no archive directory. These files are versioned; `.lfi/logs`, `.lfi/state`, and
`.lfi/worktrees` remain local. Documents use plain Markdown marker lines and one
shared `LFI-N` ID sequence. Status is derived only from the filename;
in-progress and blocked display states are derived from run state and blockers.

Each local task ends with clickable `Specification` and `Blocked by` sections.
LFI updates their exact relative file links whenever a status rename occurs.

Task status output uses `[READY]`, `[RUNNING]`, `[BLOCKED]`, and `[DONE]`.
Only documents declaring `Type: task` are executable; `spec`, `research`,
`prototype`, and `grilling` are not. `Blocked by:` declares local dependencies,
and `Tier:` accepts `light`, `standard`, or `deep`. A missing tier runs as
`standard` with a warning; a missing `Type:` is malformed.

## Commands

```text
lfi init
lfi doctor
lfi run [LFI-ID...]
lfi run --dry-run
lfi status [--all|--ready|--blocked|--completed]
lfi logs
lfi logs LFI-ID
lfi logs prune
lfi logs prune --all
lfi skills install
lfi skills list
lfi skills doctor
lfi skills update
lfi config language en|ru
```

## Configuration

Normal interactive initialization asks for log retention and whether to use
the recommended Luna/Terra/Sol mapping. Advanced values remain
editable in `.lfi/config.env`, including:

- light, standard, and deep worker models
- agent, model, and reasoning for each worker tier
- an independent merger agent, model, and reasoning setting
- parallel workers and stage count
- default branch
- validation and worktree setup commands
- whether the review phase runs and the maximum remediation rounds
- inactivity timeout
- isolation provider (`local` by default, or explicit `none` for a disposable environment)

Use `lfi init --advanced` to edit those values interactively during setup.

### Prompt templates

`lfi init` creates `.lfi/prompts/` with one plain Markdown template per fixed
phase:

| File | Phase placeholders |
| --- | --- |
| `task.md` | `{{TASK_ID}}`, `{{ISSUE_URL}}`, `{{ISSUE_NUMBER}}`, `{{ISSUE_TITLE}}` |
| `review.md` | `{{BASE_REF}}`, `{{FINDINGS_FILE}}` |
| `remediation.md` | `{{FINDINGS}}` |
| `re-review.md` | `{{BASE_REF}}`, `{{FINDINGS_FILE}}`, `{{FINDINGS}}` |
| `merge.md` | `{{INTEGRATION_CONTEXT}}`, `{{ALLOWED_PATHS}}` |

`{{SKILL:name}}` is also valid in every template. It is expanded to the
provider-specific skill syntax at runtime, so templates remain portable
between Codex and Pi. Other placeholders are invalid for that phase.

For each phase, LFI resolves templates in this order:

1. `.lfi/prompts/<phase>.md`;
2. for the task phase only, the legacy `.lfi/task-prompt.md`;
3. the built-in default for the configured language.

Removing a phase file restores the built-in behaviour. Initialization never
overwrites an existing template (and preserves the legacy task prompt), so
local edits survive repeated `lfi init` runs.

Run logs name the resolved source for every phase that runs: the custom file,
the legacy task file, or the built-in default.

Templates control editable guidance only. The runner appends non-editable
protocol outside every template: the LFI completion block for all phases; the
findings-file path and exact JSON findings contract for review; the verdicts-
file path and exact positional JSON verdict contract for verification; the no-
worktree-changes/no-commit rule for both; and the no-stage/no-commit rule for
remediation and merge. The task prompt also receives the runner-owned LFI
safety constraint list. These blocks cannot be changed by editing a template.

LFI validates all resolved templates before starting any agent. A custom or
legacy template that is empty or whitespace-only, uses an unknown or
phase-inappropriate placeholder, or directly references an installed skill
with `$skill` instead of `{{SKILL:skill}}` fails fast. Built-in defaults are
always available when files are absent.

### Step settings

The following settings are in `.lfi/config.env`:

- `REVIEW_ENABLED=true` by default. Set it to `false` to skip review,
  remediation, and verification; implementation, validation, merge, and delivery
  are unaffected.
- `MAX_REMEDIATION_ROUNDS=1` by default. It must be a safe integer greater
  than or equal to zero. Zero stops after the first blocking review; a positive
  value is the remediation-attempt ceiling. Verification asks only whether
  each original blocker was resolved; it cannot introduce new findings.
- `VALIDATE_COMMAND` defaults to empty. An empty command disables the validation
  phase; otherwise its command is run at the existing validation gates. This
  switch is independent of `REVIEW_ENABLED`: disabling review does not disable
  validation. A normal `lfi run` requires a validation command before agents
  start.
- `VALIDATION_RETRY_COUNT=1` retries a failed validation command before a model
  is involved. A successful retry is accepted and remains visible in the log.
- `VALIDATION_REPAIR_ATTEMPTS=2` bounds model-driven validation repair. After
  every repair LFI reruns the full command itself; zero disables model repair,
  never the validation gate.

`REVIEW_ENABLED` must be exactly `true` or `false`. Invalid values, negative or
fractional remediation rounds, and other invalid configuration values are
reported before agents start.

## Safety and completion

Each task gets a persistent worktree. A branch is eligible for integration
only after its configured agent reports completion through the tagged LFI
completion block.
Every worker and merger runs
inside LFI's local isolation boundary, with the agent's own sandbox retained
inside it. The filesystem is read-only except for the worktree, Git metadata,
temporary storage, and package-manager caches; code-host credentials are hidden
and network access remains available. Set `ISOLATION_PROVIDER=none` only when
the surrounding environment is already disposable. Agents stage and commit
their own work, and LFI accepts a successful exit only with commits ahead of
the base. Uncommitted leftovers do not reject an attempt — the worktree is
kept, with its path and cleanup command printed. `lfi run` never fetches or
merges `origin` into your working tree, so an uncommitted or stale checkout
does not block a run; a reused task worktree is fast-forwarded from
`origin/<base branch>` only when that is provably safe, and any failure there
is logged rather than fatal. The combined integration branch must pass the
configured validation
command. A failed command is retried before model repair. Persistent task
failures give the repair model exact redacted diagnostics and are always
followed by another full validation. A reviewed checkpoint lets a later run
resume there without repeating worker or review. For combined validation LFI
also checks a separately prepared base worktree. A green base uses narrow
integrated-diff repair first and wide repair later; a red base is passed as
diagnostic context to wide repair and never permits red delivery. LFI pushes
only the validated integration branch to the configured default
branch. Any integration failure preserves the integration worktree and prints
its branch and path for recovery.

At execution time, `LIGHT_MODEL`, `STANDARD_MODEL`, and `DEEP_MODEL` map the
task tier to an agent, model, and reasoning level, falling back to
`DEFAULT_MODEL` when a tier mapping is empty. Use
`<cli>:<model>:<reasoning>` (for example, `codex:gpt-5.6-sol:medium` or
`pi:openai/gpt-5.6:high`). `MERGER_MODEL` is independent and falls
back through `STANDARD_MODEL`, then `DEFAULT_MODEL`. `REVIEWER_MODEL` is
independent and falls back to the worker resolution when unset. If an agent rejects an
explicitly configured worker model, LFI logs it, does not silently substitute
another model, skips remaining tasks using that agent-model pair for that run,
and continues other tiers.

Worker prompts pre-approve required local code, migration, dependency, lockfile,
and configuration work. They explicitly forbid production deploys, SSH,
production-data changes, destructive database resets, secret exposure, and
force-push.

Worker review is bounded without removing the independent quality gate. After
focused implementation checks, a worker invokes `$code-review` once; its
Standards and Spec reviewers run in parallel as one complete review. Findings
are remediated as a batch. Substantive fixes receive targeted confirmation only
from the affected review axes, and the complete diff is not reviewed again. A
known unresolved blocker produces `incomplete`. The repository-wide validation
runs on the final review-adjusted code, while combined integration validation
remains a separate required gate.

## Logs

The terminal emphasizes iterations, worker completion, integration, validation,
and the final result. `.lfi/logs/run.log` mirrors that LFI-owned stdout/stderr
stream in real time. The shell prompt itself is not part of the log.

`.lfi/logs` is flat: tasks use `LFI-2.log` and combined validation uses
`integration.log`. Repeated
attempts append timestamped iteration sections. Task logs stream readable agent
messages, commands, token usage, stderr, exit status, and the final summary in
real time; failed workers use the same task log instead of a separate raw
artifact.

`lfi logs` shows recent runs as a localized table. `lfi logs LFI-2` prints the
latest task section and points to the full history. Log
sections and legacy timestamp directories expire according to
`LOG_RETENTION_DAYS` (three days by default); `0` retains them indefinitely.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm check
```

Licensed under the [MIT License](LICENSE).
