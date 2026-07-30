import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const saveRunSummary = async (
  stateRoot: string,
  runId: string,
  summary: object,
): Promise<void> => {
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  await writeFile(join(stateRoot, "last-run.json"), serialized);
  const historyRoot = join(stateRoot, "history");
  await mkdir(historyRoot, { recursive: true });
  await writeFile(join(historyRoot, `${runId}.json`), serialized);
  const history = (await readdir(historyRoot)).sort();
  for (const old of history.slice(0, Math.max(0, history.length - 50))) {
    await rm(join(historyRoot, old), { force: true });
  }
};
