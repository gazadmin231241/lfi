import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReviewFindings,
  parseVerificationVerdicts,
} from "../src/review-findings.js";

test("verification verdicts accept one resolved or unresolved result per finding", () => {
  assert.deepEqual(
    parseVerificationVerdicts(JSON.stringify([
      { verdict: "resolved", rationale: "The invalid input is rejected now." },
      { verdict: "unresolved", rationale: "The failing branch is unchanged." },
    ]), 2),
    [
      { verdict: "resolved", rationale: "The invalid input is rejected now." },
      { verdict: "unresolved", rationale: "The failing branch is unchanged." },
    ],
  );
});

test("verification verdicts reject a mismatched count or an unknown item shape", () => {
  assert.throws(
    () => parseVerificationVerdicts("[]", 1),
    /Invalid verification verdicts/u,
  );
  assert.throws(
    () => parseVerificationVerdicts(
      '[{"verdict":"resolved","rationale":"Done.","finding":"extra"}]',
      1,
    ),
    /Invalid verification verdicts/u,
  );
  assert.throws(
    () => parseVerificationVerdicts(
      '[{"verdict":"unknown","rationale":"Not a verdict."}]',
      1,
    ),
    /Invalid verification verdicts/u,
  );
});

test("review findings accept the complete known JSON shape", () => {
  assert.deepEqual(
    parseReviewFindings(JSON.stringify([
      {
        axis: "standards",
        severity: "advisory",
        description: "Possible duplicated code in the changed module.",
      },
      {
        axis: "spec",
        severity: "blocking",
        description: "The required failure path is missing.",
        failureScenario: "Submitting an empty value reports success instead of rejecting it.",
      },
    ])),
    [
      {
        axis: "standards",
        severity: "advisory",
        description: "Possible duplicated code in the changed module.",
      },
      {
        axis: "spec",
        severity: "blocking",
        description: "The required failure path is missing.",
        failureScenario: "Submitting an empty value reports success instead of rejecting it.",
      },
    ],
  );
});

test("blocking findings without a failure scenario degrade to advisory", () => {
  assert.deepEqual(
    parseReviewFindings(JSON.stringify([
      {
        axis: "spec",
        severity: "blocking",
        description: "The required failure path is missing.",
      },
      {
        axis: "standards",
        severity: "blocking",
        description: "The scenario is empty.",
        failureScenario: "   ",
      },
      {
        axis: "standards",
        severity: "advisory",
        description: "A local name could be clearer.",
      },
    ])),
    [
      {
        axis: "spec",
        severity: "advisory",
        description: "The required failure path is missing.",
        degradedFromBlocking: true,
      },
      {
        axis: "standards",
        severity: "advisory",
        description: "The scenario is empty.",
        failureScenario: "   ",
        degradedFromBlocking: true,
      },
      {
        axis: "standards",
        severity: "advisory",
        description: "A local name could be clearer.",
      },
    ],
  );
});

test("review findings reject unknown shapes", () => {
  const invalidFindings = [
    {},
    { axis: "quality", severity: "blocking", description: "Unknown axis." },
    { axis: "spec", severity: "warning", description: "Unknown severity." },
    { axis: "spec", severity: "blocking", description: 42 },
    {
      axis: "spec",
      severity: "blocking",
      description: "Unexpected field.",
      file: "src/example.ts",
    },
  ];

  for (const finding of invalidFindings) {
    assert.throws(
      () => parseReviewFindings(JSON.stringify([finding])),
      /Invalid review findings/u,
    );
  }
  assert.throws(() => parseReviewFindings("{}"), /Invalid review findings/u);
  assert.throws(() => parseReviewFindings("not json"), /Invalid review findings/u);
});
