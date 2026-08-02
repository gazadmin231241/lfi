import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  openIsolationSession,
} from "../src/isolation-provider.js";
import { runCommand, runCommandLines } from "../src/process.js";

test(
  "local boundary runs a linked worktree with writable Git metadata and network",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(join(process.cwd(), ".lfi-real-isolation-"));
    const repository = join(root, "repository");
    const worktree = join(root, "task-worktree");
    const outside = join(root, "outside.txt");
    const deviceMarker = `/dev/shm/lfi-isolation-${process.pid}`;
    await mkdir(repository);
    await writeFile(outside, "host\n");
    await writeFile(deviceMarker, "host device\n");
    const git = async (...args: string[]) => {
      const result = await runCommand("git", args, { cwd: repository });
      assert.equal(result.exitCode, 0, result.stderr);
    };
    try {
      await git("init", "-b", "main");
      await git("config", "user.name", "LFI Test");
      await git("config", "user.email", "lfi@example.test");
      await git(
        "config",
        "remote.origin.url",
        "https://code-host-test-value@example.test/project.git",
      );
      await writeFile(join(repository, "tracked.txt"), "base\n");
      await git("add", "tracked.txt");
      await git("commit", "-m", "test: initialize boundary repository");
      await git("worktree", "add", "-b", "boundary-test", worktree);
      const gitDirectory = join(repository, ".git");
      const isolation = await openIsolationSession({
        provider: "local",
        worktree,
        gitDirectory,
        homeDirectory: homedir(),
        environment: {
          ...process.env,
          GH_TOKEN: "code-host-test-value",
          GIT_CONFIG_PARAMETERS:
            "'http.https://example.test/.extraheader=authorization: test'",
        },
        identity: { name: "LFI Test", email: "lfi@example.test" },
      });
      const lines: string[] = [];
      const invocation = isolation.prepare({
          command: "/bin/sh",
          args: [
            "-c",
            `set -eu
git rev-parse --git-common-dir >/dev/null
printf 'worktree write\n' > boundary-written.txt
printf 'git metadata write' | git hash-object -w --stdin >/dev/null
git add boundary-written.txt
git commit -m 'test: commit through isolation boundary' >/dev/null
if printf 'outside write\n' 2>/dev/null > '${outside}'; then exit 41; fi
test ! -e '${deviceMarker}'
test -z "\${GH_TOKEN-}"
test -z "\${GIT_CONFIG_PARAMETERS-}"
test -z "$(git config --get remote.origin.url || true)"
getent hosts registry.npmjs.org >/dev/null
printf 'boundary-ok\n'`,
          ],
          input: "",
          idleTimeoutMs: 30_000,
          onStdoutLine: (line) => lines.push(line),
          onStderrLine: (line) => lines.push(line),
          environment: process.env,
        });
      const result = await runCommandLines(invocation.command, invocation.args, {
        cwd: worktree,
        input: invocation.input,
        idleTimeoutMs: invocation.idleTimeoutMs,
        onStdoutLine: invocation.onStdoutLine,
        onStderrLine: invocation.onStderrLine,
        env: invocation.environment,
      });

      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(lines, ["boundary-ok"]);
      assert.equal(
        await readFile(join(worktree, "boundary-written.txt"), "utf8"),
        "worktree write\n",
      );
      const committed = await runCommand("git", ["log", "-1", "--format=%s"], {
        cwd: worktree,
      });
      assert.equal(committed.exitCode, 0, committed.stderr);
      assert.equal(committed.stdout.trim(), "test: commit through isolation boundary");
      assert.equal(await readFile(outside, "utf8"), "host\n");
      await isolation.close();
    } finally {
      await rm(deviceMarker, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  },
);
