import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCommand } from "../src/process.js";

const cliPath = join(process.cwd(), "src", "cli.ts");
const tsxPath = join(process.cwd(), "node_modules", ".bin", "tsx");

test("removed GitHub tracker commands are unknown in both languages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lfi-removed-commands-"));

  for (const [language, expected] of [
    ["en", "Unknown command"],
    ["ru", "Неизвестная команда"],
  ] as const) {
    for (const command of [["migrate", "local"], ["sync"]]) {
      const result = await runCommand(
        tsxPath,
        [cliPath, "--lang", language, ...command],
        { cwd, env: { ...process.env, XDG_CONFIG_HOME: cwd } },
      );

      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, new RegExp(`${expected}: ${command[0]}`, "u"));
      assert.doesNotMatch(result.stderr, /configuration|конфигурац|GitHub/iu);
    }
  }
});
