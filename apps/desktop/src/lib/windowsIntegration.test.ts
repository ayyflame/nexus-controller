import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BEHAVIOUR, closeText, startupView } from "./windowsIntegration.ts";

const st = (p: Partial<Parameters<typeof startupView>[0] & object> = {}) =>
  ({ supported: true, enabled: false, disabledInWindows: false, error: null, ...p });

test("start with Windows shows the real registry state", () => {
  assert.equal(startupView(null).disabled, true);
  assert.deepEqual(startupView(st({ supported: false })).disabled, true, "browser preview / other OS");
  assert.equal(startupView(st()).checked, false);
  const on = startupView(st({ enabled: true }));
  assert.equal(on.checked, true);
  assert.match(on.note, /sign in/);
});

test("an entry switched off in Task Manager shows as off, with why", () => {
  const v = startupView(st({ enabled: true, disabledInWindows: true }));
  assert.equal(v.checked, false);
  assert.equal(v.tone, "warn");
  assert.match(v.note, /Task Manager/);
});

test("registry errors are shown", () => {
  const v = startupView(st({ error: "Could not read the Windows startup entry (Windows error 5)." }));
  assert.equal(v.tone, "error");
  assert.match(v.note, /error 5/);
});

test("the defaults keep games working when the window is closed", () => {
  assert.deepEqual(DEFAULT_BEHAVIOUR, { closeToTray: true, minimizeToTray: false, startHidden: true });
  assert.match(closeText(DEFAULT_BEHAVIOUR), /keeps NEXUS running/);
  assert.match(closeText({ ...DEFAULT_BEHAVIOUR, closeToTray: false }), /quits NEXUS/);
});
