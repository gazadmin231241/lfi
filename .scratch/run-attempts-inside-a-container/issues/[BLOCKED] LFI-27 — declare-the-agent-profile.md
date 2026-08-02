Type: task
Blocked by: LFI-26
Tier: standard

> **Task complexity:** `standard`

## What to build

An agent behaves the way its user configured it, or it is a different agent.
Settings, hooks, subagent definitions, an instructions file, credentials — none
of that is incidental, and an agent that runs without them produces work the
user did not ask for and cannot explain.

Each **agent provider** declares which host paths constitute its **agent
profile**, because that set genuinely differs between CLIs and ADR-0002 already
made the provider the sole owner of everything that does. The skills directory
is declared once for every agent, since it is shared. The boundary declaration
from the previous task carries the profile of whichever agent the session will
run.

What the profile is not is equally deliberate. Conversation history, past
sessions, attachments, browser state, and agent caches do not cross the
boundary. Size is the visible reason — on the machine this was designed against
the difference is kilobytes against gigabytes — but it is not the deciding one.
The deciding one is that a run puts several workers inside the boundary at once,
and a shared writable history file and session database is a race, not an
isolation mechanism.

Under the local provider nothing observable changes: the home directory is
already visible there, so the profile is already reachable. The contract is
fixed and tested here, before anything depends on it, so that the container
provider inherits a declaration rather than inventing one.

## Acceptance criteria

- [ ] Each agent provider declares its own profile paths; nothing outside the
      provider enumerates them.
- [ ] The skills directory is declared once and applies to every agent.
- [ ] The boundary declaration includes the profile of the agent the session
      will run.
- [ ] History, sessions, attachments, and agent caches are not part of any
      profile, asserted by test.
- [ ] Code-host credentials are not part of any profile.
- [ ] The local provider's observable behaviour is unchanged.

## Specification

[LFI-25 — Run attempts inside a container](<../[SPEC] LFI-25 — run-attempts-inside-a-container.md>)

## Blocked by

- [LFI-26 — Open the isolation boundary as a session](<[READY] LFI-26 — open-the-isolation-boundary-as-a-session.md>)
