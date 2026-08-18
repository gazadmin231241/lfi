import assert from "node:assert/strict";
import test from "node:test";

import { apply, internals, name } from "../dsh-plugin/index.js";

/** A minimal Cordis-like context that records listeners by event name. */
const fakeContext = () => {
  const listeners = new Map<string, Function>();
  return {
    ctx: {
      on(event: string, listener: Function) {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      },
    },
    listeners,
  };
};

const capture = () => {
  const chunks: string[] = [];
  return { chunks, stream: { write: (chunk: string) => { chunks.push(chunk); return true; } } };
};

test("the bundle exports a stable Cordis plugin name", () => {
  assert.equal(name, "lfi-stream");
});

test("assistant/message is streamed as one JSON line with tool blocks dropped", () => {
  const { ctx, listeners } = fakeContext();
  const { chunks, stream } = capture();
  const originalStdout = internals.stdout;
  internals.stdout = stream;
  try {
    apply(ctx);
    const onSessionEvent = listeners.get("session/event");
    assert.ok(onSessionEvent);
    onSessionEvent!(undefined, {
      type: "assistant/message",
      seq: 6,
      time: 6000,
      data: {
        message: {
          content: [
            { type: "text", text: "Проверяю dsh." },
            { type: "reasoning", text: "Планирую." },
            { type: "tool_call", name: "bash", arguments: "{}" },
            { type: "tool_result", content: "whole file body" },
          ],
        },
      },
    });
  } finally {
    internals.stdout = originalStdout;
  }

  assert.equal(chunks.length, 1);
  const parsed = JSON.parse(chunks[0]!);
  assert.equal(parsed.type, "assistant/message");
  assert.equal(parsed.seq, 6);
  assert.equal(parsed.time, 6000);
  assert.deepEqual(parsed.data.message.content, [
    { type: "text", text: "Проверяю dsh." },
    { type: "reasoning", text: "Планирую." },
  ]);
});

test("assistant/chunk and other unlisted event types write nothing", () => {
  const { ctx, listeners } = fakeContext();
  const { chunks, stream } = capture();
  const originalStdout = internals.stdout;
  internals.stdout = stream;
  try {
    apply(ctx);
    const onSessionEvent = listeners.get("session/event");
    onSessionEvent!(undefined, {
      type: "assistant/chunk",
      seq: 1,
      time: 1,
      data: { chunk: { type: "text-delta" } },
    });
    onSessionEvent!(undefined, {
      type: "request/header",
      seq: 2,
      time: 2,
      data: {},
    });
  } finally {
    internals.stdout = originalStdout;
  }

  assert.deepEqual(chunks, []);
});

test("long reasoning and tool arguments are truncated with an ellipsis", () => {
  const { ctx, listeners } = fakeContext();
  const { chunks, stream } = capture();
  const originalStdout = internals.stdout;
  internals.stdout = stream;
  try {
    apply(ctx);
    const onSessionEvent = listeners.get("session/event");
    onSessionEvent!(undefined, {
      type: "assistant/message",
      seq: 1,
      time: 1,
      data: {
        message: {
          content: [{ type: "reasoning", text: "x".repeat(2500) }],
        },
      },
    });
    onSessionEvent!(undefined, {
      type: "tool/call",
      seq: 2,
      time: 2,
      data: { name: "str_replace_editor", arguments: "y".repeat(4500) },
    });
  } finally {
    internals.stdout = originalStdout;
  }

  assert.equal(chunks.length, 2);
  const message = JSON.parse(chunks[0]!);
  const reasoningText = message.data.message.content[0].text as string;
  assert.equal(reasoningText.length, 2000);
  assert.equal(reasoningText.endsWith("…"), true);

  const toolCall = JSON.parse(chunks[1]!);
  const argumentsText = toolCall.data.arguments as string;
  assert.equal(argumentsText.length, 4000);
  assert.equal(argumentsText.endsWith("…"), true);
});

test("the tool denial gate is registered only when LFI_DSH_DENIED_TOOLS is set", () => {
  const originalDenied = process.env.LFI_DSH_DENIED_TOOLS;
  try {
    delete process.env.LFI_DSH_DENIED_TOOLS;
    const { ctx, listeners } = fakeContext();
    apply(ctx);
    assert.equal(listeners.has("tools/pre-execute"), false);
  } finally {
    if (originalDenied === undefined) delete process.env.LFI_DSH_DENIED_TOOLS;
    else process.env.LFI_DSH_DENIED_TOOLS = originalDenied;
  }
});

test("the tool denial gate denies a listed tool and delegates for others", async () => {
  const originalDenied = process.env.LFI_DSH_DENIED_TOOLS;
  try {
    process.env.LFI_DSH_DENIED_TOOLS = "web_search, todo_write";
    const { ctx, listeners } = fakeContext();
    apply(ctx);
    const onPreExecute = listeners.get("tools/pre-execute");
    assert.ok(onPreExecute);

    const next = async () => ({ kind: "allow" as const });
    const denied = await onPreExecute!({ name: "web_search" }, next);
    assert.deepEqual(denied, {
      kind: "deny",
      reason: "web_search is withheld from this run by LFI",
    });

    const allowed = await onPreExecute!({ name: "bash" }, next);
    assert.deepEqual(allowed, { kind: "allow" });
  } finally {
    if (originalDenied === undefined) delete process.env.LFI_DSH_DENIED_TOOLS;
    else process.env.LFI_DSH_DENIED_TOOLS = originalDenied;
  }
});
