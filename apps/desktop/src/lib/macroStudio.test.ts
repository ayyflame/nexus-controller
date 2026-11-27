import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_MACRO_META, describeStep, editorTab, parseMacroRoute, macroMatches, organizeMacros, playTime, runView, usageOf, usageText } from "./macroStudio.ts";
import { heldBefore, holdIssues, newMacro, sequenceStateAt, totalDuration, validateMacro } from "./macros.ts";
import type { Macro, MacroStep, Profile } from "../types/engine";

const tap = (b: MacroStep["buttons"], holdMs: number, delayAfterMs: number): MacroStep => ({ id: `t${Math.random()}`, buttons: b, holdMs, delayAfterMs });
const hold = (b: MacroStep["buttons"], delayAfterMs: number): MacroStep => ({ id: `h${Math.random()}`, buttons: b, holdMs: 0, delayAfterMs, kind: "hold" });
const release = (b: MacroStep["buttons"], delayAfterMs: number): MacroStep => ({ id: `r${Math.random()}`, buttons: b, holdMs: 0, delayAfterMs, kind: "release" });
const macro = (id: string, name: string, patch: Partial<Macro> = {}): Macro => ({ ...newMacro(), id, name, steps: [tap(["south"], 100, 50)], ...patch });

test("hold and release: the same timeline as the engine", () => {
  // Same case as the Rust test: hold L2, tap R2 twice, release L2.
  const steps = [hold(["leftTrigger"], 50), tap(["rightTrigger"], 40, 30), tap(["rightTrigger"], 40, 30), release(["leftTrigger"], 20)];
  const down = (ms: number) => sequenceStateAt(steps, ms).down.sort();
  assert.deepEqual(down(0), ["leftTrigger"]);
  assert.deepEqual(down(50), ["leftTrigger", "rightTrigger"]);
  assert.deepEqual(down(95), ["leftTrigger"]);
  assert.deepEqual(down(120), ["leftTrigger", "rightTrigger"]);
  assert.deepEqual(down(190), []);
  assert.ok(sequenceStateAt(steps, 210).point.finished);
  assert.equal(totalDuration(steps), 210, "hold and release count only their wait");
  assert.deepEqual(heldBefore(steps).map((h) => h.join()), ["", "leftTrigger", "leftTrigger", "leftTrigger"]);
});

