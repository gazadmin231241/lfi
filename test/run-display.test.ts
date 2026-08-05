import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { printRunSummary } from "../src/run-display.js";

test("run summary distinguishes pending validation repair from incomplete work", async () => {
  const messages: string[] = [];
  const logs = await mkdtemp(join(tmpdir(), "lfi-run-summary-"));
  await writeFile(join(logs, "LFI-2-validation.log"), "diagnostic\n");
  await printRunSummary(
    {
      log: (message) => messages.push(message),
      error: (message) => messages.push(message),
      flush: async () => undefined,
    },
    "en",
    ["LFI-1"],
    [
      ["LFI-2", "validation remains red"],
      ["LFI-3", "worker failed"],
    ],
    logs,
    new Set(["LFI-2"]),
  );

  const summary = messages.join("\n");
  assert.match(summary, /Validation repair pending: LFI-2/u);
  assert.match(summary, /Incomplete: LFI-3/u);
  assert.doesNotMatch(summary, /Incomplete: LFI-2/u);
  assert.match(summary, /Log: \.lfi\/logs\/LFI-2-validation\.log/u);
});
