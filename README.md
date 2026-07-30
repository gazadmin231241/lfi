# LFI — Let’s Fucking Implement

[Русский](README.ru.md)

LFI turns local Markdown tasks or `lfi:task` GitHub Issues into reviewed, validated
commits using Codex and isolated Git worktrees. Local mode works without a
remote; GitHub can be updated later as an explicit reporting mirror.

> GitHub mode can push directly to your default branch. Local mode never
> fetches or pushes. Start with `lfi run --dry-run`.

## Requirements

- Node.js 22+
- Git
- [GitHub CLI](https://cli.github.com/) only for GitHub mode, migration, or sync
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
their tracker contract automatically. LFI conditionally adapts the installed
`to-spec` and `to-tickets` instructions for LFI projects: specs and tasks go
to `.lfi` locally or use `lfi:spec`/`lfi:task` on GitHub, and ticket creation
does not choose a model label.

## Task storage

`lfi init` asks where tasks live. New and non-interactive projects default to
Local Markdown:

```text
.lfi/tasks/[READY] LFI-2 — implement-parser.md
.lfi/specs/[SPEC] LFI-1 — local-first-workflow.md
```

These files are versioned; `.lfi/logs`, `.lfi/state`, and `.lfi/worktrees`
remain local. Tasks use Markdown with YAML frontmatter and one shared `LFI-N`
ID sequence. Persisted statuses are `ready`, `completed`, and `cancelled`;
in-progress and blocked display states are derived. LFI records `completed_at`
after integration so the ten recent completions are ordered by completion
time, not by ID.

Each local task ends with clickable `Specification` and `Blocked by` sections.
LFI updates their exact relative file links whenever a status rename occurs.

Task status output uses `[READY]`, `[RUNNING]`, `[BLOCKED]`, and `[DONE]`.
These prefixes are local-only. GitHub Issue titles use the stable
`LFI-N — title` form; native issue state and dependencies show their status.

GitHub mode uses the same fixed type vocabulary as Local Markdown:
`type: spec` maps to `lfi:spec`, and `type: task` maps to `lfi:task`.
Specifications are never executable. Tasks support textual and native
dependencies.

## Commands

```text
lfi init [--task-source local|github]
lfi doctor [--sync]
lfi run [LFI-ID...]
lfi run --dry-run
lfi status [--all|--ready|--blocked|--completed]
lfi sync [github] [--repo OWNER/REPO] [--dry-run] [--force]
lfi migrate local
lfi logs
lfi logs LFI-ID|ISSUE_NUMBER
lfi logs prune
lfi logs prune --all
lfi skills install
lfi skills list
lfi skills doctor
lfi skills update
lfi config language en|ru
```

## Configuration

Normal initialization asks for task storage and log retention. Advanced values
remain editable in `.lfi/config.env`, including:

- Codex and merger model/reasoning
- parallel workers and stage count
- task source, GitHub mirror repository, and default branch
- validation and worktree setup commands
- inactivity timeout

Use `lfi init --advanced` to edit those values interactively during setup.

`.lfi/task-prompt.md` is the user-editable worker prompt. Personal skills in
`~/.agents/skills` are loaded by Codex automatically.

## Safety and completion

Each task gets a persistent worktree. A branch is eligible for integration
only after Codex reports structured completion. Codex edits and validates files
inside its `workspace-write` sandbox; because that sandbox intentionally keeps
Git metadata read-only, the LFI host stages and commits a successful worker's
changes. The combined integration branch must pass the configured validation
command. If that command fails, LFI runs it against a separately prepared base
worktree first. A base failure is reported without invoking Codex. If the base
passes, the merger receives the exact redacted diagnostics and may change only
paths already present in the integrated diff. LFI makes one repair attempt and
does not send an accepted task back through implementation after an integration
failure. Local mode merges the validated integration branch back into the
current host branch using ordinary Git semantics and never pushes. Any
integration failure preserves the integration worktree and prints its branch
and path for recovery.

`lfi sync` is a one-way local-to-GitHub mirror. It publishes specs as parents,
tasks as children, fixed LFI type labels, dependencies where supported,
explicit status prefixes, and open/closed state. It preserves unrelated labels
and removes a conflicting LFI type label. Sync is resumable, limits GitHub
concurrency to three, retries transient network and 502/503/504 failures, and
persists each mapping to avoid duplicate Issues.

`lfi migrate local` reads only `lfi:spec` and `lfi:task` Issues, preserves
native parent and blocker relationships, writes the correct local document
types, and then switches the source to Local Markdown. Previous tracker labels
are intentionally not recognized.

In GitHub mode, if GitHub accepts the push but temporarily fails to close an Issue, LFI records
the pending closure and retries it at the beginning of the next run. `lfi
status` shows the active run while work is in progress and falls back to the
most recent completed run.

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

`.lfi/logs` is flat: local tasks use `LFI-2.log`, GitHub Issues use
`issue-123.log`, and combined validation uses `integration.log`. Repeated
attempts append timestamped iteration sections. Task logs stream readable agent
messages, commands, token usage, stderr, exit status, and the final summary in
real time; failed workers use the same task log instead of a separate raw
artifact.

`lfi logs` shows recent runs as a localized table. `lfi logs LFI-2` or `lfi
logs 123` prints the latest task section and points to the full history. Log
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
