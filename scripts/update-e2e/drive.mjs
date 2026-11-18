// Test-only driver for the Windows update end-to-end check
// (.github/workflows/update-e2e.yml). It installs and runs the REAL NEXUS
// builds and clicks the real UI through WebView2's DevTools port. NEXUS has
// no test hooks; the updater runs exactly as for users.
//
//   node drive.mjs <work-dir> <old-version> <new-version>
//
// <work-dir> contains: old/ (0.1.0 installer), srv/ (served by server.mjs),
// manifests/{same,bad,good}.json, server.cmd.json (how to start the server).
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [work, OLD, NEW] = process.argv.slice(2);
const results = [];
const PORT = 9222;
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(id, name, ok, detail) {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
  writeFileSync(join(work, "results.json"), JSON.stringify(results, null, 2));
}
async function step(id, name, fn) {
  try { const d = await fn(); record(id, name, true, d ?? ""); }
  catch (e) { record(id, name, false, String(e?.stack ?? e)); throw e; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
async function until(what, fn, ms = 60000, every = 250) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

// ---- Windows helpers ----------------------------------------------------------
function ps(cmd) {
  return execFileSync("powershell", ["-NoProfile", "-Command", cmd], { encoding: "utf8" }).trim();
}
function installed() {
  const out = ps(`Get-ChildItem HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall, HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'NEXUS' } | ForEach-Object { $loc = $_.InstallLocation; if (-not $loc -and $_.UninstallString) { $loc = Split-Path ($_.UninstallString -replace '"', '') }; "$($_.DisplayVersion)|$($loc.TrimEnd('\\'))" }`);
  // InstallLocation can be stored with surrounding quotes.
  return out ? out.split(/\r?\n/).map((l) => { const [version, location] = l.split("|"); return { version, location: location.replace(/"/g, "").trim() }; }) : [];
}
function running() { return ps(`@(Get-Process nexus-desktop -ErrorAction SilentlyContinue).Count`) !== "0"; }
function kill() { try { execFileSync("taskkill", ["/IM", "nexus-desktop.exe", "/F"], { stdio: "ignore" }); } catch { /* not running */ } }

// ---- Update server ------------------------------------------------------------
let server = null;
const srv = join(work, "srv");
function serve(manifest) {
  mkdirSync(join(srv, "stable"), { recursive: true });
  copyFileSync(join(work, "manifests", `${manifest}.json`), join(srv, "stable", "latest.json"));
}
function startServer() {
  const c = JSON.parse(readFileSync(join(work, "server.cmd.json"), "utf8"));
  server = spawn(process.execPath, c.args, { stdio: ["ignore", "inherit", "inherit"] });
}
function stopServer() { if (server) { server.kill(); server = null; } }

// ---- The app --------------------------------------------------------------------
let browser = null;
let page = null;
function launch() {
  const loc = installed()[0]?.location;
  assert(loc, "NEXUS is not installed");
  const exe = join(loc, "nexus-desktop.exe");
  assert(existsSync(exe), `${exe} not found`);
  const child = spawn(exe, [], { env, detached: true, stdio: "ignore" });
  child.on("error", (e) => console.error(`launch failed: ${e.message}`));
  child.unref();
}
async function connect(ms = 120000) {
  try {
    browser = await until("the NEXUS window (WebView2 DevTools)", async () => {
      try { return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { return null; }
    }, ms, 1000);
  } catch (e) {
    // Explain why: is NEXUS running, did WebView2 start, which ports listen?
    let info = `NEXUS running: ${running()}`;
    try { info += `; WebView2 processes: ${ps("@(Get-Process msedgewebview2 -ErrorAction SilentlyContinue).Count")}`; } catch {}
    try { info += `; listening: ${ps("(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 9000 } | ForEach-Object { $_.LocalPort }) -join ','")}`; } catch {}
    throw new Error(`${e.message} [${info}]`);
  }
  // The window first shows a blank page, then navigates to the app.
  page = await until("the NEXUS page", () => browser.contexts()[0]?.pages()
    .find((p) => /tauri\.localhost|^tauri:/.test(p.url())) ?? null, 60000, 500);
  await page.waitForLoadState("load");
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__, null, { timeout: 60000 });
  await retry(() => page.evaluate(() => { try { localStorage.setItem("nexus.onboarding.v1", "done"); } catch {} }));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__, null, { timeout: 60000 });
  await until("the app UI", () => page.locator("nav, .sidebar").first().isVisible());
}

/** Retries an action that a page navigation can interrupt. */
async function retry(fn, tries = 5) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !/context was destroyed|navigat|Target closed/i.test(String(e))) throw e;
      await sleep(1000);
      try { await page.waitForLoadState("load"); await page.waitForFunction(() => !!window.__TAURI_INTERNALS__, null, { timeout: 30000 }); } catch {}
    }
  }
}
async function disconnect() { try { await browser?.close(); } catch {} browser = null; page = null; }
const invoke = (cmd, args) => retry(() => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args ?? {}]));
const updateStatus = () => invoke("get_update_status");
async function openSettings() {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Updates" }).waitFor();
}
async function checkNow() {
  await openSettings();
  await page.getByRole("button", { name: "Check for updates" }).click();
  return until("the check to finish", async () => { const s = await updateStatus(); return s.state.kind !== "checking" ? s : null; });
}
const banner = () => page.locator(".update-banner");

