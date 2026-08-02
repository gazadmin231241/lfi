import assert from "node:assert/strict";
import test from "node:test";

import {
  isTransientGithubFailure,
  withGithubRetry,
} from "../src/github-resilience.js";

test("GitHub delivery retries transient transport and server failures", async () => {
  assert.equal(isTransientGithubFailure(new Error("dial tcp: i/o timeout")), true);
  assert.equal(isTransientGithubFailure(new Error("HTTP 503 unavailable")), true);
  assert.equal(isTransientGithubFailure(new Error("HTTP 401 unauthorized")), false);
  assert.equal(
    isTransientGithubFailure(
      new Error(
        "fatal: unable to access 'https://github.com/x/y.git/': Failed to connect to github.com port 443 after 132725 ms: Could not connect to server",
      ),
    ),
    true,
  );
  assert.equal(
    isTransientGithubFailure(new Error("Could not resolve host: github.com")),
    true,
  );

  let attempts = 0;
  const result = await withGithubRetry(
    async () => {
      attempts++;
      if (attempts < 3) throw new Error("connection reset by peer");
      return "ok";
    },
    { attempts: 3, delay: async () => undefined, random: () => 0 },
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});
