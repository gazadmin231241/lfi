import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const activeChildren = new Set<ReturnType<typeof spawn>>();
// How long a child may take to exit after an abort before it is force-killed
// and the command settles regardless of the pipes it left behind.
const killGraceMs = 2_000;
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
  // Agent JSON streams reach hundreds of megabytes per run, so a caller that
  // consumes them chunk by chunk can decline the accumulated copy.
  captureStdout?: boolean;
  // Terminates the child once the caller has everything it needs, for agents
  // that keep their process alive after their final answer.
  signal?: AbortSignal;
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
    let settled = false;
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error);
    });
    let stdout = "";
    let stderr = "";
    // A multi-byte character can straddle two chunks; decoding each chunk on
    // its own would replace the split halves with U+FFFD.
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let idleTimer: NodeJS.Timeout | undefined;
    const resetIdle = () => {
      if (!options.idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => child.kill("SIGTERM"), options.idleTimeoutMs);
    };
    resetIdle();
    child.stdout.on("data", (buffer: Buffer) => {
      resetIdle();
      const chunk = stdoutDecoder.write(buffer);
      if (!chunk) return;
      if (options.captureStdout !== false) stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on("data", (buffer: Buffer) => {
      resetIdle();
      const chunk = stderrDecoder.write(buffer);
      if (!chunk) return;
      stderr += chunk;
      options.onStderr?.(chunk);
    });
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      activeChildren.delete(child);
      options.signal?.removeEventListener("abort", stop);
      if (idleTimer) clearTimeout(idleTimer);
      const stdoutTail = stdoutDecoder.end();
      if (stdoutTail) {
        if (options.captureStdout !== false) stdout += stdoutTail;
        options.onStdout?.(stdoutTail);
      }
      const stderrTail = stderrDecoder.end();
      if (stderrTail) {
        stderr += stderrTail;
        options.onStderr?.(stderrTail);
      }
      // Detach from pipes a grandchild may still hold, so nothing keeps the
      // event loop alive after the command has settled.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve({ exitCode: code, stdout, stderr });
    };
    // A killed child can leave grandchildren holding its pipes open, and
    // "close" waits for those, so an aborted command settles on its own.
    function stop(): void {
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
        finish(child.exitCode ?? 143);
      }, killGraceMs).unref();
    }
    if (options.signal?.aborted) stop();
    else options.signal?.addEventListener("abort", stop, { once: true });
    child.on("error", reject);
    child.on("close", (code) => finish(code ?? 1));
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