// ---- Test data ------------------------------------------------------------------
async function seed() {
  const p = await invoke("create_profile", { name: "E2E Shooter" });
  await invoke("set_active_profile", { id: p.id });
  const active = await invoke("get_active_profile");
  const cfg = structuredClone(active.processing);
  cfg.leftStick.deadzone = 0.17;
  cfg.remap = [{ from: "south", to: "east", also: [] }];
  await invoke("set_processing", { config: cfg });
  await invoke("set_profile_games", { id: p.id, games: ["e2egame.exe"] });
  await invoke("save_macro", { definition: {
    id: "", name: "E2E Rapid", description: "update test", enabled: true,
    steps: [{ id: "", buttons: ["south"], holdMs: 45, delayAfterMs: 55 }],
    trigger: "rightStick", mode: "repeatWhileHeld", repeatDelayMs: 20, blockTrigger: true, createdAtMs: 0, updatedAtMs: 0,
  } });
  await invoke("set_auto_switch", { enabled: false });
}
async function snapshot() {
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "updatedAtMs" || k === "createdAtMs" ? undefined : v)));
  return strip({
    profiles: await invoke("list_profiles"),
    active: await invoke("get_active_profile"),
    macros: await invoke("list_macros"),
    autoSwitch: await invoke("get_auto_switch"),
  });
}