test("hold and release are validated like the engine does", () => {
  assert.deepEqual(holdIssues([hold(["leftTrigger"], 50), release(["leftTrigger"], 0)]), []);
  assert.match(holdIssues([release(["leftTrigger"], 0)])[0]!.message, /isn't held/);
  assert.match(holdIssues([hold(["leftTrigger"], 50), tap(["leftTrigger"], 40, 0)])[0]!.message, /still holding/);
  assert.match(holdIssues([hold(["leftTrigger"], 5), release(["leftTrigger"], 0)])[0]!.message, /5 ms after action 1/);
  const m = macro("a", "A", { repeatCount: 0 });
  assert.ok(validateMacro(m, []).some((i) => i.field === "repeatCount"));
  assert.ok(!validateMacro({ ...m, repeatCount: 3 }, []).some((i) => i.field === "repeatCount"));
});

test("search, sort and pins", () => {
  const list = [
    macro("a", "Rapid fire", { trigger: "rightShoulder", updatedAtMs: 300, createdAtMs: 1 }),
    macro("b", "Build wall", { description: "Edit mode then place", updatedAtMs: 100, createdAtMs: 3 }),
    macro("c", "aim", { updatedAtMs: 200, createdAtMs: 2 }),
  ];
  assert.ok(macroMatches(list[0]!, "r1"), "by trigger button");
  assert.ok(macroMatches(list[1]!, "place"), "by description");
  const names = (o: { pinned: Macro[]; others: Macro[] }) => [o.pinned.map((m) => m.name), o.others.map((m) => m.name)];
  assert.deepEqual(names(organizeMacros(list, EMPTY_MACRO_META, "", "modified")), [[], ["Rapid fire", "aim", "Build wall"]]);
  assert.deepEqual(names(organizeMacros(list, EMPTY_MACRO_META, "", "name")), [[], ["aim", "Build wall", "Rapid fire"]]);
  assert.deepEqual(names(organizeMacros(list, EMPTY_MACRO_META, "", "created")), [[], ["Build wall", "aim", "Rapid fire"]]);
  assert.deepEqual(names(organizeMacros(list, { pinned: ["c", "a"], profiles: {} }, "", "name")), [["aim", "Rapid fire"], ["Build wall"]]);
  assert.deepEqual(names(organizeMacros(list, { pinned: ["c"], profiles: {} }, "wall", "name")), [[], ["Build wall"]]);
});

test("where a macro is used", () => {
  const profiles = [{ id: 1, name: "Default" }, { id: 2, name: "Warzone" }] as Profile[];
  const m = macro("a", "Rapid", { trigger: "rightShoulder" });
  const meta = { pinned: [], profiles: { a: [1, 2] } };
  const u = usageOf(m, meta, profiles, 2);
  assert.equal(usageText(u), "R1 · on in Default, Warzone");
  assert.ok(u.activeNow);
  assert.equal(usageText(usageOf(macro("b", "B"), meta, profiles, 2)), "No button · off in every profile");
  assert.equal(usageOf({ ...m, trigger: null }, meta, profiles, 2).activeNow, false, "no button: not live");
});

test("the test panel follows the engine's run state", () => {
  const m = macro("a", "A", { steps: [tap(["south"], 100, 50), tap(["east"], 100, 0)], repeatCount: 2, repeatDelayMs: 50, activationMs: 300 });
  assert.deepEqual(runView(m, undefined, 0), { state: "idle" });
  assert.deepEqual(runView(m, { id: "a", state: "arming", sinceMs: 1000 }, 1100), { state: "arming", heldMs: 100, neededMs: 300 });
  const r = runView(m, { id: "a", state: "running", sinceMs: 1000 }, 1120);
  assert.ok(r.state === "running" && r.step === 0 && !r.pressed && r.pass === 0 && r.passes === 2);
  const r2 = runView(m, { id: "a", state: "running", sinceMs: 1000 }, 1000 + 300 + 160);
  assert.ok(r2.state === "running" && r2.pass === 1 && r2.step === 1 && r2.pressed, "second pass, Circle pressed");
  assert.equal(playTime(m), 2 * 250 + 50);
  assert.equal(playTime({ ...m, mode: "toggle" }), 300);
});

test("each action reads as a sentence", () => {
  const steps = [hold(["leftTrigger"], 100), tap(["rightTrigger"], 60, 0), release(["leftTrigger"], 0)];
  assert.equal(describeStep(steps, 0), "Press L2 and keep it held, then wait 100 ms");
  assert.equal(describeStep(steps, 1), "Press R2 for 60 ms, release");
  assert.equal(describeStep(steps, 2), "Release L2");
});

test("Macro Studio addresses: library by default, an editor only for a chosen macro", () => {
  assert.deepEqual(parseMacroRoute(undefined), { view: "library", create: false });
  assert.deepEqual(parseMacroRoute("anything"), { view: "library", create: false });
  assert.deepEqual(parseMacroRoute("edit:"), { view: "library", create: false }, "no id: the library");
  assert.deepEqual(parseMacroRoute(editorTab("m1")), { view: "editor", id: "m1" });
  assert.deepEqual(parseMacroRoute("draft"), { view: "draft" });
  assert.deepEqual(parseMacroRoute("new:leftShoulder"), { view: "library", create: true, trigger: "leftShoulder" });
  assert.deepEqual(parseMacroRoute("new:bogus"), { view: "library", create: true, trigger: null });
  assert.deepEqual(parseMacroRoute("new"), { view: "library", create: true, trigger: null });
});

test("routes: inherited property names are not buttons", () => {
  // `in` also finds properties every object inherits; only real buttons may be a trigger.
  for (const name of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"]) {
    assert.deepEqual(parseMacroRoute(`new:${name}`), { view: "library", create: true, trigger: null }, name);
  }
  for (const b of ["south", "touchpad", "home", "mute", "dpadLeft", "rightTrigger"]) {
    assert.deepEqual(parseMacroRoute(`new:${b}`), { view: "library", create: true, trigger: b }, b);
  }
});
