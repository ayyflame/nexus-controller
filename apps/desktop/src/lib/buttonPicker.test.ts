import { test } from "node:test";
import assert from "node:assert/strict";
import { PICKER_SELECTOR, PickerStore, deletesActions, escapeEndsChoosing, focusChange, focusStart, itemState, moveFocus, pickLabel, type ActivePick, type PickRequest } from "./buttonPicker.ts";
import type { MacroButton } from "../types/engine";

const req = (priority: 1 | 2 | 3, patch: Partial<PickRequest> = {}): PickRequest => ({ priority, title: `p${priority}`, selected: [], ...patch });
const pick = (key: string, r: PickRequest): ActivePick => ({ key, req: r });

test("button list keys: arrows move and wrap, Home / End jump, other keys are left alone", () => {
  assert.equal(moveFocus("ArrowRight", 0, 5), 1);
  assert.equal(moveFocus("ArrowDown", 3, 5), 4);
  assert.equal(moveFocus("ArrowRight", 4, 5), 0, "wraps to the first");
  assert.equal(moveFocus("ArrowLeft", 2, 5), 1);
  assert.equal(moveFocus("ArrowUp", 0, 5), 4, "wraps to the last");
  assert.equal(moveFocus("Home", 3, 5), 0);
  assert.equal(moveFocus("End", 1, 5), 4);
  for (const k of ["Enter", " ", "Tab", "Escape", "a"]) assert.equal(moveFocus(k, 2, 5), null, `${JSON.stringify(k)} is not handled by the list`);
  assert.equal(moveFocus("ArrowRight", 0, 0), null, "empty list");
});

test("button list focus starts on a chosen button, else the first that can be chosen", () => {
  const buttons: MacroButton[] = ["south", "east", "west", "north"];
  assert.equal(focusStart(buttons, req(2, { selected: ["west"] })), "west");
  assert.equal(focusStart(buttons, req(2, { selected: ["north", "east"] })), "east", "the first chosen in list order");
  assert.equal(focusStart(buttons, req(1, { blocked: { south: "held", east: "held" } })), "west", "skips unavailable buttons");
  assert.equal(focusStart(buttons, req(1, { blocked: { south: "x", east: "x", west: "x", north: "x" } })), "south", "all unavailable: still somewhere to land");
  assert.equal(focusStart(buttons, null), "south", "nothing to choose: the first");
});

test("unavailable buttons say why in their accessible name", () => {
  assert.equal(pickLabel("Cross", undefined), "Cross");
  assert.equal(pickLabel("L2", "still held: add a Release first"), "L2 (unavailable: still held: add a Release first)");
});

test("focus: choosing a trigger or an action's buttons from the keyboard moves into the list", () => {
  const add = pick("add", req(1));
  const trigger = pick("trigger", req(2));
  assert.equal(focusChange(add, trigger, true), "enter");
  assert.equal(focusChange(null, trigger, true), "enter");
  assert.equal(focusChange(add, trigger, false), null, "a mouse click leaves focus alone");
  assert.equal(focusChange(pick("step", req(2)), trigger, true), "enter", "from one action's buttons straight to the trigger");
});

test("focus: when choosing ends it goes back; other changes leave it alone", () => {
  const add = pick("add", req(1));
  const step = pick("step", req(2, { title: "action 1" }));
  assert.equal(focusChange(step, add, false), "return", "Done: back to where choosing started");
  assert.equal(focusChange(step, null, true), "return");
  assert.equal(focusChange(step, pick("step", req(2, { title: "action 1, R2 chosen" })), true), null, "a pick that keeps choosing doesn't move focus");
  assert.equal(focusChange(add, pick("add", req(1, { title: "release" })), true), null, "adding actions never moves focus");
  assert.equal(focusChange(null, add, true), null);
  assert.equal(focusChange(add, pick("preview", req(3)), true), null, "the preview never moves focus");
});