// ---- The test -------------------------------------------------------------------
async function main() {
  let before;

  await step("T1", `install ${OLD} with its real installer`, async () => {
    const exe = readdirSync(join(work, "old")).find((f) => f.endsWith("-setup.exe"));
    execFileSync(join(work, "old", exe), ["/S"], { stdio: "inherit" });
    const i = await until("the uninstall entry", () => { const x = installed(); return x.length ? x : null; });
    assert(i.length === 1 && i[0].version === OLD, `installed: ${JSON.stringify(i)}`);
    return `installed at ${i[0].location}`;
  });

  await step("T2", `start ${OLD} and create profile, mapping, macro and settings`, async () => {
    launch();
    await connect();
    const info = await invoke("get_app_info");
    assert(info.version === OLD, `running ${info.version}`);
    const st = await updateStatus();
    assert(st.configured, "this build has no update server configured");
    await seed();
    before = await snapshot();
    assert(before.profiles.some((p) => p.name === "E2E Shooter") && before.macros.some((m) => m.name === "E2E Rapid"), "seed missing");
    return `${before.profiles.length} profiles, ${before.macros.length} macros`;
  });

  await step("T3", "update server unavailable: NEXUS keeps working and offers a retry", async () => {
    stopServer();
    const st = await checkNow();
    assert(st.state.kind === "failed" && st.state.error.kind === "offline", `state ${JSON.stringify(st.state)}`);
    assert(!(await banner().isVisible()), "an error banner interrupted the user");
    const text = await page.locator(".update-status").innerText();
    assert(await page.getByRole("button", { name: "Check for updates" }).isEnabled(), "no retry possible");
    const engine = await invoke("get_status");
    assert(engine && typeof engine.revision === "number", "engine not responding");
    return `Settings shows: "${text}"`;
  });

  await step("T4", "no update available: no notification", async () => {
    serve("same");
    startServer();
    const st = await until("server up", async () => { const s = await checkNow(); return s.state.kind === "upToDate" ? s : null; }, 30000, 1000);
    assert(!(await banner().isVisible()), "banner shown without an update");
    return `state ${st.state.kind}: "${await page.locator(".update-status").innerText()}"`;
  });

  await step("T5", "incorrectly signed update is rejected and nothing is installed", async () => {
    serve("bad");
    const st = await checkNow();
    assert(st.state.kind === "available" && st.state.release.version === NEW, `state ${st.state.kind}`);
    await banner().getByRole("button", { name: "Update now" }).click();
    const end = await until("the download to end", async () => { const s = await updateStatus(); return ["failed", "readyToInstall"].includes(s.state.kind) ? s : null; }, 180000, 200);
    assert(end.state.kind === "failed" && end.state.error.kind === "invalidSignature", `state ${JSON.stringify(end.state)}`);
    assert(installed()[0].version === OLD, "something was installed");
    assert(running(), "NEXUS stopped");
    return `"${end.state.error.message}"`;
  });

  await step("T6", "notification shows versions, notes, Update now and Remind me later", async () => {
    serve("good");
    const st = await checkNow();
    assert(st.state.kind === "available" && st.banner, `state ${st.state.kind}, banner ${st.banner}`);
    const text = await banner().innerText();
    for (const want of [NEW, `you have ${OLD}`, "Update now", "Remind me later", "End-to-end test release"]) {
      assert(text.includes(want), `banner lacks "${want}": ${text}`);
    }
    return text.replace(/\s+/g, " ");
  });

  await step("T7", "Remind me later: not shown again in this session", async () => {
    await banner().getByRole("button", { name: "Remind me later" }).click();
    await until("the banner to close", async () => !(await banner().isVisible()));
    const st = await checkNow();
    assert(st.state.kind === "available", `state ${st.state.kind}`);
    assert(!st.banner && !(await banner().isVisible()), "banner came back in the same session");
    return "banner hidden after a new check";
  });

  await step("T8", "after a restart the postponed update is offered again", async () => {
    await disconnect();
    kill();
    await until("NEXUS to exit", () => !running());
    launch();
    await connect();
    const st = await checkNow();
    assert(st.banner && (await banner().isVisible()), "not offered again after restart");
    return "banner shown again";
  });

  await step("T9", "Update now: background download with progress, signature verified", async () => {
    const seen = new Set();
    let maxPct = 0;
    await banner().getByRole("button", { name: "Update now" }).click();
    const end = await until("the download to finish", async () => {
      const s = await updateStatus();
      seen.add(s.state.kind);
      if (s.state.kind === "downloading" && s.state.total) maxPct = Math.max(maxPct, s.state.downloaded / s.state.total);
      if (s.state.kind === "downloading") { const bar = await page.locator(".update-banner [role=progressbar]").count(); if (bar) seen.add("progressbar"); }
      return s.state.kind === "readyToInstall" || s.state.kind === "failed" ? s : null;
    }, 300000, 150);
    assert(end.state.kind === "readyToInstall", `state ${JSON.stringify(end.state)}`);
    assert(seen.has("downloading") && seen.has("progressbar"), `no visible progress: ${[...seen]}`);
    assert((await banner().innerText()).includes("signature verified"), "no verification shown");
    assert(await invoke("get_status"), "NEXUS stopped responding during the download");
    return `states ${[...seen].join(", ")}; progress seen up to ${Math.round(maxPct * 100)} %`;
  });

  await step("T10", `Restart and install: ${NEW} installs and NEXUS restarts on ${NEW}`, async () => {
    await banner().getByRole("button", { name: "Restart and install" }).click();
    await disconnect();
    await until(`${NEW} to be installed`, () => installed()[0]?.version === NEW, 240000, 1000);
    await until("NEXUS to restart by itself", () => running(), 120000, 1000);
    let note = "restarted by itself";
    try { await connect(60000); } catch {
      // The relaunched process may not carry the DevTools setting; reopen it
      // to inspect it (the automatic restart itself was already confirmed).
      kill(); await until("exit", () => !running()); launch(); await connect();
      note = "restarted by itself; reopened with DevTools to inspect";
    }
    const info = await invoke("get_app_info");
    assert(info.version === NEW, `running ${info.version}`);
    const st = await updateStatus();
    assert(st.outcome?.kind === "updated" && st.outcome.version === NEW, `outcome ${JSON.stringify(st.outcome)}`);
    const msg = await banner().innerText();
    assert(msg.includes(`updated to ${NEW}`), msg);
    return `${note}: ${msg.replace(/\s+/g, " ")}`;
  });

  await step("T11", "profiles, mappings, macros and settings are unchanged", async () => {
    const after = await snapshot();
    assert(JSON.stringify(after) === JSON.stringify(before), `changed:\nbefore ${JSON.stringify(before)}\nafter  ${JSON.stringify(after)}`);
    const data = join(process.env.APPDATA, "com.nexus.controllerengine", "backups");
    const backups = existsSync(data) ? readdirSync(data).filter((f) => f.includes("pre-update")) : [];
    assert(backups.length >= 1, `no pre-update backup in ${data}`);
    return `identical (${after.profiles.length} profiles, ${after.macros.length} macros); backup ${backups[0]}`;
  });

  await step("T12", "exactly one installation, and no further update offered", async () => {
    const i = installed();
    assert(i.length === 1 && i[0].version === NEW, JSON.stringify(i));
    await invoke("dismiss_update_outcome");
    const st = await checkNow();
    assert(st.state.kind === "upToDate" && !(await banner().isVisible()), `state ${st.state.kind}`);
    return `one NEXUS entry, version ${NEW}; up to date`;
  });
}

main()
  .catch(() => { process.exitCode = 1; })
  .finally(async () => {
    try { if (page) await page.screenshot({ path: join(work, "final.png") }); } catch {}
    await disconnect();
    kill();
    stopServer();
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed`);
  });
