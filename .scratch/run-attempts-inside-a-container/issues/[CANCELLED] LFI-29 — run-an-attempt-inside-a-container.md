Type: task
Blocked by: LFI-26, LFI-27, LFI-28, LFI-33
Tier: deep

> **Task complexity:** `deep`

## What to build

The first end-to-end line: a task goes from the tracker to a branch, with every
command it caused having run inside a container. `ISOLATION_PROVIDER` gains one
new accepted value, and a user on macOS gets a boundary for the first time.

One container per **isolation session**, which is one attempt. It is named
deterministically from the run and the task, labelled as LFI's, started when the
session opens and removed when it closes — including when the run is aborted or
dies. Containers never survive a run. The setup command, the agent, and the
validation command all execute inside the same one, because a setup command that
installs anything outside the worktree must still have installed it when the
tests run.

The worktree and the repository's Git metadata are mounted **at the paths they
already have**. Nothing is translated anywhere. A worktree's Git pointer, a
package manager's linked binaries and store references, build caches, and every
absolute path the project's own validation command prints are correct only under
path identity — and identity is also what keeps the two providers comparable
instead of being two behaviours sharing a name.

The container's home directory is the image's own, not the user's. The agent's
declared profile is projected into it as a private copy, so parallel sessions
cannot interfere with each other and cannot write back to the host. A projection
that fails is reported as a failure, not smoothed over into a differently
configured agent.

The package manager cache directories are shared from the host — the same list
the local provider already makes writable, applied by a different mechanism.
That list is the project's settled statement of what is shareable and
non-secret, and a second policy is not invented here. Five parallel workers hit
one cache that is already warm, on the first run, because it is the user's own.

Network access is ordinary and unfiltered, matching the local provider. Egress
filtering is not attempted: the boundary LFI owns is a filesystem and credential
boundary, and network confinement is what an agent's own sandbox layer claims.
The provider's network is expressible internally so that a future option needs
no change of shape. Resource limits are not introduced — the parallelism setting
already expresses how much machine a run may use.

Code-host credentials stay outside the boundary here as everywhere: the host
publishes, so nothing inside ever needed them.

## Acceptance criteria

- [ ] `ISOLATION_PROVIDER` accepts the container value and no other
      configuration key is added.
- [ ] One container per session, named deterministically from the run and the
      task, and labelled as LFI's.
- [ ] The setup command, the agent, and the validation command run in the same
      container.
- [ ] The container is removed when the session closes, including after a failed
      command and after an abort.
- [ ] The worktree and the repository's Git metadata are mounted at their host
      paths; no path is translated anywhere.
- [ ] The container's home directory is the image's own.
- [ ] The agent's declared profile is projected into the container home as a
      private copy; a failed projection is reported as a failure.
- [ ] The package manager cache directories shared are exactly the list the
      local provider uses.
- [ ] Network access is available inside the container.
- [ ] Code-host credentials are unreachable inside the container.
- [ ] Workers, the merger, and the integration worktree all run through the
      container provider when it is configured.
- [ ] A real task completes from tracker to branch under the container provider.

## Specification

[LFI-25 — Run attempts inside a container](<../[SPEC] LFI-25 — run-attempts-inside-a-container.md>)

## Blocked by

- [LFI-26 — Open the isolation boundary as a session](<[DONE] LFI-26 — open-the-isolation-boundary-as-a-session.md>)
- [LFI-27 — Declare the agent profile](<[DONE] LFI-27 — declare-the-agent-profile.md>)
- [LFI-28 — Build the worker image](<[DONE] LFI-28 — build-the-worker-image.md>)
- [LFI-33 — Delivered work must not be attempted again](<../../[DONE] LFI-33 — delivered-work-must-not-be-attempted-again.md>)
