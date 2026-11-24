import { useEffect, useState } from "react";
import { Advanced, Switch } from "../components/macro/common";
import { Panel } from "../components/controller/widgets";
import { CopyText } from "../components/CopyText";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { backendReady, outputLabel } from "../lib/format";
import { doubleInputAdvice, HIDHIDE_RELEASES } from "../lib/hidhide";
import { outputSummary } from "../lib/outputStatus";
import type { DriverPresence, VirtualOutputKind } from "../types/engine";

/** Setup › Virtual Controller: the Xbox 360 controller games see, its driver, and avoiding double input. */
export function VirtualControllerPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Virtual Controller</h1>
          <p className="muted">Games receive your mapping, stick settings and macros through a virtual controller that NEXUS creates. Set it up once here; the choice is saved in each profile.</p>
        </div>
      </header>
      <OutputTab />
    </div>
  );
}

// ---- Output --------------------------------------------------------------

const OUTPUTS: VirtualOutputKind[] = ["disabled", "xbox360", "dualShock4"];
export const VIGEMBUS_RELEASES = "https://github.com/nefarius/ViGEmBus/releases";

function presence(p: DriverPresence | undefined) {
  return p === "installed" ? <span className="ok-text">Installed</span>
    : p === "notInstalled" ? <span className="muted">Not installed</span>
      : <span className="muted">Unknown (Windows only)</span>;
}

