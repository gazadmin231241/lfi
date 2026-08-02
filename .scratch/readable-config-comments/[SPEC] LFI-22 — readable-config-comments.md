Type: spec
Blocked by: None

## Problem Statement

A user finishes `lfi init`, opens `.lfi/config.env`, and cannot tell what to do
next. The file is not long — fifteen keys — but it reads as if every one of them
is a decision waiting to be made.

Three things produce that impression.

The file opens with its hardest subject. The first thing on screen is agent and
model routing, introduced by a three-line preamble about a `<cli>:<model>:<reasoning>`
grammar, backward compatibility with prefix-less values, and empty-tier fallback
to `DEFAULT_MODEL`. Two of those three lines describe situations the reader is
not in: a prefix-less value belongs to someone with an older config, and the
fallback rule is a property of the key it falls back to. The reader spends their
first attention on rules that do not apply to the file in front of them.

Meanwhile the keys that genuinely need a look — `BASE_BRANCH`,
`VALIDATE_COMMAND`, `WORKTREE_SETUP_COMMAND`, filled in by autodetection and
therefore possibly wrong — sit in the middle of the file under the heading
"Project commands", after routing and before execution tuning. Nothing marks
them as the ones autodetection guessed at.

And no individual key says what it is. Section headings group keys by kind of
setting — "Execution", "Project commands" — so `IDLE_TIMEOUT_MINUTES` and
`MAX_STAGES` arrive as bare names with numbers next to them. The only prose in
the file is attached to two of the four sections; the other keys carry nothing
at all. A reader who wants to know what `MAX_STAGES` counts has to leave the
file.

The result is a file whose comments are simultaneously too long and too few:
long where they explain grammar and edge cases, absent where they would say
what a key does.

## Solution

`.lfi/config.env` is rewritten as a file you read top to bottom once, in the
order you would actually work through it after `init`.

Sections are reordered to follow that path: the autodetected project commands
come first, because they are the ones that might be wrong; then agent and model
routing; then execution tuning; then isolation, which most users never touch.
Section headings stay as they are — plain names for kinds of setting.

Every key carries a short trailing comment on its own line saying what it is.
The comment sits after the value, not above it, so the file stays compact and
the description is read together with the number or string it describes.

The routing preamble collapses from three lines to one: the format and an
example. Backward compatibility and empty-value fallback stop being announced;
the fallback is expressed by the trailing comment on `DEFAULT_MODEL`.

Nothing in the file points anywhere else. There are no links to documentation,
no header banner, and no note explaining that reasoning effort is configured as
a suffix rather than a key. The file explains itself in the space it has, and
says nothing it cannot say in one line.

Existing `.lfi/config.env` files are untouched. The new layout applies to
configurations LFI writes from now on.

## User Stories

1. As a user who has just run `lfi init`, I want the first section of
   `.lfi/config.env` to be the commands LFI will run in my project, so that I
   check the autodetected values before anything else.
2. As a user who has just run `lfi init`, I want each key to carry a short
   description next to it, so that I understand the file without opening
   documentation.
3. As a user reading `.lfi/config.env` for the first time, I want the model
   routing preamble to be one line, so that the hardest subject in the file does
   not also occupy the most space.
4. As a user reading `.lfi/config.env`, I want the description of a key to sit
   on the same line as its value, so that the file stays short enough to take in
   at a glance.
5. As a user checking autodetection, I want `BASE_BRANCH` to say that it is the
   branch results land on, so that I can tell whether the detected default
   branch is the one I want.
6. As a user checking autodetection, I want `VALIDATE_COMMAND` to say that it is
   what verifies code before merging, so that I can tell whether the detected
   command is the right gate.
7. As a user checking autodetection, I want `WORKTREE_SETUP_COMMAND` to say that
   it prepares each worktree, so that I understand why it runs repeatedly rather
   than once.
8. As a user configuring routing, I want `DEFAULT_MODEL` to say that it is used
   when a tier is left empty, so that I learn the fallback rule from the key it
   belongs to rather than from a preamble.
9. As a user configuring routing, I want `LIGHT_MODEL`, `STANDARD_MODEL`, and
   `DEEP_MODEL` to each say which kind of work they take, so that I can map my
   own models onto the tiers without consulting the specification.
10. As a user configuring routing, I want `MERGER_MODEL` to say that it handles
    integration and conflicts, so that I understand it is not a fourth tier.
11. As a user tuning execution, I want `MAX_PARALLEL` to say it is how many
    tasks run at once, so that I can relate it to my machine's capacity.
12. As a user tuning execution, I want `MAX_STAGES` to say it caps stages per
    run, so that I know what the number bounds.
13. As a user tuning execution, I want `LOG_RETENTION_DAYS` to say how long logs
    are kept, so that I can connect it to the retention question `init` asked me.
14. As a user tuning execution, I want `IDLE_TIMEOUT_MINUTES` to say it is how
    long an agent may go silent before it is treated as stuck, so that I do not
    read it as a total time limit.
15. As a user reading the isolation setting, I want one line stating that
    `local` sandboxes execution and `none` belongs in an already disposable
    environment, so that the safety trade-off fits in the space it deserves.
16. As a Russian-speaking user, I want the reordered file and its trailing
    comments in Russian, so that the language I chose at `init` still governs
    the whole file.
17. As an English-speaking user, I want the same structure and comments in
    English, so that neither language gets a better-organised file than the
    other.
18. As a user who edits `.lfi/config.env` by hand, I want a value followed by a
    trailing comment to load exactly as the value alone would, so that the new
    comments cannot silently change my configuration.
