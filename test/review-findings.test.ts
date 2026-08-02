import assert from "node:assert/strict";
import test from "node:test";

import { parseReviewFindings } from "../src/review-findings.js";

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
