import { test } from "node:test";
import assert from "node:assert/strict";
import { INACTIVE_CLASS, watchWindowActivity, windowInactive } from "./windowActivity.ts";

function fakes(focused: boolean, hidden = false) {
  const classes = new Set<string>();
  const listeners: Record<string, (() => void)[]> = {};
  const on = (t: string, f: () => void) => { (listeners[t] ??= []).push(f); };
  const off = (t: string, f: () => void) => { listeners[t] = (listeners[t] ?? []).filter((g) => g !== f); };
  const state = { focused, hidden };
  const doc = {
    get hidden() { return state.hidden; },
    hasFocus: () => state.focused,
    documentElement: { classList: { toggle: (n: string, force?: boolean) => { if (force) classes.add(n); else classes.delete(n); return !!force; } } },
    addEventListener: on, removeEventListener: off,
  };
  const win = { addEventListener: on, removeEventListener: off };
  const fire = (t: string) => (listeners[t] ?? []).forEach((f) => f());
  return { doc, win, classes, state, fire, listeners };
}

test("a focused, visible window is active", () => {
  assert.equal(windowInactive({ hidden: false, hasFocus: () => true }), false);
  assert.equal(windowInactive({ hidden: false, hasFocus: () => false }), true, "a game is in front");
  assert.equal(windowInactive({ hidden: true, hasFocus: () => true }), true, "minimised");
  assert.equal(windowInactive({ hidden: false }), false, "no focus information: treated as active");
});

test("animations pause while another program is in front and resume on return", () => {
  const f = fakes(true);
  const stop = watchWindowActivity(f.win, f.doc);
  assert.equal(f.classes.has(INACTIVE_CLASS), false);
  f.state.focused = false; f.fire("blur");
  assert.equal(f.classes.has(INACTIVE_CLASS), true);
  f.state.focused = true; f.fire("focus");
  assert.equal(f.classes.has(INACTIVE_CLASS), false);
  f.state.hidden = true; f.fire("visibilitychange");
  assert.equal(f.classes.has(INACTIVE_CLASS), true);
  stop();
  assert.equal(Object.values(f.listeners).flat().length, 0, "listeners removed");
});

test("a window that starts behind another program starts inactive", () => {
  const f = fakes(false);
  watchWindowActivity(f.win, f.doc);
  assert.equal(f.classes.has(INACTIVE_CLASS), true);
});
