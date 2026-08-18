# `dsh-lfi-stream`

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that
makes a headless `dsh` run observable to LFI. It is installed into the `lfi`
profile by `lfi init`; nothing here is published to npm.

## Why it exists

`dsh --profile headless "task"` prints only the last assistant text and exits
0 or 1. LFI needs the run's events as they happen: assistant messages (its
completion block rides in one), reasoning headlines, shell commands, token
usage, and why the turn ended.

Those all exist inside dsh as durable `session/event` appends. This bundle
subscribes to that firehose and writes the ones LFI reads to stdout as
newline-delimited JSON, one event per line:

```json
{"type":"tool/call","seq":7,"time":1755400000000,"data":{"turn":1,"step":1,"callId":"…","name":"bash","arguments":"{\"command\":\"pnpm test\"}"}}
```

The shipped `headless-runner` row stays mounted and keeps owning agent creation,
quiescence, and the exit code. Its final plain-text line is not JSON, so LFI's
parser skips it.

`assistant/chunk` is deliberately not streamed (it repeats the same text token by
token), reasoning is truncated to 2000 characters, and tool arguments to 4000.

## What it configures

A bundle patch layer is static, so per-attempt settings arrive through the
environment, which the patch's `!!js` expressions read on every boot:

| Variable | Effect |
|---|---|
| `LFI_DSH_MODEL` | the `agent-default-model` row's model, verbatim |
| `LFI_DSH_REASONING` | the DeepSeek adapter's `reasoningEffort` (`off`/`low`/`high`/`max`) |
| `LFI_DSH_DENIED_TOOLS` | comma-separated tool names refused before dispatch |

The denial is a `tools/pre-execute` gate rather than `ctx.tools.restrict()`,
which throws outside an agent scope. The consequence is that a denied tool stays
visible to the model and is refused when called, instead of being absent from the
request.

## Pinned upstream

Written against `dsh` **0.1.0-rc.7**
([`99f6f02`](https://github.com/deepseek-ai/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca)).
The harness is a developer preview that promises compatibility-breaking changes,
so LFI installs that exact version. The surfaces used here are `session/event`,
`tools/pre-execute`, and the bundle/patch layering; see
[`docs/research/deepseek-harness-plugin-integration.md`](../docs/research/deepseek-harness-plugin-integration.md).
