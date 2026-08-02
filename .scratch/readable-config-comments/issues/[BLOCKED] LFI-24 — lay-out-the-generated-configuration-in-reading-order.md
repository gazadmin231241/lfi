Type: task
Blocked by: LFI-23
Tier: standard

> **Task complexity:** `standard`

## What to build

A user who finishes `lfi init` and opens `.lfi/config.env` can read it top to
bottom once and know what to do.

The file now opens on the settings autodetection guessed at — the project's base
branch, validation command, and worktree setup command — because those are the
ones that might be wrong. Agent and model routing follows, then execution
tuning, then isolation, which most users never touch. Section headings keep
their current plain wording.

Every key carries a short phrase after its value saying what it is, in the
language chosen at `init`. The description sits on the same line as the value,
separated by a single space and not padded into a column, so the file stays
short and each key is understood next to the number or string it holds.

The routing preamble shrinks from three lines to one: the format and an example.
The note about prefix-less values and the note about empty tiers falling back
both leave the file — the fallback is said instead by the description on
`DEFAULT_MODEL`. Both behaviours are unchanged; only their announcement is gone.

The file gains nothing that points elsewhere: no banner, no links, and no
explanation of where reasoning effort went. Existing configurations are not
rewritten, and no command is added to rewrite them.

## Acceptance criteria

- [ ] Generated output orders sections: project commands, agent and model
      routing, execution, isolation.
- [ ] Every emitted assignment line carries a description after its value.
- [ ] The routing help occupies one comment line stating the format with an
      example.
- [ ] `DEFAULT_MODEL`'s description states that it is used when a tier is left
      empty.
- [ ] Descriptions are separated from values by a single space, with no column
      alignment.
- [ ] The default language and Russian produce the same key order and the same
      set of described keys.
- [ ] A configuration in which every field is non-default survives
      write-then-read unchanged.
- [ ] `REASONING_EFFORT` and `MERGER_REASONING_EFFORT` are still parsed and
      still not written to the file.
- [ ] Prefix-less model values and empty-tier fallback continue to work despite
      no longer being mentioned in the file.
- [ ] `lfi init` and `lfi init --advanced` produce the same layout, and neither
      overwrites an existing configuration.
- [ ] Tests assert order, presence of descriptions, and round-trip identity —
      not the wording of any description.

## Specification

[LFI-22 — Readable config comments](<../[SPEC] LFI-22 — readable-config-comments.md>)

## Specification

[LFI-22 — Readable config comments](<../[SPEC] LFI-22 — readable-config-comments.md>)

## Blocked by

- [LFI-23 — Tolerate trailing comments when reading configuration](<[READY] LFI-23 — tolerate-trailing-comments-when-reading-configuration.md>)
