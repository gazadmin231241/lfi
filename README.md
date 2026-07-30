# LFI — Let’s Fucking Implement

[Русский](README.ru.md)

LFI turns ready GitHub Issues into reviewed, validated commits using Codex and
isolated Git worktrees. It runs multiple issues in parallel, resolves
integration conflicts, validates the combined result, pushes the repository's
default branch, and closes completed issues.

> LFI can push directly to your default branch. Start with `lfi run --dry-run`
> and use it only in repositories where this workflow is intentional.

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
target repository and run `$setup-matt-pocock-skills` once before relying on
`to-spec`/`to-tickets`.

## Issue contract

LFI selects open Issues with `ready-for-agent`, excluding `blocked`,
`needs-info`, and `ready-for-human`. It respects open references in:

```md
## Blocked by

- #123
```

The labels and base branch are editable in `.lfi/config.env`.

## Commands

```text
lfi init
lfi doctor
lfi run
lfi run --dry-run
lfi status
lfi logs
lfi logs ISSUE_NUMBER
lfi logs prune
lfi logs prune --all
lfi skills install
lfi skills list
lfi skills doctor
lfi skills update
lfi config language en|ru
```

## Configuration

Normal initialization detects almost everything and only asks for log
retention. Advanced values remain editable in `.lfi/config.env`, including:

- Codex and merger model/reasoning
- parallel workers and stage count
- labels and default branch
- validation and worktree setup commands
- inactivity timeout

Use `lfi init --advanced` to edit those values interactively during setup.

`.lfi/task-prompt.md` is the user-editable worker prompt. Personal skills in
`~/.agents/skills` are loaded by Codex automatically.

## Safety and completion

Each issue gets a persistent worktree. A branch is eligible for integration
only after Codex reports structured completion, creates commits, and leaves the
worktree clean. The combined integration branch must pass the configured
validation command before LFI pushes it and closes Issues.

Worker prompts pre-approve required local code, migration, dependency, lockfile,
and configuration work. They explicitly forbid production deploys, SSH,
production-data changes, destructive database resets, secret exposure, and
force-push.

## Logs

The terminal shows compact prefixed progress. Successful workers retain compact
logs; failed workers also retain compressed raw JSONL. Expired run directories
are removed at the start and end of `lfi run`. The default retention is three
days and is selected during `lfi init`.

## Development

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm check
```

Licensed under the [MIT License](LICENSE).
