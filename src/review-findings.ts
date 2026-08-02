export type ReviewFindingAxis = "standards" | "spec";
export type ReviewFindingSeverity = "blocking" | "advisory";

export interface ReviewFinding {
  axis: ReviewFindingAxis;
  severity: ReviewFindingSeverity;
  description: string;
}

const invalidFindings = (): Error => new Error("Invalid review findings JSON.");

const parseFinding = (value: unknown): ReviewFinding => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidFindings();
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("axis") ||
    !keys.includes("severity") ||
    !keys.includes("description") ||
    !("axis" in value) ||
    !("severity" in value) ||
    !("description" in value)
  ) {
    throw invalidFindings();
  }
  const { axis, severity, description } = value;
  if (
    (axis !== "standards" && axis !== "spec") ||
    (severity !== "blocking" && severity !== "advisory") ||
    typeof description !== "string"
  ) {
    throw invalidFindings();
  }
  return { axis, severity, description };
};

export const parseReviewFindings = (source: string): ReviewFinding[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw invalidFindings();
  }
  if (!Array.isArray(parsed)) throw invalidFindings();
  return parsed.map(parseFinding);
};
