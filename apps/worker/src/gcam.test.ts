import assert from "node:assert/strict";
import test from "node:test";
import { ALWAYS_CHECK_ARTICLES } from "./gcam.js";

test("ALWAYS_CHECK_ARTICLES contains exactly Article 01-24", () => {
  assert.deepEqual(ALWAYS_CHECK_ARTICLES, Array.from({ length: 24 }, (_, index) => index + 1));
});