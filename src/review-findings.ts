export type ReviewFindingAxis = "standards" | "spec";
export type ReviewFindingSeverity = "blocking" | "advisory";

export interface ReviewFinding {
  axis: ReviewFindingAxis;
  severity: ReviewFindingSeverity;
  description: string;
  failureScenario?: string;
  degradedFromBlocking?: true;
}

export type VerificationVerdictValue = "resolved" | "unresolved";

export interface VerificationVerdict {
  verdict: VerificationVerdictValue;
  rationale: string;
}

const invalidFindings = (): Error => new Error("Invalid review findings JSON.");
const invalidVerdicts = (): Error => new Error("Invalid verification verdicts JSON.");

const parseFinding = (value: unknown): ReviewFinding => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidFindings();
  }
  const keys = Object.keys(value);
  const hasFailureScenario = "failureScenario" in value;
  if (
    keys.length !== (hasFailureScenario ? 4 : 3) ||
    !keys.includes("axis") ||
    !keys.includes("severity") ||
    !keys.includes("description") ||
    !("axis" in value) ||
    !("severity" in value) ||
    !("description" in value) ||
    (hasFailureScenario && !keys.includes("failureScenario"))
  ) {
    throw invalidFindings();
  }
  const { axis, severity, description } = value;
  const failureScenario = "failureScenario" in value
    ? value.failureScenario
    : undefined;
  if (
    (axis !== "standards" && axis !== "spec") ||
    (severity !== "blocking" && severity !== "advisory") ||
    typeof description !== "string"
  ) {
    throw invalidFindings();
  }
  if (hasFailureScenario && typeof failureScenario !== "string") {
    throw invalidFindings();
  }
  const scenario = typeof failureScenario === "string"
    ? failureScenario
    : undefined;
  if (severity === "blocking" && !scenario?.trim()) {
    return {
      axis,
      severity: "advisory",
      description,
      ...(scenario === undefined ? {} : { failureScenario: scenario }),
      degradedFromBlocking: true,
    };
  }
  return {
    axis,
    severity,
    description,
    ...(scenario === undefined ? {} : { failureScenario: scenario }),
  };
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

export const parseVerificationVerdicts = (
  source: string,
  expectedCount: number,
): VerificationVerdict[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw invalidVerdicts();
  }
  if (!Array.isArray(parsed) || parsed.length !== expectedCount) {
    throw invalidVerdicts();
  }
  return parsed.map((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !("verdict" in value) ||
      !("rationale" in value) ||
      (value.verdict !== "resolved" && value.verdict !== "unresolved") ||
      typeof value.rationale !== "string"
    ) {
      throw invalidVerdicts();
    }
    return { verdict: value.verdict, rationale: value.rationale };
  });
};
