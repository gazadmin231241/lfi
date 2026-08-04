import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * An attempt that passed review and validation, pinned to the commit that was
 * judged. The record outlives the process so a delivery failure cannot cost the
 * accepted work a second full attempt.
 */
export interface AcceptedAttempt {
  taskId: string;
  /** Tip of the attempt branch at the moment the attempt was accepted. */
  commit: string;
  baseRef: string;
  /** The base the attempt was reviewed against; kept for diagnostics. */
  baseCommit: string;
  recordedAt: string;
}

const acceptedAttemptsPath = (stateRoot: string): string =>
  join(stateRoot, "accepted-attempts.json");

const isAcceptedAttempt = (value: unknown): value is AcceptedAttempt => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.taskId === "string" &&
    typeof record.commit === "string" &&
    record.commit !== "" &&
    typeof record.baseRef === "string" &&
    typeof record.baseCommit === "string" &&
    typeof record.recordedAt === "string"
  );
};

/**
 * Reads every accepted attempt still awaiting delivery, keyed by task id.
 *
 * A missing, unreadable or malformed file reads as "nothing recorded": the
 * records are an optimization, and a corrupt one must never bar a run.
 */
export const readAcceptedAttempts = async (
  stateRoot: string,
): Promise<Record<string, AcceptedAttempt>> => {
  const raw = await readFile(acceptedAttemptsPath(stateRoot), "utf8").catch(
    () => undefined,
  );
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const records: Record<string, AcceptedAttempt> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isAcceptedAttempt(value)) records[id] = value;
  }
  return records;
};

const writeAcceptedAttempts = async (
  stateRoot: string,
  records: Record<string, AcceptedAttempt>,
): Promise<void> => {
  const path = acceptedAttemptsPath(stateRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(records, null, 2)}\n`);
};

export const readAcceptedAttempt = async (
  stateRoot: string,
  taskId: string,
): Promise<AcceptedAttempt | undefined> =>
  (await readAcceptedAttempts(stateRoot))[taskId];

export const recordAcceptedAttempt = async (
  stateRoot: string,
  attempt: AcceptedAttempt,
): Promise<void> => {
  const records = await readAcceptedAttempts(stateRoot);
  records[attempt.taskId] = attempt;
  await writeAcceptedAttempts(stateRoot, records);
};

export const forgetAcceptedAttempt = async (
  stateRoot: string,
  taskId: string,
): Promise<void> => {
  const records = await readAcceptedAttempts(stateRoot);
  if (!(taskId in records)) return;
  delete records[taskId];
  await writeAcceptedAttempts(stateRoot, records);
};
