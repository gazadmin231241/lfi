import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export const pruneExpiredRunLogs = async (
  logsRoot: string,
  options: {
    retentionDays: number;
    activeRunName?: string;
    now?: Date;
  },
): Promise<string[]> => {
  if (options.retentionDays === 0) return [];
  const entries = await readdir(logsRoot, { withFileTypes: true }).catch(() => []);
  const cutoff =
    (options.now ?? new Date()).getTime() -
    options.retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === options.activeRunName) continue;
    const path = join(logsRoot, entry.name);
    const metadata = await stat(path);
    if (metadata.mtimeMs >= cutoff) continue;
    await rm(path, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed.sort();
};
