import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closeIssue, setIssueStatus } from "../src/github.js";

test("GitHub task status transitions use explicit title prefixes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfi-github-status-"));
  const bin = join(root, "bin");
  const calls = join(root, "calls");
  await mkdir(bin);
  await writeFile(
    join(bin, "gh"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
case "$*" in
  *"issue view"*) printf '%s\\n' '[RUNNING] LFI-2 — Build parser' ;;
esac
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  try {
    await setIssueStatus(root, 2, "running", "[READY] LFI-2 — Build parser");
    await setIssueStatus(root, 2, "blocked", "[READY] LFI-2 — Build parser");
    await closeIssue(root, 2, "abc123", "en");
  } finally {
    process.env.PATH = previousPath;
  }

  const output = await readFile(calls, "utf8");
  assert.match(output, /issue edit 2 --title \[RUNNING\] LFI-2 — Build parser/u);
  assert.match(output, /issue edit 2 --title \[BLOCKED\] LFI-2 — Build parser/u);
  assert.match(output, /issue edit 2 --title \[DONE\] LFI-2 — Build parser/u);
  assert.match(output, /issue close 2 --comment Completed by LFI/u);
});
