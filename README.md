# LFI — Let’s Fucking Implement

[Русский](README.ru.md)

LFI turns local Markdown tasks into reviewed, validated commits using Codex and
isolated Git worktrees. Tasks never leave the local tracker; GitHub hosts the
repository and receives validated code.

> LFI pushes validated changes directly to the default branch. Start with
> `lfi run --dry-run`.

## Requirements

- Node.js 22+
- Git
- [GitHub CLI](https://cli.github.com/) authenticated with `gh auth login`
- [Codex CLI](https://developers.openai.com/codex/cli/) authenticated with
  `codex login`
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
at `.scratch/`. Completed tasks remain beside their specification; there is
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
- project-wide worker reasoning, kept unchanged across tiers and retries
- an independent integration model and reasoning setting
- parallel workers and stage count
- default branch
- validation and worktree setup commands
- inactivity timeout

Use `lfi init --advanced` to edit those values interactively during setup.

`.lfi/task-prompt.md` is the user-editable worker prompt. Personal skills in
`~/.agents/skills` are loaded by Codex automatically.

## Safety and completion

Each task gets a persistent worktree. A branch is eligible for integration
only after Codex reports completion through the tagged LFI completion block.
Codex edits and validates files
inside its `workspace-write` sandbox; because that sandbox intentionally keeps
Git metadata read-only, the LFI host stages and commits a successful worker's
changes. The combined integration branch must pass the configured validation
command. If that command fails, LFI runs it against a separately prepared base
worktree first. A base failure is reported without invoking Codex. If the base
passes, the merger receives the exact redacted diagnostics and may change only
paths already present in the integrated diff. LFI makes one repair attempt and
does not send an accepted task back through implementation after an integration
failure. LFI pushes the validated integration branch to the configured default
branch. Any integration failure preserves the integration worktree and prints
its branch and path for recovery.

At execution time, `LIGHT_MODEL`, `STANDARD_MODEL`, and `DEEP_MODEL` map the
task tier to an agent and model, falling back to `DEFAULT_MODEL` when a tier
mapping is empty. Prefix a model with an agent and a colon (for example,
`codex:gpt-5.6`); an unprefixed value means Codex. `REASONING_EFFORT` is always
passed through exactly as configured. `MERGER_MODEL` is independent and falls
back through `STANDARD_MODEL`, then `DEFAULT_MODEL`. If an agent rejects an
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
