import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icons";
import { useEngine } from "../hooks/useEngine";
import { buildDiagnosticsReport } from "../lib/diagnostics";
import { engineApi, errorMessage } from "../lib/engine";
import { hex, modelWithRevision, time } from "../lib/format";
import { describeUpdate, formatLastCheck, isBusy, releaseOf } from "../lib/updates";
import { useUpdates } from "../hooks/useUpdates";
import { pageHidden } from "../lib/visibility";
import { ReleaseNotes, UpdateActions } from "../components/UpdateBanner";
import { Switch } from "../components/macro/common";
import { ReportInspector } from "../components/ReportInspector";
import { DEFAULT_BEHAVIOUR, closeText, startupView } from "../lib/windowsIntegration";
import type { HidDiagnostic, LogEntry, RawReport, WindowBehaviour, WindowsIntegration } from "../types/engine";

function UpdatesCard() {
  const u = useUpdates();
  const st = u.status;
  const desc = st ? describeUpdate(st) : null;
  const busy = st ? isBusy(st.state) || st.state.kind === "readyToInstall" : true;
  const release = st ? releaseOf(st.state) : null;
  const failed = st?.state.kind === "failed" ? st.state.error : null;
  return (
    <div className="card">
      <Row label="Current version">{st?.currentVersion ?? "—"}</Row>
      <Row label="Channel">Stable</Row>
      <Row label="Check automatically">
        <Switch checked={st?.autoCheck ?? false} disabled={!st?.configured}
          onChange={(on) => void u.setAutoCheck(on)}
          label={st?.autoCheck ? "On (at start-up and every 6 hours)" : "Off"} />
      </Row>
      <Row label="Last checked">{st?.configured ? formatLastCheck(st.lastSuccessMs) : "—"}</Row>
      <Row label="Status">
        <span className={`update-status tone-${desc?.tone ?? "neutral"}`} aria-live="polite">
          {st ? desc?.text : u.error ?? "Loading…"}
        </span>
      </Row>
      {failed?.detail && (
        <details className="small muted"><summary>Details</summary><span className="mono break">{failed.detail}</span></details>
      )}
      {release && st?.state.kind === "available" && <ReleaseNotes notes={release.notes} />}
      <div className="row gap-sm" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn-secondary" disabled={!st?.configured || busy} onClick={() => void u.check()}>
          <Icon name="refresh" size={15} /> {st?.state.kind === "checking" ? "Checking…" : "Check for updates"}
        </button>
        {st && <UpdateActions status={st} actions={u} />}
      </div>
      {st && !st.configured && (
        <div className="notice dev">
          This build has no update server configured, so it never checks. Builds from published releases update automatically.
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        Updates are never installed without your OK. Each update is checked against NEXUS's signing key before it runs.
        Profiles, macros, calibration and settings are kept, and a backup of them is saved first.
      </p>
    </div>
  );
}

function WindowsCard() {
  const { connection } = useEngine();
  const ready = connection.kind === "ready";
  const [state, setState] = useState<WindowsIntegration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    engineApi.getWindowsIntegration().then(setState, (e) => setError(errorMessage(e)));
  }, [ready]);

  const run = async (f: () => Promise<WindowsIntegration>) => {
    setBusy(true);
    setError(null);
    try { setState(await f()); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const b = state?.behaviour ?? DEFAULT_BEHAVIOUR;
  const setB = (patch: Partial<WindowBehaviour>) => void run(() => engineApi.setWindowBehaviour({ ...b, ...patch }));
  const startup = startupView(ready ? state?.startWithWindows ?? null : { supported: false, enabled: false, disabledInWindows: false, error: null });
  const off = !ready || !state || busy;

  return (
    <div className="card">
      <h2>Windows</h2>
      <Row label="Start with Windows">
        <Switch checked={startup.checked} disabled={startup.disabled || busy}
          onChange={(on) => void run(() => engineApi.setStartWithWindows(on))}
          label={startup.checked ? "On" : "Off"} />
      </Row>
      <p className={`small ${startup.tone === "muted" ? "muted" : startup.tone === "warn" ? "warn-text" : "err-text"}`}>{startup.note}</p>
      <Row label="When started with Windows">
        <Switch checked={b.startHidden} disabled={off} onChange={(startHidden) => setB({ startHidden })}
          label={b.startHidden ? "Start in the tray" : "Open the window"} />
      </Row>
      <Row label="Close button">
        <Switch checked={b.closeToTray} disabled={off} onChange={(closeToTray) => setB({ closeToTray })}
          label={b.closeToTray ? "Keep running in the tray" : "Quit NEXUS"} />
      </Row>
      <Row label="Minimise">
        <Switch checked={b.minimizeToTray} disabled={off} onChange={(minimizeToTray) => setB({ minimizeToTray })}
          label={b.minimizeToTray ? "Hide to the tray" : "To the taskbar"} />
      </Row>
      <p className="small muted">{closeText(b)}</p>
      {error && <div className="notice error small">{error}</div>}
      <p className="small muted" style={{ marginTop: 8 }}>
        Only one copy of NEXUS runs at a time: opening it again brings back this window. Window size and position are
        remembered. Quitting releases every button and removes the virtual controller before NEXUS closes.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <span className="muted">{label}</span>
      <span className="kv-value">{children}</span>
    </div>
  );
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

function HidDevicesSection() {
  const { connection, appInfo } = useEngine();
  const [devices, setDevices] = useState<HidDiagnostic[]>([]);
  const [report, setReport] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  const ready = connection.kind === "ready";

  const refresh = useCallback(async () => {
    if (ready) setDevices(await engineApi.getHidDiagnostics());
  }, [ready]);
  useEffect(() => {
    void refresh();
    if (!ready) return;
    const t = setInterval(() => { if (!pageHidden()) void refresh(); }, 2000);
    return () => clearInterval(t);
  }, [ready, refresh]);

  const copyReport = async () => {
    setCopyState(null);
    try {
      const text = await buildDiagnosticsReport(appInfo);
      setReport(text);
      try {
        await navigator.clipboard.writeText(text);
        setCopyState("Copied to clipboard.");
      } catch {
        setCopyState("Clipboard unavailable: select the text below and copy it manually.");
      }
    } catch (e) {
      setCopyState(errorMessage(e));
    }
  };

  return (
    <div className="card">
      <div className="card-title-row">
        <h2>HID devices (Sony)</h2>
        <button className="btn-secondary" onClick={() => void copyReport()} disabled={!ready}>
          Copy diagnostics report
        </button>
      </div>
      <p className="muted small">
        Every Sony HID collection Windows reported in the last scan, and how NEXUS classified it. The diagnostics
        report adds recent raw reports and the engine log; serial numbers and MAC addresses are masked.
      </p>
      {devices.length === 0 ? <p className="muted small">No Sony HID devices found in the last scan.</p> : (
        <div className="hid-list">
          {devices.map((d) => (
            <div key={d.path} className="hid-item">
              <div className="row gap">
                <strong>{d.product ?? "Unnamed HID device"}</strong>
                <span className="mono small muted">VID {hex4(d.vendorId)} · PID {hex4(d.productId)} · usage {hex4(d.usagePage)}:{hex4(d.usage)}</span>
              </div>
              <div className="small">
                {d.identifiedModel
                  ? <>Identified as <b>{modelWithRevision(d.identifiedModel, d.productId)}</b> · connection <b>{d.connection}</b> · origin <b>{d.origin}</b></>
                  : <span className="muted">Not identified as a supported controller</span>}
                <span className="muted"> · report lengths in/out/feature {d.inputReportLen}/{d.outputReportLen}/{d.featureReportLen}</span>
              </div>
              <code className="mono hex">{d.instanceId ?? d.path}</code>
              {d.ancestorInstanceIds.length > 0 && (
                <code className="mono hex muted">↳ {d.ancestorInstanceIds.join("  ↳ ")}</code>
              )}
            </div>
          ))}
        </div>
      )}
      {copyState && <div className="notice dev small">{copyState}</div>}
      {report && <textarea className="report-box mono" readOnly value={report} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}

function DiagnosticsSection() {
  const { connection } = useEngine();
  const [raw, setRaw] = useState<RawReport[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [auto, setAuto] = useState(false);
  const ready = connection.kind === "ready";

  const refresh = useCallback(async () => {
    if (!ready) return;
    const [r, l] = await Promise.all([engineApi.getRawReports(12), engineApi.getEventLog(100)]);
    setRaw(r.reverse());
    setLog(l.reverse());
  }, [ready]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => { if (!pageHidden()) void refresh(); }, 250);
    return () => clearInterval(t);
  }, [auto, refresh]);

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <h2>Raw HID reports</h2>
          <div className="row gap">
            <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={!ready} /> Auto-refresh</label>
            <button className="btn-secondary" onClick={() => void refresh()} disabled={!ready}><Icon name="refresh" size={15} /> Refresh</button>
          </div>
        </div>
        <p className="muted small">The most recent input reports exactly as read from the device, newest first.</p>
        {raw.length === 0 ? <p className="muted small">No reports received.</p> : (
          <div className="raw-list">
            {raw.map((r, i) => (
              <div key={`${r.timestampMs}-${i}`} className={`raw-row${r.parseError ? " bad" : ""}`}>
                <span className="mono small muted">{time(r.timestampMs)} · {r.bytes.length} B</span>
                <code className="mono hex">{hex(r.bytes)}</code>
                {r.parseError && <span className="small err-text">{r.parseError}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Engine log</h2>
        {log.length === 0 ? <p className="muted small">No log entries.</p> : (
          <ul className="log-list">
            {log.map((l, i) => (
              <li key={`${l.timestampMs}-${i}`} className={`log-${l.level}`}>
                <span className="mono small muted">{time(l.timestampMs)}</span>
                <span className="log-cat mono small">{l.category}</span>
                <span>{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

const SECTIONS = [
  { id: "general", label: "General", icon: "settings" },
  { id: "updates", label: "Updates", icon: "download" },
  { id: "devices", label: "Devices", icon: "usb" },
  { id: "diagnostics", label: "Diagnostics", icon: "bug" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** The section list beside the settings: jumps to a section and shows which one is in view. */
function useCurrentSection(): [SectionId, (id: SectionId) => void] {
  const [current, setCurrent] = useState<SectionId>("general");
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>(".content");
    if (!scroller) return;
    const onScroll = () => {
      const top = scroller.getBoundingClientRect().top + 96;
      let at: SectionId = "general";
      for (const s of SECTIONS) {
        const el = document.getElementById(`settings-${s.id}`);
        if (el && el.getBoundingClientRect().top <= top) at = s.id;
      }
      // At the very bottom the last section counts as current even if short.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) at = SECTIONS[SECTIONS.length - 1]!.id;
      setCurrent(at);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  const jump = (id: SectionId) => {
    setCurrent(id);
    // The one place that scrolls smoothly (and not when reduced motion is asked for).
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  };
  return [current, jump];
}

function Section({ id, title, description, children }: { id: SectionId; title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
      <header>
        <h2 id={`settings-${id}-title`}>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

export function Settings() {
  const { appInfo, status, connection } = useEngine();
  const [current, jump] = useCurrentSection();
  const go = (page: string) => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page } }));
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">How NEXUS runs on this PC, updates, device discovery and diagnostics.</p>
        </div>
      </header>

      {appInfo?.storageWarning && <div className="notice warn">{appInfo.storageWarning}</div>}

      <div className="settings-layout">
        <nav className="settings-index" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={current === s.id ? "current" : undefined}
              aria-current={current === s.id ? "true" : undefined} onClick={() => jump(s.id)}>
              <Icon name={s.icon} size={16} /> {s.label}
            </button>
          ))}
        </nav>

        <div className="settings-sections">
          <Section id="general" title="General" description="This copy of NEXUS and how it behaves in Windows.">
            <div className="settings-grid">
              <div className="card">
                <h2>Application</h2>
                <Row label="Version">{appInfo?.version ?? "—"}</Row>
                <Row label="Platform">{appInfo ? `${appInfo.os} / ${appInfo.arch}` : "—"}</Row>
                <Row label="Data folder"><span className="mono small break">{appInfo?.dataDir ?? "—"}</span></Row>
                <Row label="Welcome guide"><button className="btn-ghost small" onClick={() => { try { localStorage.removeItem("nexus.onboarding.v1"); } catch { /* ignore */ } window.location.reload(); }}>Show again</button></Row>
                <p className="settings-note">Profiles and macros are stored separately from the program, so updates and reinstalls keep them.</p>
              </div>
              <WindowsCard />
            </div>
          </Section>

          <Section id="updates" title="Updates" description="New versions are checked against NEXUS's signing key and only installed with your OK.">
            <UpdatesCard />
          </Section>

          <Section id="devices" title="Devices" description={<>How NEXUS finds controllers. Virtual controller type and driver status are on the{" "}
            <button className="map-link" onClick={() => go("virtual-controller")}>Virtual Controller</button> page.</>}>
            <div className="card">
              <h2>Device discovery</h2>
              <Row label="HID backend">{status?.hidBackend ?? "—"}</Row>
              <Row label="Automatic connect">{status?.hotplugActive ? "Instant (Windows device notifications)" : "Enabled (scans every second)"}</Row>
              <Row label="Automatic reconnect">Enabled</Row>
              {status?.enumerationError && <div className="notice error">{status.enumerationError}</div>}
              <div className="row gap-sm" style={{ marginTop: 12 }}>
                <button className="btn-secondary" disabled={connection.kind !== "ready"}
                  onClick={() => void engineApi.rescanDevices()}>
                  <Icon name="refresh" size={15} /> Scan now
                </button>
              </div>
            </div>
            <HidDevicesSection />
          </Section>

          <Section id="diagnostics" title="Diagnostics" description="For troubleshooting and support: what the controller sends, byte by byte, and the engine's log.">
            <ReportInspector />
            <DiagnosticsSection />
          </Section>
        </div>
      </div>
    </div>
  );
}
