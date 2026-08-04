import { open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export interface RunLock {
  release: () => Promise<void>;
}

export interface AcquireRunLockOptions {
  // Seam for tests; defaults to probing the real process table.
  isProcessAlive?: (pid: number) => boolean;
}

// A lock whose payload is not yet readable counts as abandoned only once it is
// older than this, so a holder still writing its pid is never mistaken for
// debris.
const unreadableLockGraceMs = 10_000;

/**
 * Reports whether a pid still has a live process behind it.
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything, so `EPERM` means the process exists under another user. A pid the
 * operating system has since recycled reads as live; that costs a stale lock a
 * later run, which is the failure mode this check already tolerates.
 */
export const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const holderPid = (raw: string): number | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const pid = (parsed as { pid?: unknown }).pid;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0
      ? pid
      : undefined;
  } catch {
    return undefined;
  }
};

const lockAgeMs = async (lockPath: string): Promise<number | undefined> => {
  const stats = await stat(lockPath).catch(() => undefined);
  return stats ? Date.now() - stats.mtimeMs : undefined;
};

const isLockActive = async (
  lockPath: string,
  isAlive: (pid: number) => boolean,
): Promise<boolean> => {
  const raw = await readFile(lockPath, "utf8").catch(() => undefined);
  // The file vanished between the failed create and this read, so whoever held
  // it has already released it.
  if (raw === undefined) return false;
  const pid = holderPid(raw);
  if (pid === undefined) {
    const age = await lockAgeMs(lockPath);
    return age === undefined || age <= unreadableLockGraceMs;
  }
  return pid === process.pid || isAlive(pid);
};

/**
 * Claims the exclusive run lock under `stateRoot`, recording the current pid.
 *
 * Returns `undefined` when a live run already holds it. A lock left behind by a
 * process that no longer exists — an interrupt that skipped cleanup, or a
 * `SIGKILL` that never ran it — is silently reclaimed, so a crashed run cannot
 * bar every later one. Runs on any platform; the caller releases through the
 * returned handle.
 */
export const acquireRunLock = async (
  stateRoot: string,
  runId: string,
  options: AcquireRunLockOptions = {},
): Promise<RunLock | undefined> => {
  const isAlive = options.isProcessAlive ?? isProcessRunning;
  const lockPath = join(stateRoot, "run.lock");
  // Two passes at most: create, and if that lost to a stale file, create again
  // once it is cleared. A second collision means a live competitor won the
  // race, so the lock counts as held.
  for (let attempt = 0; attempt < 2; attempt++) {
    const handle = await open(lockPath, "wx").catch(() => undefined);
    if (handle) {
      // Exclusivity comes from the `wx` create winning, not from holding the
      // descriptor, so it closes here rather than living until release.
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, runId })}\n`,
        );
      } finally {
        await handle.close();
      }
      return { release: () => rm(lockPath, { force: true }) };
    }
    if (await isLockActive(lockPath, isAlive)) return undefined;
    await rm(lockPath, { force: true });
  }
  return undefined;
};
