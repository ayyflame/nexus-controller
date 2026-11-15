import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icons";
import { useEngine } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { backendReady, hex, outputLabel, time } from "../lib/format";
import type { LogEntry, RawReport, VirtualOutputKind } from "../types/engine";

const OUTPUTS: VirtualOutputKind[] = ["disabled", "xbox360", "dualShock4"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <span className="muted">{label}</span>
      <span className="kv-value">{children}</span>
    </div>
  );
}

function VirtualOutputSection() {
  const { status, profile, setProfile, connection } = useEngine();
  const [error, setError] = useState<string | null>(null);
  const disabled = connection.kind !== "ready";
  const requested = status?.requestedOutput ?? profile?.virtualOutput ?? "disabled";
  const backend = status?.outputBackendStatus;

  const choose = async (mode: VirtualOutputKind) => {
    setError(null);
    try {
      setProfile(await engineApi.setVirtualOutput(mode));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="card">
      <h2>Virtual Output</h2>
      <p className="muted small">
        Which virtual controller games will see. Only one is ever active per physical controller, and the
        previous one is removed before switching. The choice is saved to the active profile.
      </p>
      <div className="segmented" role="radiogroup" aria-label="Virtual output">
        {OUTPUTS.map((o) => (
          <button key={o} role="radio" aria-checked={requested === o} disabled={disabled}
            className={requested === o ? "selected" : ""} onClick={() => choose(o)}>
            {outputLabel[o]}
          </button>
        ))}
      </div>
      {backend && !backendReady(backend) && (
        <div className="notice warn">
          <strong>No virtual controller driver.</strong>{" "}
          {backend.state === "unavailable" ? backend.reason : ""} Your selection is saved but no virtual device is created.
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
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
          <Row label="Automatic connect">Enabled (scans every second)</Row>
          <Row label="Automatic reconnect">Enabled</Row>
          {status?.enumerationError && <div className="notice error">{status.enumerationError}</div>}
          <button className="btn-secondary" disabled={connection.kind !== "ready"}
            onClick={() => void engineApi.rescanDevices()}>
            <Icon name="refresh" size={15} /> Scan now
          </button>
        </div>
      </div>

      <VirtualOutputSection />
      <DiagnosticsSection />
    </div>
  );
}
