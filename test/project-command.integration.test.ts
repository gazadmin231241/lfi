import assert from "node:assert/strict";
import test from "node:test";

import { gitCommonDirectory } from "../src/git.js";
import { runProjectCommand } from "../src/project-command.js";

test(
  "local isolation runs dependency installation and a test command",
  { skip: process.platform !== "linux" },
  async () => {
    const result = await runProjectCommand({
      command:
        "pnpm install --offline --frozen-lockfile && pnpm exec tsx --test test/completion-result.test.ts",
      cwd: process.cwd(),
      gitDirectory: await gitCommonDirectory(process.cwd()),
      isolationProvider: "local",
    });

    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /tests 14/u);
  },
);
