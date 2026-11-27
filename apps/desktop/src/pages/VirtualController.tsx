import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Advanced, Switch } from "../components/macro/common";
import { Panel } from "../components/controller/widgets";
import { ControllerVisual } from "../components/ControllerVisual";
import { CopyText } from "../components/CopyText";
import { Icon } from "../components/Icons";
import { useControllerPhase } from "../components/StatusPill";
import { StatusStrip, StatusTile } from "../components/StatusTile";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { backendReady, connectionLabel, modelLabel, modelWithRevision, outputLabel, usbIdText } from "../lib/format";
import { batteryText } from "../lib/diagHealth";
import { doubleInputAdvice, HIDHIDE_RELEASES } from "../lib/hidhide";
import { outputSummary } from "../lib/outputStatus";
import { VIGEMBUS_RELEASES } from "../lib/readiness";
import {
  hidHideLine, nextOption, OUTPUT_LABEL, outputOptions, STATE_LABEL, technicalFacts, vigemLine,
  type FactSource, type OutputOption,
} from "../lib/virtualControllerView";
import type { VirtualOutputKind } from "../types/engine";

const go = (page: string, tab?: string) => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page, tab } }));

/**
 * Setup › Virtual Controller: the controller games see, the driver it needs,
 * and avoiding double input. Every state shown comes from the engine; NEXUS
 * never installs drivers and can't see whether HidHide hides a device.
 */
