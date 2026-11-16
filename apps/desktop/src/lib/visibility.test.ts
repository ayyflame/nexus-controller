import { test } from "node:test";
import assert from "node:assert/strict";
import { pageHidden } from "./visibility.ts";

test("hidden pages skip timer work", () => {
  assert.equal(pageHidden({ hidden: true }), true);
  assert.equal(pageHidden({ hidden: false }), false);
  assert.equal(pageHidden(undefined), false, "outside a browser nothing is skipped");
});
