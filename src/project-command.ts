import { homedir } from "node:os";

import { defaultAgentProvider, type AgentProvider } from "./agent-provider.js";
import {
  openIsolationSession,
  withIsolationSession,
  type IsolationProvider,
  type IsolationSession,
} from "./isolation-provider.js";
import type { CommandResult } from "./process.js";

export const runProjectCommand = async (options: {
  command: string;
  cwd: string;
  gitDirectory: string;
  isolationProvider: IsolationProvider;
  agent?: AgentProvider;
  session?: IsolationSession;
}): Promise<CommandResult> => {
  const run = async (session: IsolationSession): Promise<CommandResult> => {
    return await session.run({
      command: process.env.SHELL || "/bin/sh",
      args: ["-lc", options.command],
      input: "",
      idleTimeoutMs: 0,
      onStdoutLine: () => undefined,
      onStderrLine: () => undefined,
      environment: process.env,
    });
  };
  if (options.session) return await run(options.session);
  return await withIsolationSession(
    () => openIsolationSession({
      provider: options.isolationProvider,
      agent: options.agent ?? defaultAgentProvider,
      worktree: options.cwd,
      gitDirectory: options.gitDirectory,
      homeDirectory: homedir(),
      environment: process.env,
    }),
    run,
  );
};
