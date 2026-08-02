import { spawn } from "node:child_process";

const activeChildren = new Set<ReturnType<typeof spawn>>();
let shutdownRequested = false;

export const requestShutdown = (): void => {
  shutdownRequested = true;
  for (const child of activeChildren) child.kill("SIGTERM");
};

export const isShutdownRequested = (): boolean => shutdownRequested;

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  idleTimeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export const runCommand = (
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    if (shutdownRequested) {
      resolve({ exitCode: 130, stdout: "", stderr: "Interrupted" });
      return;
    }
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    activeChildren.add(child);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error);
    });
    let stdout = "";
    let stderr = "";
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdle = () => {
      if (!options.idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => child.kill("SIGTERM"), options.idleTimeoutMs);
    };
    resetIdle();
    child.stdout.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      stdout += chunk;
      options.onStdout?.(chunk);
      resetIdle();
    });
    child.stderr.on("data", (buffer: Buffer) => {
      const chunk = buffer.toString();
      stderr += chunk;
      options.onStderr?.(chunk);
      resetIdle();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      activeChildren.delete(child);
      if (idleTimer) clearTimeout(idleTimer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });

export const requireCommand = async (
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> => {
  const result = await runCommand(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.exitCode})\n${result.stderr || result.stdout}`,
    );
  }
  return result;
};

export interface LineCommandOptions
  extends Omit<CommandOptions, "onStdout" | "onStderr"> {
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
}

export const runCommandLines = async (
  command: string,
  args: readonly string[],
  options: LineCommandOptions,
): Promise<CommandResult> => {
  let stdoutBuffer = "";
  let stderrBuffer = "";
  const emitLines = (
    chunk: string,
    buffer: string,
    emit: (line: string) => void,
  ): string => {
    const lines = `${buffer}${chunk}`.split("\n");
    const remainder = lines.pop() ?? "";
    for (const line of lines) emit(line);
    return remainder;
  };
  const result = await runCommand(command, args, {
    ...options,
    onStdout: (chunk) => {
      stdoutBuffer = emitLines(chunk, stdoutBuffer, options.onStdoutLine);
    },
    onStderr: (chunk) => {
      stderrBuffer = emitLines(chunk, stderrBuffer, options.onStderrLine);
    },
  });
  if (stdoutBuffer) options.onStdoutLine(stdoutBuffer);
  if (stderrBuffer) options.onStderrLine(stderrBuffer);
  return result;
};

export const runShell = (
  command: string,
  options: CommandOptions = {},
): Promise<CommandResult> =>
  runCommand(process.env.SHELL || "/bin/sh", ["-lc", command], options);