test("picker requests: the highest priority wins, the latest among equals; removing one falls back", () => {
  const s = new PickerStore();
  let notified = 0;
  const off = s.subscribe(() => { notified++; });
  s.set("add", req(1));
  s.set("trigger", req(2, { title: "trigger" }));
  assert.equal(s.get()?.key, "trigger");
  s.set("step", req(2, { title: "step" }));
  assert.equal(s.get()?.key, "step", "the latest of equal priority");
  s.set("trigger", req(2, { title: "trigger again" }));
  assert.equal(s.get()?.key, "step", "updating an earlier request keeps its place");
  s.set("preview", req(3));
  assert.equal(s.get()?.key, "preview");
  s.set("preview", null); s.set("step", null);
  assert.equal(s.get()?.key, "trigger");
  s.set("trigger", null); s.set("add", null);
  assert.equal(s.get(), null);
  assert.equal(notified, 9);
  off();
  s.set("add", req(1));
  assert.equal(notified, 9, "unsubscribed");
});

/** A stand-in for the focused element: `closest` finds the selectors it is inside. */
const inside = (...selectors: string[]) => ({ closest: (sel: string) => (sel.split(",").some((s) => selectors.includes(s.trim())) ? {} : null) });

test("Delete / Backspace in the controller don't delete actions; elsewhere they do", () => {
  for (const key of ["Delete", "Backspace"]) {
    assert.equal(deletesActions(key, inside(PICKER_SELECTOR)), false, `${key} on a button in the controller's list`);
    assert.equal(deletesActions(key, inside()), true, `${key} with focus elsewhere in the editor (e.g. the timeline)`);
    assert.equal(deletesActions(key, null), true, `${key} with nothing focused`);
    assert.equal(deletesActions(key, inside("input")), false, `${key} while typing in a field`);
    assert.equal(deletesActions(key, inside("textarea")), false, `${key} while typing in a description`);
  }
  for (const key of ["Enter", " ", "Escape", "ArrowLeft", "d", "Del"]) {
    assert.equal(deletesActions(key, inside()), false, `${JSON.stringify(key)} isn't a delete key`);
  }
});

test("list buttons are toggles only when a click toggles them (L1)", () => {
  // Changing an action's buttons: every button is a toggle, pressed when in the action.
  const toggle = req(2, { kind: "toggle", selected: ["south"] });
  assert.deepEqual(itemState(toggle, "south"), { pressed: true });
  assert.deepEqual(itemState(toggle, "east"), { pressed: false });
  // Choosing the trigger: the chosen one is "current", the others plain buttons.
  const choose = req(2, { kind: "choose", selected: ["leftShoulder"] });
  assert.deepEqual(itemState(choose, "leftShoulder"), { current: true });
  assert.deepEqual(itemState(choose, "south"), {});
  // Adding actions, the preview, nothing to pick: plain buttons, no pressed state.
  assert.deepEqual(itemState(req(1), "south"), {});
  assert.deepEqual(itemState(req(3, { selected: ["south"] }), "south"), {}, "the preview lights buttons but they aren't toggles");
  assert.deepEqual(itemState(null, "south"), {});
});

test("Alt, Ctrl and Meta with an arrow key are left to the system (L2)", () => {
  assert.equal(moveFocus("ArrowLeft", 2, 5, { altKey: true }), null, "Alt+Left is Back");
  assert.equal(moveFocus("ArrowRight", 2, 5, { ctrlKey: true }), null);
  assert.equal(moveFocus("Home", 2, 5, { metaKey: true }), null);
  assert.equal(moveFocus("ArrowRight", 2, 5, { altKey: false, ctrlKey: false, metaKey: false }), 3, "plain arrows still move");
});

test("Escape ends choosing from the controller or the button that started it, never in a dialog (L4)", () => {
  const at = (p: Partial<Parameters<typeof escapeEndsChoosing>[0]>) => escapeEndsChoosing({ canEnd: true, inDialog: false, inPicker: false, onOpener: false, ...p });
  assert.equal(at({ inPicker: true }), true, "focus in the list or on Done");
  assert.equal(at({ onOpener: true }), true, "focus still on Change on controller (started with the mouse)");
  assert.equal(at({}), false, "focus elsewhere in the editor");
  assert.equal(at({ inPicker: true, inDialog: true }), false, "Escape closes a dialog instead");
  assert.equal(at({ inPicker: true, canEnd: false }), false, "nothing being chosen");
});