19. As a user whose command value legitimately contains a `#` character, I want
    that character preserved in the value, so that comment stripping does not
    corrupt my validation or setup command.
20. As a user with an existing `.lfi/config.env`, I want my file left alone when
    I upgrade LFI, so that my hand-written values and edits survive.
21. As a user with an existing prefix-less model value, I want it to keep
    working even though the file no longer mentions backward compatibility, so
    that removing the note does not remove the behaviour.
22. As a user running `lfi init --advanced`, I want the resulting file to use
    the new layout, so that the interactive path and the default path produce
    the same shape of file.
23. As a maintainer, I want the file LFI writes to be re-readable by LFI without
    loss, so that write-then-read stays an identity for every supported value.

## Implementation Decisions

**Seam.** All of this lands at one existing seam: the `serializeEnvConfig` /
`parseEnvConfig` pair in the configuration module. No new seam is introduced.
Section order, section headings, and per-key comments are properties of
serialization; trailing-comment tolerance is a property of parsing. Nothing
outside that pair changes.

**Section order.** Serialization emits project commands, then agent and model
routing, then execution, then isolation. Section headings keep their current
wording in both languages.

**Per-key comments.** Each emitted key line takes the form
`KEY=value # description`. The description is a single short phrase in the
configured language. Descriptions are added for every key the file emits; there
is no key without one.

**Routing preamble.** The three-line routing help collapses to one line stating
the `<cli>:<model>:<reasoning>` format with an example. The backward-compatibility
line and the empty-value fallback line are removed from the file; the fallback
is carried by the `DEFAULT_MODEL` trailing comment. Removing the lines does not
remove either behaviour — prefix-less parsing and tier fallback are unchanged.

**No alignment.** Trailing comments are separated from the value by a single
space and are not padded into a column. `WORKTREE_SETUP_COMMAND` values are
several times longer than the others, so a column would either widen the file
past readability or break the moment a value is edited.

**Parser change.** Parsing must strip a trailing comment before interpreting a
value; today everything after the first `=` is taken verbatim, which would turn
`MAX_PARALLEL=3 # ...` into `NaN` and append comment text to every string value.
A trailing comment is recognised only as an unquoted `#` preceded by whitespace;
a `#` that is not preceded by whitespace stays part of the value. The stripped
value is then trimmed of trailing whitespace. This keeps command values that
embed `#` intact.

**No content that points elsewhere.** The file gains no header banner, no
documentation links, and no note about reasoning effort being expressed as a
model suffix. `REASONING_EFFORT` and `MERGER_REASONING_EFFORT` continue to be
parsed and continue not to be serialized.

**No migration.** Existing `.lfi/config.env` files are not rewritten, and no
command is added to rewrite them. `init` continues to refuse to overwrite an
existing config.

**Key set unchanged.** No key is added, removed, or renamed. Only order,
comments, and comment tolerance change.

## Testing Decisions

A good test here asserts what a user or a later reader of the file can observe:
the order keys appear in, the presence of a comment on a line, and — above all —
that writing then reading a configuration returns the configuration unchanged.
It does not assert exact comment wording, which is copy and will be revised;
asserting the sentences would make the tests a second place to edit prose.

The configuration module is the only module tested. Prior art is
`test/config-and-logs.test.ts`, which already round-trips `DEFAULT_CONFIG`
through `serializeEnvConfig` and `parseEnvConfig` in both the default and `ru`
languages, and already asserts `ISOLATION_PROVIDER` rejection and prefix-less
model handling. New cases join that file.

Cases to cover:

- Round-trip identity for a configuration whose every field is non-default,
  proving trailing comments never leak into values. This is the load-bearing
  test; the parser change exists to make it pass.
- Numeric keys parse to numbers, not `NaN`, when read back from serialized
  output.
- Section order in serialized output: project commands precede routing, routing
  precedes execution, execution precedes isolation.
- Every emitted assignment line carries a `#` after its value.
- A value containing `#` not preceded by whitespace survives a round trip
  intact — the `VALIDATE_COMMAND` case.
- A hand-written line with a trailing comment parses to the same value as the
  same line without one.
- The routing help occupies one comment line, not three.
- Both languages produce the same key order and the same set of commented keys.
- Existing `ru` and default-language round-trip tests continue to pass
  unmodified, confirming no behavioural regression.

## Out of Scope

- Changing which keys exist in the configuration, including surfacing
  `REASONING_EFFORT` or `MERGER_REASONING_EFFORT` as file keys.
- Migrating, rewriting, or regenerating existing `.lfi/config.env` files.
- A `docs/configuration.md` or any other documentation page, and any link from
  the config file to documentation.
- Changing the `lfi init` interactive flow, its questions, or its summary
  output.
- Removing the ru/en split for comment language.
- Removing prefix-less model support or empty-tier fallback; only their mention
  in the file is removed.
- Quoted values, multi-line values, or any broader dotenv-compatibility work
  beyond trailing-comment stripping.

## Further Notes

The trailing-comment format was chosen over comments above each key
specifically for height: fifteen keys with comments above them is a
thirty-line-plus file, which reintroduces the density this spec exists to
remove.

One acknowledged gap: the grilling settled on comments conveying both *what a
key is* and *when to change it*, and a single trailing phrase does not fit both
for most keys. What survives is "what it is", with "when to change it" carried
implicitly by section order and, in one case, explicitly by `DEFAULT_MODEL`'s
description of the fallback. No key is marked "you will never need this" — the
position of the isolation section at the end is the only signal of that kind.

The parser change is the one place where a presentation decision reaches
behaviour. It is small, but it alters how every value in the file is read, so
the round-trip test over a fully non-default configuration is the thing that
must not be skipped.
