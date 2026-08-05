import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** A reviewed attempt checkpoint pinned to the commit that was judged. */
export interface AttemptCheckpoint {
  taskId: string;
  /** Tip of the attempt branch at the moment the attempt was accepted. */
  commit: string;
  baseRef: string;
  /** The base the attempt was reviewed against; kept for diagnostics. */
  baseCommit: string;
  recordedAt: string;
  /** Reviewed checkpoints resume validation; validated ones may integrate. */
  status: "reviewed" | "validated";
}

const acceptedAttemptsPath = (stateRoot: string): string =>
  join(stateRoot, "accepted-attempts.json");

const parseAttemptCheckpoint = (
  value: unknown,
): AttemptCheckpoint | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!(
    typeof record.taskId === "string" &&
    typeof record.commit === "string" &&
    record.commit !== "" &&
    typeof record.baseRef === "string" &&
    typeof record.baseCommit === "string" &&
    typeof record.recordedAt === "string"
  )) return undefined;
  let status: AttemptCheckpoint["status"];
  if (record.status === "reviewed" || record.status === "validated") {
    status = record.status;
  } else if (record.status !== undefined) {
    return undefined;
  } else if (
    record.validationPending !== undefined &&
    typeof record.validationPending !== "boolean"
  ) {
    return undefined;
  } else {
    status = record.validationPending === true ? "reviewed" : "validated";
  }
  return {
    taskId: record.taskId,
    commit: record.commit,
    baseRef: record.baseRef,
    baseCommit: record.baseCommit,
    recordedAt: record.recordedAt,
    status,
  };
};

/**
 * Reads every reviewed checkpoint still awaiting validation or delivery,
 * keyed by task id. The accepted-attempts filename is retained for on-disk
 * compatibility.
 *
 * A missing, unreadable or malformed file reads as "nothing recorded": the
 * records are an optimization, and a corrupt one must never bar a run.
 */
export const readAttemptCheckpoints = async (
  stateRoot: string,
): Promise<Record<string, AttemptCheckpoint>> => {
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
  const records: Record<string, AttemptCheckpoint> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const checkpoint = parseAttemptCheckpoint(value);
    if (checkpoint) records[id] = checkpoint;
  }
  return records;
};

const writeAttemptCheckpoints = async (
  stateRoot: string,
  records: Record<string, AttemptCheckpoint>,
): Promise<void> => {
  const path = acceptedAttemptsPath(stateRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(records, null, 2)}\n`);
};

export const readAttemptCheckpoint = async (
  stateRoot: string,
  taskId: string,
): Promise<AttemptCheckpoint | undefined> =>
  (await readAttemptCheckpoints(stateRoot))[taskId];

export const recordAttemptCheckpoint = async (
  stateRoot: string,
  attempt: AttemptCheckpoint,
): Promise<void> => {
  const records = await readAttemptCheckpoints(stateRoot);
  records[attempt.taskId] = attempt;
  await writeAttemptCheckpoints(stateRoot, records);
};

export const forgetAttemptCheckpoint = async (
  stateRoot: string,
  taskId: string,
): Promise<void> => {
  const records = await readAttemptCheckpoints(stateRoot);
  if (!(taskId in records)) return;
  delete records[taskId];
  await writeAttemptCheckpoints(stateRoot, records);
};
