import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  resolveIsolationConfiguration,
  sanitizeAgentEnvironment,
  wrapWithIsolation,
  type IsolationProvider,
} from "./isolation-provider.js";
import { runCommand, type CommandResult } from "./process.js";

export const runProjectCommand = async (options: {
  command: string;
  cwd: string;
  gitDirectory: string;
  isolationProvider: IsolationProvider;
}): Promise<CommandResult> => {
  const artifacts = await mkdtemp(join(options.gitDirectory, "lfi-project-"));
  const sanitizedGitConfig = join(artifacts, "safe-git-config");
  try {
    await writeFile(sanitizedGitConfig, "");
    const isolation = await resolveIsolationConfiguration({
      provider: options.isolationProvider,
      worktree: options.cwd,
      gitDirectory: options.gitDirectory,
      homeDirectory: homedir(),
      sanitizedGitConfig,
    });
    const invocation = wrapWithIsolation(
      {
        command: process.env.SHELL || "/bin/sh",
        args: ["-lc", options.command],
        input: "",
        idleTimeoutMs: 0,
        onStdoutLine: () => undefined,
        onStderrLine: () => undefined,
        environment:
          options.isolationProvider === "none"
            ? process.env
            : sanitizeAgentEnvironment(process.env),
      },
      isolation,
    );
    return await runCommand(invocation.command, invocation.args, {
      cwd: options.cwd,
      input: invocation.input,
      idleTimeoutMs: invocation.idleTimeoutMs,
      env: invocation.environment,
    });
  } finally {
    await rm(artifacts, { recursive: true, force: true });
  }
};
