import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEngine } from "../hooks/useEngine";
import { errorMessage } from "../lib/engine";
import {
  ACTION_MS, BASELINE_MS, PRESET_LABELS, byteValue, describeButtons, describeMask, hex4, totalButtons, usageLabel,
  verdictBadge, type HidInterfaceDetails, type InspectorView, type LabeledCapture,
} from "../lib/inspector";
import type { ExportResult } from "../types/engine";

const api = {
  view: () => invoke<InspectorView>("inspector_view"),
  clear: () => invoke<InspectorView>("inspector_clear"),
  record: (baseline: boolean, label: string | null, durationMs: number) =>
    invoke<InspectorView>("inspector_record", { baseline, label, durationMs, deviceId: null }),
  interfaces: () => invoke<HidInterfaceDetails[]>("inspector_interfaces", { deviceId: null }),
  exportAll: () => invoke<ExportResult>("inspector_export"),
};

function CaptureResult({ c }: { c: LabeledCapture }) {
  const a = c.analysis;
  const badge = verdictBadge(a.verdict);
  return (
    <div className="inspector-capture">
      <div className="row gap-sm">
        <strong>{c.label}</strong>
        <span className={`badge tone-${badge.tone}`}>{badge.text}</span>
        <span className="small muted">{a.actionReports} reports</span>
      </div>
      <p className="small">{a.summary}</p>
      {a.changes.length > 0 && (
        <table className="table inspector-table">
          <thead><tr><th>Byte</th><th>Field</th><th>Rest → pressed</th><th>Changed bits</th><th>Meaning</th><th className="right">Reports</th></tr></thead>
          <tbody>
            {a.changes.map((ch) => (
              <tr key={ch.index} className={ch.undecodedBits ? "inspector-candidate" : undefined}>
                <td className="mono">{ch.index}</td>
                <td className="small">{ch.field}</td>
                <td className="mono small">{byteValue(ch.baseline)} → {ch.valuesSeen.map(byteValue).join(", ")}</td>
                <td className="mono small">
                  {ch.setBits ? <>set {describeMask(ch.setBits)}</> : null}
                  {ch.clearedBits ? <> cleared {describeMask(ch.clearedBits)}</> : null}
                </td>
                <td className="small">
                  {ch.decoded.length > 0 && <span>{ch.decoded.join(", ")}</span>}
                  {ch.undecodedBits ? <span className="warn-text"> not decoded by NEXUS {describeMask(ch.undecodedBits)}</span> : null}
                  {ch.hints.map((h) => <div key={h} className="muted">{h}</div>)}
                </td>
                <td className="right mono small">{Math.round((ch.reportsChanged / Math.max(1, a.actionReports)) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {a.notes.map((n) => <div key={n} className="small muted">• {n}</div>)}
    </div>
  );
}

function Interfaces({ list, deviceId }: { list: HidInterfaceDetails[]; deviceId: string | null }) {
  return (
    <table className="table inspector-table">
      <thead><tr><th>Interface</th><th>VID:PID</th><th>Type</th><th>Report bytes in/out/feature</th><th>Declared buttons</th><th>Declared values</th></tr></thead>
      <tbody>
        {list.map((d) => (
          <tr key={d.path}>
            <td className="small">{d.product ?? "Unnamed"}{d.path === deviceId && <span className="badge tone-ok"> read by NEXUS</span>}</td>
            <td className="mono small">{hex4(d.vendorId)}:{hex4(d.productId)}</td>
            <td className="small">{usageLabel(d.usagePage, d.usage)}</td>
            <td className="mono small">{d.inputReportLen}/{d.outputReportLen}/{d.featureReportLen}</td>
            <td className="small">{d.capsUnavailable ? "—" : `${totalButtons(d.inputButtons)}: ${describeButtons(d.inputButtons)}`}</td>
            <td className="small">{d.capsUnavailable ? "—" : `${d.inputValues.length} field group${d.inputValues.length === 1 ? "" : "s"}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Finds which bits of the raw USB report change when you press something.
 * Built to investigate back paddles (e.g. ModdedZone MZ Titan). Read-only.
 */
export function ReportInspector() {
  const { connection, status } = useEngine();
  const connected = connection.kind === "ready" && (status?.devices.length ?? 0) > 0;
  const [view, setView] = useState<InspectorView | null>(null);
  const [busy, setBusy] = useState<null | { what: string; until: number }>(null);
  const [now, setNow] = useState(Date.now());
  const [preset, setPreset] = useState(PRESET_LABELS[0]!);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [interfaces, setInterfaces] = useState<HidInterfaceDetails[] | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => { if (connection.kind === "ready") api.view().then(setView).catch(() => {}); }, [connection.kind]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [busy]);

  const record = async (baseline: boolean) => {
    const label = baseline ? null : (preset === "Custom" ? custom : preset);
    const ms = baseline ? BASELINE_MS : ACTION_MS;
    setError(null); setExported(null);
    setBusy({ what: baseline ? "Hands off the controller…" : `Hold “${label}” now…`, until: Date.now() + ms });
    try { setView(await api.record(baseline, label, ms)); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };

  const remaining = busy ? Math.max(0, (busy.until - now) / 1000) : 0;
  return (
    <div className="card">
      <div className="card-title-row">
        <h2>Report Inspector</h2>
        <div className="row gap-sm">
          <button className="btn-secondary" disabled={!connected || !!busy}
            onClick={async () => { setError(null); try { setInterfaces(await api.interfaces()); } catch (e) { setError(errorMessage(e)); } }}>
            List interfaces
          </button>
          <button className="btn-secondary" disabled={!view?.baseline || !!busy}
            onClick={async () => { setError(null); try { const r = await api.exportAll(); setExported(r.path ? `Saved to ${r.path}` : "Couldn't write the file."); } catch (e) { setError(errorMessage(e)); } }}>
            Export captures
          </button>
          <button className="btn-ghost" disabled={!view?.baseline || !!busy}
            onClick={async () => { setView(await api.clear()); setExported(null); }}>Clear</button>
        </div>
      </div>
      <p className="muted small">
        Shows exactly which bits of the controller's USB report change when you press something, for example a back paddle.
        Nothing is changed on the controller. A paddle mapped to a normal button (e.g. Cross) shows as that button: NEXUS can't
        tell them apart. Only data NEXUS doesn't decode yet is a candidate independent input.
      </p>

      <div className="inspector-steps">
        <div className="row gap-sm">
          <span className="step-num">1</span>
          <button className="btn-secondary" disabled={!connected || !!busy} onClick={() => void record(true)}>
            Record baseline ({BASELINE_MS / 1000} s, hands off)
          </button>
          {view?.baseline && <span className="small muted">{view.baseline.reports} reports · noisy bytes {view.baseline.noisyBytes.join(", ") || "none"}</span>}
        </div>
        <div className="row gap-sm">
          <span className="step-num">2</span>
          <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)} disabled={!!busy} aria-label="What you will press">
            {[...PRESET_LABELS, "Custom"].map((l) => <option key={l}>{l}</option>)}
          </select>
          {preset === "Custom" && <input className="text-input" placeholder="e.g. Left paddle (native mode)" value={custom} maxLength={60}
            onChange={(e) => setCustom(e.target.value)} />}
          <button className="btn-primary" disabled={!connected || !view?.baseline || !!busy} onClick={() => void record(false)}>
            Record while holding ({ACTION_MS / 1000} s)
          </button>
        </div>
      </div>

      {!connected && <div className="notice dev small">Connect the controller with a USB cable to use the inspector.</div>}
      {busy && <div className="notice warn" role="status">{busy.what} {remaining.toFixed(1)} s</div>}
      {error && <div className="notice error">{error}</div>}
      {exported && <div className="notice dev small">{exported}</div>}

      {view?.captures.map((c, i) => <CaptureResult key={`${c.label}-${i}`} c={c} />)}

      {interfaces && (
        <>
          <h3 className="section-title">Interfaces of this USB device</h3>
          <p className="muted small">
            Every HID interface Windows reports for the controller, including ones NEXUS doesn't read. Compare with a regular
            DualSense if you can: an extra interface, or more declared buttons than a regular DualSense, can mean the paddles
            are reported separately.
          </p>
          <Interfaces list={interfaces} deviceId={view?.deviceId ?? status?.devices[0]?.device.id ?? null} />
        </>
      )}
    </div>
  );
}
