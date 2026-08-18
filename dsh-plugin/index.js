/**
 * dsh-lfi-stream — the bundle LFI mounts over `@deepseek-ai/dsh-headless`.
 *
 * The shipped one-shot runner prints only the last assistant text, which tells
 * a supervising process nothing until the run is over. This plugin subscribes
 * to the durable `session/event` firehose and writes the events LFI parses as
 * newline-delimited JSON on stdout, one event per line. It leaves the shipped
 * runner in place: that runner still owns agent creation and the exit code, and
 * its final plain-text line is simply not JSON, so LFI skips it.
 *
 * It also denies the tools LFI withheld. `ctx.tools.restrict()` would hide them
 * from the model outright but throws outside an agent scope, so the denial is a
 * `tools/pre-execute` gate instead: the model still sees the tool and learns it
 * is refused when it calls it.
 *
 * Configuration is environment-only, because a bundle patch layer is static
 * while LFI varies its settings per attempt.
 *
 * @module dsh-lfi-stream
 */

/** Stable Cordis plugin name. */
export const name = 'lfi-stream'

/** The process stream the events are written to; tests substitute a capture. */
export const internals = { stdout: process.stdout }

/**
 * Durable events LFI reads. `assistant/chunk` is deliberately absent: it repeats
 * the same text token by token, and `request/header` carries the whole composed
 * request.
 */
const STREAMED_EVENTS = new Set([
  'turn/start',
  'turn/end',
  'assistant/message',
  'tool/call',
])

/** Reasoning is summarized to a headline upstream; the rest is log weight. */
const REASONING_LIMIT = 2000
/** Tool arguments carry whole file bodies on an edit. */
const ARGUMENTS_LIMIT = 4000

/**
 * Bound one field without losing that it was cut.
 * @param {string} text - the field value.
 * @param {number} limit - maximum kept characters.
 * @returns {string} the value, truncated with an ellipsis when over the limit.
 */
const truncate = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text

/**
 * Keep the assistant blocks a supervising process can act on. Tool-call blocks
 * repeat the `tool/call` event, and tool results can carry a whole file.
 * @param {{ content?: unknown[] }} message - the assembled assistant message.
 * @returns {object} the message with its content projected.
 */
const projectMessage = (message) => ({
  ...message,
  content: (Array.isArray(message?.content) ? message.content : []).flatMap((block) => {
    if (block?.type === 'text') return [{ type: 'text', text: String(block.text ?? '') }]
    if (block?.type === 'reasoning') {
      return [{ type: 'reasoning', text: truncate(String(block.text ?? ''), REASONING_LIMIT) }]
    }
    return []
  }),
})

/**
 * Project one durable event onto the payload LFI parses.
 * @param {{ type: string, data: object }} event - the appended session event.
 * @returns {object} the projected event data.
 */
const projectEvent = (event) => {
  if (event.type === 'assistant/message') {
    return { ...event.data, message: projectMessage(event.data.message) }
  }
  if (event.type === 'tool/call') {
    return { ...event.data, arguments: truncate(String(event.data.arguments ?? ''), ARGUMENTS_LIMIT) }
  }
  return event.data
}

/**
 * Read a comma-separated environment list.
 * @param {NodeJS.ProcessEnv} environment - the process environment.
 * @param {string} variable - the variable name.
 * @returns {Set<string>} the non-empty trimmed entries.
 */
const environmentList = (environment, variable) =>
  new Set(
    (environment[variable] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )

/**
 * Mount the event stream and the tool denial gate.
 * @param {import('./index.js').PluginContext} ctx - plugin context.
 */
export function apply(ctx) {
  const stdout = internals.stdout
  ctx.on('session/event', (_session, event) => {
    if (!STREAMED_EVENTS.has(event.type)) return
    let line
    try {
      line = JSON.stringify({
        type: event.type,
        seq: event.seq,
        time: event.time,
        data: projectEvent(event),
      })
    } catch {
      // An event whose data cannot be serialized must not take the run down;
      // the supervising process reads what it can and the run keeps going.
      return
    }
    stdout.write(`${line}\n`)
  })

  const denied = environmentList(process.env, 'LFI_DSH_DENIED_TOOLS')
  if (denied.size === 0) return
  ctx.on('tools/pre-execute', async (exec, next) =>
    denied.has(exec.name)
      ? { kind: 'deny', reason: `${exec.name} is withheld from this run by LFI` }
      : next())
}