function OutputTab() {
  const { status, profile, setProfile, connection } = useEngine();
  const device = usePrimaryDevice();
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const ready = connection.kind === "ready";
  const requested = status?.requestedOutput ?? "disabled";
  const saved = profile?.virtualOutput ?? "disabled";
  const active = device?.output.active ?? null;
  const backend = status?.outputBackendStatus;
  const driverReady = !!backend && backendReady(backend);
  const outputError = device?.output.lastError ?? null;
  const summary = outputSummary({ output: device?.output ?? null, requested, consent, driverReady });

  useEffect(() => {
    if (ready) engineApi.getOutputConsent().then((c) => setConsent(c.enabled)).catch(() => setConsent(false));
  }, [ready]);

  const choose = async (mode: VirtualOutputKind) => {
    setError(null);
    try { setProfile(await engineApi.setVirtualOutput(mode)); } catch (e) { setError(errorMessage(e)); }
  };
  const toggleConsent = async (on: boolean) => {
    setError(null);
    try { setConsent((await engineApi.setOutputConsent(on)).enabled); } catch (e) { setError(errorMessage(e)); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(VIGEMBUS_RELEASES); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className="two-col">
      <Panel title="Virtual controller (experimental)">
        <p className="muted small">
          Games receive your remaps and macros through a virtual <b>Xbox 360 controller</b> that NEXUS creates.
          This needs ViGEmBus, a free third-party driver that you install yourself. It was retired by its developer in 2023,
          so NEXUS treats it as experimental and may replace it later.
        </p>
        <Switch checked={!!consent} disabled={!ready || consent === null} onChange={(on) => void toggleConsent(on)}
          label="Use the experimental virtual controller"
          tip="Off removes the virtual controller immediately; your profile's choice is kept" />
        <div className="segmented" role="radiogroup" aria-label="Virtual output">
          {OUTPUTS.map((o) => {
            const unavailable = o === "dualShock4" || (o !== "disabled" && !consent);
            return (
              <button key={o} role="radio" aria-checked={requested === o} disabled={!ready || unavailable}
                title={o === "dualShock4" ? "Not available in this beta" : o !== "disabled" && !consent ? "Turn on the experimental virtual controller first" : undefined}
                className={requested === o ? "selected" : ""} onClick={() => void choose(o)}>
                {outputLabel[o]}{o === "dualShock4" ? " (later)" : ""}
              </button>
            );
          })}
        </div>
        <div className="kv-row"><span className="muted">Saved in this profile</span><span>{outputLabel[saved]}</span></div>
        <div className="kv-row"><span className="muted">Virtual controller now</span>
          <span className={summary.tone === "ok" ? "ok-text" : summary.tone === "warn" ? "warn-text" : undefined}>{summary.text}</span></div>
        {summary.detail && !outputError && <div className={summary.tone === "warn" ? "notice warn small" : "muted small"}>{summary.detail}</div>}
        {outputError && <div className="notice error">{outputError}</div>}
        {error && <div className="notice error">{error}</div>}
        {active && (
          <p className="muted small">
            Check it in Windows: press <kbd>Win</kbd> + <kbd>R</kbd>, type <code>joy.cpl</code> and press Enter. “Controller (XBOX 360 For Windows)”
            should be listed; its Properties page shows the buttons NEXUS sends, including macros.
          </p>
        )}
      </Panel>

      <Panel title="Driver" aside={<button className="btn-ghost" disabled={!ready}
        onClick={() => void engineApi.refreshDrivers()}>Check again</button>}>
        <div className="kv-row"><span>ViGEmBus <span className="muted small">(virtual Xbox 360)</span></span>
          {driverReady ? <span className="ok-text">Installed and ready</span> : presence(status?.drivers.vigembus)}</div>
        {!driverReady && backend?.state === "unavailable" && status?.drivers.vigembus === "installed" && (
          <div className="notice warn small">{backend.reason}</div>
        )}
        {!driverReady && (
          <ol className="small driver-steps">
            <li>Open the official ViGEmBus release page:{" "}
              <code className="mono break">{VIGEMBUS_RELEASES}</code>{" "}
              <button className="btn-ghost small" onClick={() => void copyLink()}>{copied ? "Copied" : "Copy link"}</button></li>
            <li>Download <b>ViGEmBus_1.22.0_x64_x86_arm64.exe</b> (the latest release) and run it. Windows asks for administrator approval: this is the driver's installer, not NEXUS.</li>
            <li>Come back here and click <b>Check again</b>.</li>
          </ol>
        )}
        <p className="muted small">
          NEXUS never installs or bundles drivers. To remove ViGEmBus later: Windows Settings › Apps › Installed apps ›
          “Nefarius Virtual Gamepad Emulation Bus Driver” › Uninstall. NEXUS keeps working without it; games then simply don't see a virtual controller.
        </p>
        <div className="kv-row"><span>HidHide <span className="muted small">(optional, see “Avoid double input” below)</span></span>{presence(status?.drivers.hidhide)}</div>
      </Panel>

      <div className="span-2">
        <DoubleInputPanel outputActive={!!active} controllerConnected={!!device} />
      </div>
    </div>
  );
}

/** Optional HidHide guide. NEXUS never installs HidHide or changes its settings. */
function DoubleInputPanel({ outputActive, controllerConnected }: { outputActive: boolean; controllerConnected: boolean }) {
  const { status, appInfo } = useEngine();
  const hidhide = status?.drivers.hidhide;
  const advice = doubleInputAdvice({ hidhide, outputActive, controllerConnected });
  return (
    <Panel title="Avoid double input (optional)">
      <p className="muted small">
        Games and Steam can see <b>both</b> your physical DualSense or DualShock 4 and the virtual Xbox controller, so a press may count twice.
        HidHide, a free optional driver by the same developer as ViGEmBus, can hide your controller from games while NEXUS keeps reading it.
        NEXUS never installs HidHide or changes its settings; you set it up once in HidHide's own app. It is not required.
      </p>
      <div className="kv-row"><span>HidHide</span>{presence(hidhide)}</div>
      {advice === "suggestHidHide" && (
        <div className="notice dev small">If a game or Steam reacts twice to one press, use HidHide (below) or turn off PlayStation controller support in that game or in Steam.</div>
      )}
      {advice === "checkApplicationsList" && (
        <div className="notice warn small">
          HidHide is installed and NEXUS sees no controller. If your controller is plugged in, HidHide may be hiding it from NEXUS too:
          add NEXUS to HidHide's <b>Applications</b> list (step 2 below), or untick <b>Enable device hiding</b>.
        </div>
      )}
      <div className="kv-row"><span className="muted">NEXUS program path</span>
        {appInfo?.exePath ? <CopyText text={appInfo.exePath} /> : <span className="muted">Unknown</span>}</div>

      <Advanced title="1. Install HidHide (once)">
        <ol className="small driver-steps">
          <li>Open the official release page: <CopyText text={HIDHIDE_RELEASES} /></li>
          <li>Download the latest <b>HidHide_…_x64.exe</b> and run it. Windows asks for administrator approval for the driver installer; NEXUS itself never needs it.</li>
          <li>Restart Windows if the installer asks, then click <b>Check again</b> in the Driver panel.</li>
        </ol>
      </Advanced>
      <Advanced title="2. Keep NEXUS allowed, hide your controller from games">
        <ol className="small driver-steps">
          <li>Start <b>HidHide Configuration Client</b> from the Start menu.</li>
          <li><b>Applications</b> tab: click <b>+</b> and choose the NEXUS program (path above). Only NEXUS goes here: not Steam, not games.</li>
          <li><b>Devices</b> tab: tick <b>DualSense Wireless Controller</b> (a DualShock 4 is listed as <b>Wireless Controller</b>). Do <b>not</b> tick the Xbox 360 controller; that one is NEXUS's output.</li>
          <li>Tick <b>Enable device hiding</b>.</li>
          <li>Check: in NEXUS the controller stays connected. In <code>joy.cpl</code> (Win + R) only “Controller (XBOX 360 For Windows)” is listed.</li>
        </ol>
        <p className="muted small">
          While hiding is on, games see <b>no</b> controller when NEXUS is closed. Untick <b>Enable device hiding</b> when you play without NEXUS.
          Plugging into a different USB port may show the controller as a new device: tick it again in the Devices tab.
        </p>
      </Advanced>
      <Advanced title="Undo or recover">
        <ul className="small driver-steps">
          <li><b>Show the controller to games again:</b> HidHide Configuration Client → untick <b>Enable device hiding</b>.</li>
          <li><b>NEXUS lost the controller after setup:</b> NEXUS is missing from the Applications list (or its path changed): add it again, or untick Enable device hiding.</li>
          <li><b>Remove HidHide completely:</b> Windows Settings › Apps › Installed apps › <b>HidHide</b> › Uninstall, then restart if asked. Every device is visible again; NEXUS keeps working.</li>
        </ul>
      </Advanced>
    </Panel>
  );
}
