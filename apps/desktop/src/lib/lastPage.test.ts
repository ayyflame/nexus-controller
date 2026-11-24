import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePage } from "./lastPage.ts";
import { PAGE_IDS } from "./navigation.ts";

test("the last page is restored, anything unknown falls back to the dashboard", () => {
  for (const p of PAGE_IDS) assert.equal(parsePage(p), p);
  assert.equal(parsePage(null), "dashboard");
  assert.equal(parsePage("controller-studio"), "dashboard", "a page from another build");
  assert.equal(parsePage(""), "dashboard");
});

test("a saved Controller page (from before the sidebar was reorganised) reopens as Mapping", () => {
  assert.equal(parsePage("controller"), "mapping");
});
