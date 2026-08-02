Type: task
Blocked by: None
Tier: standard

> **Task complexity:** `standard`

## What to build

A value in `.lfi/config.env` loads the same whether or not the line ends in a
comment.

Today the parser takes everything after the first `=` as the value, so a
hand-written `MAX_PARALLEL=3 # tasks at once` yields `NaN`, and a commented
string key silently carries the comment text inside its value. Anyone who
annotates their own configuration corrupts it.

Parsing gains one rule: a trailing comment is an unquoted `#` preceded by
whitespace, and everything from that `#` to the end of the line is dropped
before the value is interpreted. The remaining value is trimmed of trailing
whitespace. A `#` that is not preceded by whitespace stays part of the value, so
a validation or setup command that embeds the character keeps working.

Nothing the file looks like changes in this task. This is the rule that has to
exist before the generated file can annotate its own keys.

## Acceptance criteria

- [ ] A line with a trailing comment parses to the same value as the same line
      without one, for a string key and for a numeric key.
- [ ] A numeric key followed by a trailing comment parses to a number, not
      `NaN`.
- [ ] A `#` not preceded by whitespace remains part of the value, asserted with
      a command-shaped value.
- [ ] Trailing whitespace left by comment removal is not part of the value.
- [ ] A configuration in which every field is non-default survives write-then-read
      unchanged.
- [ ] Existing configuration round-trip tests pass unmodified in both the
      default language and Russian.
- [ ] No key is added, removed, or renamed, and the generated file is unchanged
      by this task.

## Specification

[LFI-22 — Readable config comments](<../[SPEC] LFI-22 — readable-config-comments.md>)

## Blocked by

None — can start immediately.
