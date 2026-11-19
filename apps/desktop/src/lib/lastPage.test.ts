import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, parsePage } from "./lastPage.ts";

test("the last page is restored, anything unknown falls back to the dashboard", () => {
  for (const p of PAGES) assert.equal(parsePage(p), p);
  assert.equal(parsePage(null), "dashboard");
  assert.equal(parsePage("controller-studio"), "dashboard", "a page from another build");
  assert.equal(parsePage(""), "dashboard");
});
