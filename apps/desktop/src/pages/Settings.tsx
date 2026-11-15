import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icons";
import { useEngine } from "../hooks/useEngine";
import { buildDiagnosticsReport } from "../lib/diagnostics";
import { engineApi, errorMessage } from "../lib/engine";
import { hex, time } from "../lib/format";
import type { HidDiagnostic, LogEntry, RawReport } from "../types/engine";

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
    const t = setInterval(() => void refresh(), 2000);
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
        <h2>HID Devices (Sony)</h2>
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
                  ? <>Identified as <b>{d.identifiedModel}</b> · connection <b>{d.connection}</b> · origin <b>{d.origin}</b></>
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
    const t = setInterval(() => void refresh(), 250);
    return () => clearInterval(t);
  }, [auto, refresh]);

  return (
    <>
      <div className="card">
        <div className="card-title-row">
          <h2>Raw HID Reports</h2>
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
        <h2>Engine Log</h2>
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

export function Settings() {
  const { appInfo, status, connection } = useEngine();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Application, discovery and diagnostics.</p>
        </div>
      </header>

      {appInfo?.storageWarning && <div className="notice warn">{appInfo.storageWarning}</div>}

      <div className="settings-grid">
        <div className="card">
          <h2>Application</h2>
          <Row label="Version">{appInfo?.version ?? "—"}</Row>
          <Row label="Platform">{appInfo ? `${appInfo.os} / ${appInfo.arch}` : "—"}</Row>
          <Row label="Data folder"><span className="mono small break">{appInfo?.dataDir ?? "—"}</span></Row>
          <Row label="Start with Windows"><span className="muted">Planned for a later milestone</span></Row>
        </div>

        <div className="card">
          <h2>Device Discovery</h2>
          <Row label="HID backend">{status?.hidBackend ?? "—"}</Row>
          <Row label="Automatic connect">{status?.hotplugActive ? "Instant (Windows device notifications)" : "Enabled (scans every second)"}</Row>
          <Row label="Automatic reconnect">Enabled</Row>
          {status?.enumerationError && <div className="notice error">{status.enumerationError}</div>}
          <button className="btn-secondary" disabled={connection.kind !== "ready"}
            onClick={() => void engineApi.rescanDevices()}>
            <Icon name="refresh" size={15} /> Scan now
          </button>
        </div>
      </div>

      <div className="notice dev">Virtual controller type and driver status are under <strong>Controller › Virtual Output</strong>.</div>
      <HidDevicesSection />
      <DiagnosticsSection />
    </div>
  );
}