export function VirtualControllerPage() {
  const { status, profile, setProfile, connection } = useEngine();
  const device = usePrimaryDevice();
  const phase = useControllerPhase();
  const ready = connection.kind === "ready";
  const [consent, setConsent] = useState<boolean | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<VirtualOutputKind | "consent" | null>(null);
  const [checking, setChecking] = useState(false);
  const [driverCheck, setDriverCheck] = useState<string | null>(null);

  const requested = status?.requestedOutput ?? "disabled";
  const active = device?.output.active ?? null;
  const driverReady = !!status && backendReady(status.outputBackendStatus);
  const summary = outputSummary({ output: device?.output ?? null, requested, consent, driverReady });
  const outputError = device?.output.lastError ?? null;
  const vigem = vigemLine(status);
  const hid = hidHideLine({ hidhide: status?.drivers.hidhide, outputActive: !!active });

  const loadConsent = () => {
    setConsentError(null);
    engineApi.getOutputConsent().then((c) => setConsent(c.enabled))
      .catch((e) => { setConsent(null); setConsentError(errorMessage(e)); });
  };
  useEffect(() => { if (ready) loadConsent(); }, [ready]);

  const choose = async (mode: VirtualOutputKind) => {
    if (pending || mode === requested) return;
    setError(null); setPending(mode);
    try { setProfile(await engineApi.setVirtualOutput(mode)); } catch (e) { setError(errorMessage(e)); }
    finally { setPending(null); }
  };
  const toggleConsent = async (on: boolean) => {
    setError(null); setPending("consent");
    try { setConsent((await engineApi.setOutputConsent(on)).enabled); } catch (e) { setError(errorMessage(e)); }
    finally { setPending(null); }
  };
  const checkDrivers = async () => {
    setChecking(true); setDriverCheck(null);
    try {
      const d = await engineApi.refreshDrivers();
      const word = (p: string) => (p === "installed" ? "installed" : p === "notInstalled" ? "not installed" : "unknown");
      setDriverCheck(`Checked just now: ViGEmBus ${word(d.vigembus)}, HidHide ${word(d.hidhide)}.`);
    } catch (e) { setDriverCheck(`Couldn't check the drivers: ${errorMessage(e)}`); }
    finally { setChecking(false); }
  };

  const outputTone = summary.tone === "ok" ? "ok" : summary.tone === "warn" ? "warn" : outputError ? "error" : "idle";
  const outputOff = !active && (consent === false || requested === "disabled");

  return (
    <div className="page vc-page">
      <header className="page-header">
        <div>
          <h1>Virtual Controller</h1>
          <p className="muted">Games receive your mapping, stick settings and macros through a virtual controller that NEXUS creates. Set it up once here; the choice is saved in each profile.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" disabled={!ready || checking} aria-busy={checking} onClick={() => void checkDrivers()}>
            <Icon name="refresh" size={14} /> Check drivers again
          </button>
        </div>
      </header>

      {connection.kind === "unavailable" && <div className="notice dev" role="status">The controller engine isn't running here (this is not the NEXUS desktop app), so nothing on this page is live and no setting can be changed.</div>}
      {connection.kind === "error" && <div className="notice error" role="alert">The controller engine didn't start: {connection.message}</div>}
      {driverCheck && <div className="notice dev" role="status">{driverCheck}</div>}

      <StatusStrip label="Virtual controller status">
        <StatusTile icon="controller" label="Physical controller" tone={phase.tone}
          value={device ? modelLabel[device.device.model] : phase.key === "loading" ? "Starting…" : "Not connected"}
          sub={device ? <>
            {device.device.connection !== "unknown" && <Icon name={device.device.connection} size={13} />}
            {connectionLabel[device.device.connection]} · {phase.label}
          </> : phase.label} />
        <StatusTile icon="output" label="Games see" tone={outputTone}
          value={active ? outputLabel[active] : outputOff ? "Off" : "No virtual controller"}
          sub={active ? summary.text : outputOff ? "Only your physical controller" : summary.text} />
        <StatusTile icon="shield" label="ViGEmBus driver" tone={vigem.tone} value={vigem.value} sub={vigem.short} />
        <StatusTile icon="layers" label="HidHide (optional)" tone={hid.tone} value={hid.value} sub={hid.short} />
      </StatusStrip>

      <div className="vc-layout">
        <div className="vc-col">
          <Panel title="Output" aside={<span className="badge dev">Experimental</span>}>
            <div className="vc-consent">
              <Switch checked={!!consent} disabled={!ready || consent === null || pending !== null} onChange={(on) => void toggleConsent(on)}
                label="Use the experimental virtual controller"
                tip="Off removes the virtual controller immediately; your profile's choice is kept" />
              <p className="muted small">Needs ViGEmBus, a free third-party driver that you install yourself. Its developer retired it in 2023, so NEXUS treats it as experimental and may replace it later. Turning this off removes the virtual controller at once and keeps your profile's choice.</p>
              {consentError && (
                <div className="notice error small" role="alert">
                  Couldn't read this setting: {consentError}{" "}
                  <button type="button" className="btn-ghost small" onClick={loadConsent}>Try again</button>
                </div>
              )}
            </div>
            <OutputChoice options={outputOptions({ requested, active, consent, ready })} pending={pending} onChoose={(k) => void choose(k)} />
            <div className="kv-row"><span className="muted">Saved in profile “{profile?.name ?? "…"}”</span><span>{profile ? OUTPUT_LABEL[profile.virtualOutput] : "…"}</span></div>
            <div className="kv-row"><span className="muted">Virtual controller now</span>
              <span className={summary.tone === "ok" ? "ok-text" : summary.tone === "warn" ? "warn-text" : undefined}>{summary.text}</span></div>
            {summary.detail && !outputError && <div className={summary.tone === "warn" ? "notice warn small" : "muted small"}>{summary.detail}</div>}
            {outputError && <div className="notice error" role="alert">{outputError}</div>}
            {error && <div className="notice error" role="alert">{error}</div>}
            {active && (
              <p className="muted small vc-check">
                <Icon name="checkCircle" size={14} /> <span>Check it in Windows: press <kbd>Win</kbd> + <kbd>R</kbd>, type <code>joy.cpl</code> and press Enter. “Controller (XBOX 360 For Windows)”
                should be listed; its Properties page shows the buttons NEXUS sends, including macros. Live Viewer › <button type="button" className="map-link" onClick={() => go("live-viewer", "output")}>Output Check</button> compares them for you.</span>
              </p>
            )}
          </Panel>

          <Panel title="ViGEmBus driver">
            <div className="kv-row"><span>Status</span><span className={`tone-text-${vigem.tone}`}>{vigem.value}</span></div>
            {!driverReady && status?.drivers.vigembus === "installed" && status.outputBackendStatus.state === "unavailable" && (
              <div className="notice warn small">{status.outputBackendStatus.reason}</div>
            )}
            {!driverReady ? (
              <ol className="small driver-steps">
                <li>Open the official ViGEmBus release page: <CopyText text={VIGEMBUS_RELEASES} /></li>
                <li>Download <b>ViGEmBus_1.22.0_x64_x86_arm64.exe</b> (the latest release) and run it. Windows asks for administrator approval: this is the driver's installer, not NEXUS.</li>
                <li>Come back here and click <b>Check drivers again</b>.</li>
              </ol>
            ) : <p className="muted small">{vigem.detail}</p>}
            <Advanced title="Remove ViGEmBus">
              <p className="muted small">
                NEXUS never installs or bundles drivers. To remove ViGEmBus: Windows Settings › Apps › Installed apps ›
                “Nefarius Virtual Gamepad Emulation Bus Driver” › Uninstall. NEXUS keeps working without it; games then simply don't see a virtual controller.
              </p>
            </Advanced>
          </Panel>

          <DoubleInputPanel outputActive={!!active} controllerConnected={!!device} />
        </div>

        <aside className="vc-col" aria-label="Controller details">
          <Panel title="Physical controller">
            {device ? (
              <>
                <div className="vc-visual">
                  <ControllerVisual state={device.input} live={phase.key === "live"} offlineLabel={phase.label} />
                </div>
                <div className="kv-row"><span className="muted">Name</span><span>{device.device.productName ?? modelLabel[device.device.model]}</span></div>
                <div className="kv-row"><span className="muted">Model</span><span>{modelWithRevision(device.device.model, device.device.productId)}</span></div>
                <div className="kv-row"><span className="muted">Connection</span><span className="vc-inline">
                  {device.device.connection !== "unknown" && <Icon name={device.device.connection} size={13} />}{connectionLabel[device.device.connection]}</span></div>
                <div className="kv-row"><span className="muted">Input</span><span className={`tone-text-${phase.tone}`}>{phase.label}</span></div>
                <div className="kv-row"><span className="muted">Battery</span><span>{batteryText(device.input?.battery ?? null)}</span></div>
                <div className="kv-row"><span className="muted">USB ID (vendor:product)</span><span className="mono">{usbIdText(device.device.vendorId, device.device.productId)}</span></div>
              </>
            ) : (
              <div className="empty-state">
                <Icon name="usb" size={22} />
                <strong>{phase.key === "loading" ? "Starting the controller engine…" : "No controller connected"}</strong>
                <span>{phase.detail}</span>
              </div>
            )}
          </Panel>

          <Panel title="Technical details">
            <TechnicalDetails />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** The output choice: Off, Xbox 360, DualShock 4 (not available yet). Arrow keys move between the available ones. */
function OutputChoice({ options, pending, onChoose }: {
  options: OutputOption[]; pending: VirtualOutputKind | "consent" | null; onChoose: (k: VirtualOutputKind) => void;
}) {
  const refs = useRef<Partial<Record<VirtualOutputKind, HTMLButtonElement | null>>>({});
  const focusKind = options.find((o) => o.checked)?.kind ?? options.find((o) => o.available)?.kind ?? options[0]!.kind;
  const onKey = (e: KeyboardEvent, from: VirtualOutputKind) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = nextOption(options, from, step);
    refs.current[next]?.focus();
    if (next !== from && options.find((o) => o.kind === next)?.available) onChoose(next);
  };
  return (
    <div className="vc-options-wrap">
      <span className="field-label" id="vc-output-label">Controller games see</span>
      <div className="vc-options" role="radiogroup" aria-labelledby="vc-output-label" aria-busy={pending !== null && pending !== "consent"}>
        {options.map((o) => (
          <button key={o.kind} ref={(el) => { refs.current[o.kind] = el; }} type="button" role="radio"
            aria-checked={o.checked} aria-disabled={!o.available || undefined}
            aria-labelledby={`vc-opt-${o.kind} vc-opt-${o.kind}-state`} aria-describedby={`vc-opt-${o.kind}-desc`}
            tabIndex={o.kind === focusKind ? 0 : -1}
            className={`vc-option state-${o.state}${o.checked ? " checked" : ""}`}
            onClick={() => { if (o.available) onChoose(o.kind); }}
            onKeyDown={(e) => onKey(e, o.kind)}>
            <span className="vc-radio" aria-hidden="true" />
            <span className="vc-option-text">
              <strong id={`vc-opt-${o.kind}`}>{o.label}</strong>
              <span id={`vc-opt-${o.kind}-desc`} className="small">{o.reason ?? o.description}</span>
            </span>
            <span id={`vc-opt-${o.kind}-state`} className={`badge ${o.state === "active" ? "tone-ok" : o.state === "selected" ? "default" : o.state === "unavailable" ? "dev" : "tone-neutral"}`}>
              {pending === o.kind ? "Switching…" : STATE_LABEL[o.state]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const SOURCE: Record<FactSource, { title: string; tip: string }> = {
  measured: { title: "Measured by NEXUS", tip: "Counted or timed by NEXUS itself." },
  reported: { title: "Reported by Windows or the driver", tip: "As the driver or Windows reports it; NEXUS doesn't check it." },
  estimate: { title: "Estimated", tip: "Inferred from data the controller sends; not a direct measurement." },
};

function TechnicalDetails() {
  const { status } = useEngine();
  const device = usePrimaryDevice();
  const facts = technicalFacts(device, status);
  return (
    <div className="vc-facts">
      {(["measured", "reported", "estimate"] as const).map((src) => {
        const list = facts.filter((f) => f.source === src);
        if (list.length === 0) return null;
        return (
          <div key={src} className="vc-fact-group">
            <h3 className="vc-fact-head">{SOURCE[src].title} <span className={`kind${src === "estimate" ? " est" : ""}`} data-tip={SOURCE[src].tip}>{src === "estimate" ? "estimate" : src}</span></h3>
            {list.map((f) => (
              <div key={f.label} className="kv-row"><span className="muted">{f.label}{f.hint && <span className="vc-fact-hint">{f.hint}</span>}</span><span className={/^\d/.test(f.value) ? "mono" : undefined}>{f.value}</span></div>
            ))}
          </div>
        );
      })}
      <button type="button" className="map-link small" onClick={() => go("performance")}>All timing in Performance</button>
    </div>
  );
}

/** Optional HidHide guide. NEXUS never installs HidHide or changes its settings. */
function DoubleInputPanel({ outputActive, controllerConnected }: { outputActive: boolean; controllerConnected: boolean }) {
  const { status, appInfo } = useEngine();
  const hidhide = status?.drivers.hidhide;
  const advice = doubleInputAdvice({ hidhide, outputActive, controllerConnected });
  const line = hidHideLine({ hidhide, outputActive });
  return (
    <Panel title="Avoid double input (optional)">
      <p className="muted small">
        Games and Steam can see <b>both</b> your physical DualSense or DualShock 4 and the virtual Xbox controller, so a press may count twice.
        HidHide, a free optional driver by the same developer as ViGEmBus, can hide your controller from games while NEXUS keeps reading it.
        NEXUS never installs HidHide or changes its settings; you set it up once in HidHide's own app. It is not required.
      </p>
      <div className="kv-row"><span>HidHide</span><span className={`tone-text-${line.tone}`}>{line.value}</span></div>
      <div className="kv-row"><span className="muted">Is your controller hidden?</span><span className="muted">NEXUS can't tell; check in HidHide</span></div>
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
          <li>Restart Windows if the installer asks, then click <b>Check drivers again</b> at the top of this page.</li>
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
