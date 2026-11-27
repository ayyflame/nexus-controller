import { test } from "node:test";
import assert from "node:assert/strict";
import { MacroSaver, discardMacroEditor, flushMacroEditor, leaveMacroEditor, macroSavesSettled, reportMacroSaveFailure, setOpenMacroEditor, takeMacroSaveFailure, type SaverHooks } from "./macroSaves.ts";
import { newMacro } from "./macros.ts";
import type { Macro } from "../types/engine";

const withSteps = (patch: Partial<Macro> = {}): Macro => ({ ...newMacro(), name: "Test", steps: [{ id: "s", buttons: ["south"], holdMs: 50, delayAfterMs: 50 }], ...patch });

/** A fake engine whose saves finish only when told to (or at once with `auto`). */
function fakeEngine(auto = false) {
  const sent: Macro[] = [];
  const waiting: { resolve: () => void; reject: (e: unknown) => void }[] = [];
  let n = 0;
  const save = (m: Macro) => {
    sent.push(structuredClone(m));
    const stored = { ...m, id: m.id || `macro-${++n}`, createdAtMs: m.id ? m.createdAtMs : 1000 + n };
    return new Promise<Macro>((resolve, reject) => {
      const w = { resolve: () => resolve(stored), reject };
      if (auto) w.resolve(); else waiting.push(w);
    });
  };
  return { sent, save, finish: () => waiting.shift()!.resolve(), fail: (e: unknown) => waiting.shift()!.reject(e), waiting };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function editor(initial: Macro, engine: ReturnType<typeof fakeEngine>, extra: Partial<SaverHooks> = {}, delayMs = 20) {
  let current = initial;
  const saved: { m: Macro; wasNew: boolean }[] = [];
  const failed: unknown[] = [];
  const saver = new MacroSaver(initial, {
    latest: () => current,
    save: engine.save,
    validate: (m) => (m.steps.length ? [] : [{ field: "steps", message: "Add at least one action." }]),
    onSaved: (m, wasNew) => saved.push({ m, wasNew }),
    onFailed: (e) => failed.push(e),
    ...extra,
  }, delayMs);
  return { saver, saved, failed, edit: (p: Partial<Macro>) => { current = { ...current, ...p }; } };
}

test("save queue: flush saves an edit at once, without waiting for the pause", async () => {
  const engine = fakeEngine(true);
  const e = editor(withSteps({ id: "a", createdAtMs: 5 }), engine);
  e.edit({ name: "Renamed" });
  e.saver.schedule();
  assert.equal(e.saver.scheduled, true);
  assert.equal(await e.saver.flush(), "saved");
  assert.equal(e.saver.scheduled, false, "the waiting save is replaced, not repeated");
  assert.equal(engine.sent.length, 1);
  assert.equal(engine.sent[0]!.name, "Renamed");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(engine.sent.length, 1, "nothing saved again when the pause would have ended");
  assert.equal(await e.saver.flush(), "unchanged");
});

test("save queue: a slow first save, then another edit, creates one macro and updates it", async () => {
  const engine = fakeEngine();
  const e = editor(withSteps({ id: "" }), engine);
  const first = e.saver.flush();
  await tick();
  assert.equal(engine.sent.length, 1, "first save under way");
  e.edit({ name: "Edited while saving" });
  const second = e.saver.flush();
  const third = e.saver.flush();
  await tick();
  assert.equal(engine.sent.length, 1, "later saves wait for the first");
  engine.finish();
  assert.equal(await first, "saved");
  await tick();
  assert.equal(engine.sent.length, 2, "then the latest content is saved once");
  assert.equal(engine.sent[1]!.id, "macro-1", "with the id the first save created");
  assert.equal(engine.sent[1]!.createdAtMs, 1001);
  assert.equal(engine.sent[1]!.name, "Edited while saving");
  engine.finish();
  assert.equal(await second, "saved");
  assert.equal(await third, "unchanged", "nothing left to save");
  assert.deepEqual(e.saved.map((s) => s.wasNew), [true, false]);
  assert.equal(e.saver.savedId, "macro-1");
  assert.equal(engine.sent.filter((m) => !m.id).length, 1, "only one creation");
});

test("save queue: two timers firing during a slow first save don't create two macros", async () => {
  const engine = fakeEngine();
  const e = editor(withSteps({ id: "" }), engine, {}, 5);
  e.saver.schedule();
  await new Promise((r) => setTimeout(r, 15));
  e.edit({ name: "Again" });
  e.saver.schedule();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(engine.sent.length, 1);
  engine.finish();
  await tick(); await tick();
  assert.equal(engine.sent.length, 2);
  assert.equal(engine.sent[1]!.id, "macro-1");
  engine.finish();
  await macroSavesSettled();
  assert.equal(engine.sent.filter((m) => !m.id).length, 1);
});

test("save queue: content that isn't valid isn't sent", async () => {
  const engine = fakeEngine(true);
  const e = editor(withSteps({ id: "a" }), engine);
  e.edit({ steps: [] });
  assert.equal(await e.saver.flush(), "invalid");
  assert.equal(engine.sent.length, 0);
});

test("save queue: a failed save is reported, and the next save retries", async () => {
  const engine = fakeEngine();
  const e = editor(withSteps({ id: "a", createdAtMs: 5 }), engine);
  e.edit({ name: "Change" });
  const r = e.saver.flush();
  await tick();
  engine.fail(new Error("database is locked"));
  assert.equal(await r, "failed");
  assert.equal((e.failed[0] as Error).message, "database is locked");
  assert.equal(e.saved.length, 0);
  const again = e.saver.flush();
  await tick();
  assert.equal(engine.sent.length, 2, "still unsaved, so it is sent again");
  engine.finish();
  assert.equal(await again, "saved");
});

test("save queue: a failed first save leaves the macro new; the retry creates it", async () => {
  const engine = fakeEngine();
  const e = editor(withSteps({ id: "" }), engine);
  const r = e.saver.flush();
  await tick();
  engine.fail(new Error("offline"));
  assert.equal(await r, "failed");
  assert.equal(e.saver.savedId, "");
  const again = e.saver.flush();
  await tick();
  assert.equal(engine.sent[1]!.id, "");
  engine.finish();
  assert.equal(await again, "saved");
  assert.equal(e.saved.length, 1);
  assert.equal(e.saved[0]!.wasNew, true);
  assert.equal(e.saver.savedId, e.saved[0]!.m.id, "it keeps the id the retry created");
  assert.notEqual(e.saver.savedId, "");
});

test("save queue: after close nothing more is saved", async () => {
  const engine = fakeEngine(true);
  const e = editor(withSteps({ id: "a" }), engine);
  e.edit({ name: "Gone" });
  e.saver.schedule();
  e.saver.close();
  assert.equal(e.saver.scheduled, false);
  assert.equal(await e.saver.flush(), "unchanged");
  e.saver.schedule();
  assert.equal(e.saver.scheduled, false);
  assert.equal(engine.sent.length, 0);
});

test("save queue: isSaved compares with the id the engine gave", async () => {
  const engine = fakeEngine(true);
  const initial = withSteps({ id: "" });
  const e = editor(initial, engine);
  assert.equal(e.saver.isSaved(initial), false, "a new macro isn't saved");
  await e.saver.flush();
  assert.equal(e.saver.isSaved(initial), true, "the editor's copy without the id yet still counts as saved");
  assert.equal(e.saver.isSaved({ ...initial, name: "Other" }), false);
});

test("saves under way: settled waits for saves queued meanwhile", async () => {
  const engine = fakeEngine();
  const e = editor(withSteps({ id: "" }), engine);
  void e.saver.flush();
  let settled = false;
  const wait = macroSavesSettled().then(() => { settled = true; });
  await tick();
  e.edit({ name: "More" });
  void e.saver.flush();
  engine.finish();
  await tick(); await tick();
  assert.equal(settled, false, "the second save is still under way");
  engine.finish();
  await wait;
  assert.equal(settled, true);
});

test("open editor: flush, leave and discard reach the registered editor, unregister only its own", async () => {
  assert.equal(await flushMacroEditor(), "unchanged", "no editor open");
  assert.equal(await leaveMacroEditor(), "unchanged", "no editor open");
  const calls: string[] = [];
  const fake = (n: number) => ({
    flush: async () => { calls.push(`flush${n}`); return "saved" as const; },
    leave: async () => { calls.push(`leave${n}`); return "saved" as const; },
    discard: () => { calls.push(`discard${n}`); },
  });
  const off1 = setOpenMacroEditor(fake(1));
  const off2 = setOpenMacroEditor(fake(2));
  off1(); // a stale editor's cleanup must not unregister the open one
  assert.equal(await flushMacroEditor(), "saved");
  assert.equal(await leaveMacroEditor(), "saved");
  discardMacroEditor();
  off2();
  assert.equal(await flushMacroEditor(), "unchanged");
  assert.equal(await leaveMacroEditor(), "unchanged");
  assert.deepEqual(calls, ["flush2", "leave2", "discard2"]);
});

test("open editor: a save finishing after leave began doesn't count as open, and the leave still saves the edit", async () => {
  // The editor's own wiring, reduced: open = mounted and not being left.
  const engine = fakeEngine();
  let leaving = false;
  const opens: boolean[] = [];
  const e = editor(withSteps({ id: "" }), engine, { onSaved: () => opens.push(!leaving) });
  const off = setOpenMacroEditor({ flush: () => e.saver.flush(), leave: () => { leaving = true; return e.saver.flush(); }, discard: () => e.saver.close() });
  const first = e.saver.flush();
  await tick();
  e.edit({ name: "Typed just before leaving" });
  const left = leaveMacroEditor(); // navigation starts while the first save is under way
  engine.finish();
  assert.equal(await first, "saved");
  await tick();
  engine.finish();
  assert.equal(await left, "saved");
  assert.deepEqual(opens, [false, false], "neither result may navigate");
  assert.equal(engine.sent[1]!.name, "Typed just before leaving");
  assert.equal(engine.sent[1]!.id, "macro-1", "and it updated the macro the first save created");
  off();
});

test("save failures after close: reported once", () => {
  assert.equal(takeMacroSaveFailure(), null);
  reportMacroSaveFailure("Your last change wasn't saved: offline");
  assert.equal(takeMacroSaveFailure(), "Your last change wasn't saved: offline");
  assert.equal(takeMacroSaveFailure(), null);
});
