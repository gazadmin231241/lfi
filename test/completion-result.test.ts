import assert from "node:assert/strict";
import test from "node:test";

import { extractCompletionResult } from "../src/completion-result.js";

const block = (content: string): string =>
  `<lfi:completion>\n${content}\n</lfi:completion>`;

test("extracts completed and incomplete completion results", () => {
  assert.deepEqual(
    extractCompletionResult(
      block('{"status":"completed","summary":"Implemented and tested."}'),
    ),
    {
      ok: true,
      status: "completed",
      summary: "Implemented and tested.",
    },
  );
  assert.deepEqual(
    extractCompletionResult(
      block('{"status":"incomplete","summary":"Review is still pending."}'),
    ),
    {
      ok: true,
      status: "incomplete",
      summary: "Review is still pending.",
    },
  );
});

test("extracts a completion block surrounded by prose and a markdown fence", () => {
  const output = `I finished the requested work.

\`\`\`json
${block(`{
  "status": "completed",
  "summary": "Implemented."
}`)}
\`\`\`

Let me know if you want more detail.`;

  assert.deepEqual(extractCompletionResult(output), {
    ok: true,
    status: "completed",
    summary: "Implemented.",
  });
});

test("the last completion block wins", () => {
  const output = [
    block('{"status":"incomplete","summary":"Tests pending."}'),
    "Tests now pass.",
    block('{"status":"completed","summary":"Everything passes."}'),
  ].join("\n");

  assert.deepEqual(extractCompletionResult(output), {
    ok: true,
    status: "completed",
    summary: "Everything passes.",
  });
});

test("a malformed last completion block is a contract failure", () => {
  const output = [
    block('{"status":"completed","summary":"Earlier result."}'),
    block('{"status":"completed",'),
  ].join("\n");

  assert.deepEqual(extractCompletionResult(output), {
    ok: false,
    failure: "malformed_json",
    summary: "The last LFI completion block does not contain valid JSON.",
  });
});

test("reports a missing completion block without throwing", () => {
  assert.deepEqual(extractCompletionResult("Work is complete."), {
    ok: false,
    failure: "missing_block",
    summary: "Agent output is missing an LFI completion block.",
  });
});

test("reports malformed JSON without throwing", () => {
  assert.deepEqual(extractCompletionResult(block("not json")), {
    ok: false,
    failure: "malformed_json",
    summary: "The last LFI completion block does not contain valid JSON.",
  });
});

for (const [name, content] of [
  ["null", "null"],
  ["an array", '["completed", "Done."]'],
  ["a missing status", '{"summary":"Done."}'],
  ["a missing summary", '{"status":"completed"}'],
  ["an unknown status", '{"status":"done","summary":"Done."}'],
  ["a non-string summary", '{"status":"completed","summary":42}'],
  [
    "an additional property",
    '{"status":"completed","summary":"Done.","details":"extra"}',
  ],
] as const) {
  test(`reports ${name} as the wrong completion shape without throwing`, () => {
    assert.deepEqual(extractCompletionResult(block(content)), {
      ok: false,
      failure: "invalid_shape",
      summary:
        'The last LFI completion block must contain only string fields "status" ("completed" or "incomplete") and "summary".',
    });
  });
}

test("ignores an unclosed tag after the last complete block", () => {
  const output = `${block(
    '{"status":"completed","summary":"Done."}',
  )}\n<lfi:completion>unfinished`;

  assert.deepEqual(extractCompletionResult(output), {
    ok: true,
    status: "completed",
    summary: "Done.",
  });
});
