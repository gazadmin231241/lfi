export const completionBlockOpen = "<lfi:completion>";
export const completionBlockClose = "</lfi:completion>";

export type CompletionStatus = "completed" | "incomplete";

export type CompletionResult =
  | {
      ok: true;
      status: CompletionStatus;
      summary: string;
    }
  | {
      ok: false;
      failure: "missing_block" | "malformed_json" | "invalid_shape";
      summary: string;
    };

const escapePattern = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const completionBlockPattern = new RegExp(
  `${escapePattern(completionBlockOpen)}([\\s\\S]*?)${escapePattern(completionBlockClose)}`,
  "gu",
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCompletionStatus = (value: unknown): value is CompletionStatus =>
  value === "completed" || value === "incomplete";

export const extractCompletionResult = (output: string): CompletionResult => {
  const blocks = [...output.matchAll(completionBlockPattern)];
  const content = blocks.at(-1)?.[1];
  if (content === undefined) {
    return {
      ok: false,
      failure: "missing_block",
      summary: "Agent output is missing an LFI completion block.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      failure: "malformed_json",
      summary: "The last LFI completion block does not contain valid JSON.",
    };
  }

  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== 2 ||
    !isCompletionStatus(parsed.status) ||
    typeof parsed.summary !== "string"
  ) {
    return {
      ok: false,
      failure: "invalid_shape",
      summary:
        'The last LFI completion block must contain only string fields "status" ("completed" or "incomplete") and "summary".',
    };
  }

  return {
    ok: true,
    status: parsed.status,
    summary: parsed.summary,
  };
};
