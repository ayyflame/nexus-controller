import { useState } from "react";
import { DeviceSelector } from "../components/controller/advanced";
import { useEngine } from "../hooks/useEngine";
import { buildDiagnosticsReport } from "../lib/diagnostics";
import { errorMessage } from "../lib/engine";
import { connectionLabel, modelLabel, outputLabel } from "../lib/format";
import { slowCallsText, stageText } from "../lib/outputCheck";
import type { SlowCalls } from "../types/engine";

function Kind({ estimate }: { estimate?: boolean }) {
  return estimate
    ? <span className="kind est" data-tip="Estimated from data the controller sends; not a direct measurement">estimate</span>
    : <span className="kind" data-tip="Measured directly by NEXUS">measured</span>;
}

function SlowCallsCell({ calls }: { calls: SlowCalls | undefined }) {
  const s = slowCallsText(calls);
  return <td className={`right mono perf-slow tone-${s.tone}`}>{s.text}</td>;
}

export function Performance() {
  const { status, appInfo } = useEngine();
  const devices = status?.devices ?? [];
  const [copied, setCopied] = useState<string | null>(null);
  const stats = status?.stats;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Performance</h1>
          <p className="muted">Live input statistics. Values marked <em>measured</em> are measured by NEXUS; <em>estimate</em> values are derived and may be imprecise.</p>
        </div>
        <button className="btn-secondary" onClick={async () => {
          try { await navigator.clipboard.writeText(await buildDiagnosticsReport(appInfo)); setCopied("Diagnostics report copied to the clipboard."); }
          catch (e) { setCopied(errorMessage(e)); }
        }}>Export diagnostics</button>
      </header>
      {copied && <div className="notice dev" role="status">{copied}</div>}
      <DeviceSelector />

      <section className="stat-grid">
        <div className="card stat"><div className="stat-label">Physical controllers</div><div className="stat-value">{devices.length}</div>
          <div className="stat-sub">{devices.map((d) => connectionLabel[d.device.connection]).join(", ") || "None connected"}</div></div>
        <div className="card stat"><div className="stat-label">Virtual controllers</div>
          <div className="stat-value">{devices.filter((d) => d.output.active).length}</div>
          <div className="stat-sub">{status ? `Requested: ${outputLabel[status.requestedOutput]}` : "—"}</div></div>
        <div className="card stat"><div className="stat-label">Connections since start</div><div className="stat-value">{stats?.connects ?? 0}</div>
          <div className="stat-sub">{stats?.disconnects ?? 0} disconnects · {stats?.connectionErrors ?? 0} errors</div></div>
        <div className="card stat"><div className="stat-label">Macros</div><div className="stat-value">{status?.macros.armed ?? 0} on</div>
          <div className="stat-sub">{devices.reduce((n, d) => n + d.playingMacros.length, 0)} playing now</div></div>
      </section>

      {devices.length === 0 ? <div className="card"><p className="muted">No controller connected.</p></div> : devices.map((d, i) => (
        <section key={d.device.id} className="card panel">
          <h2>Controller {i + 1}: {modelLabel[d.device.model]} ({connectionLabel[d.device.connection]})</h2>
          <table className="table">
            <tbody>
              <tr><td>Input report rate <Kind /></td><td className="right mono">{d.reportRateHz.toFixed(1)} Hz</td></tr>
              <tr><td>NEXUS processing time, median / 99th percentile / max <Kind /></td>
                <td className="right mono">{d.pipelineLatency.samples ? `${d.pipelineLatency.p50Us} / ${d.pipelineLatency.p99Us} / ${d.pipelineLatency.maxUs} µs` : "—"}</td></tr>
              <tr><td colSpan={2} className="perf-stages-head">Where that time goes, median / 99th percentile / max</td></tr>
              <tr><td className="perf-stage">Report hand-over (read → processing starts) <Kind /></td><td className="right mono">{stageText(d.stageLatency?.input)}</td></tr>
              <tr><td className="perf-stage">Mapping: sticks, triggers, remap, layers, gyro, touchpad <Kind /></td><td className="right mono">{stageText(d.stageLatency?.mapping)}</td></tr>
              <tr><td className="perf-stage">Macros <Kind /></td><td className="right mono">{stageText(d.stageLatency?.macros)}</td></tr>
              <tr><td className="perf-stage">Virtual controller driver call (ViGEmBus) <Kind /></td><td className="right mono">{stageText(d.stageLatency?.output)}</td></tr>
              <tr>
                <td className="perf-stage" data-tip="Since the controller connected. A driver call over 4 ms holds up the next report; over 50 ms is a stall you could notice in a game.">
                  Slow driver calls <Kind />
                </td>
                <SlowCallsCell calls={d.stageLatency?.slowOutput} />
              </tr>
              <tr><td>Reports received <Kind /></td><td className="right mono">{d.totalReports.toLocaleString()}</td></tr>
              <tr><td>Input errors (unreadable reports) <Kind /></td><td className="right mono">{d.parseErrors.toLocaleString()}</td></tr>
              <tr><td>Dropped reports (from the controller's sequence counter) <Kind estimate /></td><td className="right mono">{d.sequenceGaps.toLocaleString()}</td></tr>
              <tr><td>Time between reports, min / average / max (USB normal ≈ 4 ms) <Kind /></td>
                <td className="right mono">{d.reportIntervals.intervals ? `${(d.reportIntervals.minUs / 1000).toFixed(2)} / ${(d.reportIntervals.meanUs / 1000).toFixed(2)} / ${(d.reportIntervals.maxUs / 1000).toFixed(1)} ms` : "—"}</td></tr>
              <tr><td>Late reports since connect: over 8 ms / over 50 ms <Kind /></td>
                <td className="right mono">{d.reportIntervals.intervals ? `${d.reportIntervals.over8ms.toLocaleString()} / ${d.reportIntervals.over50ms.toLocaleString()}` : "—"}</td></tr>
              <tr><td>Settings sent to the controller (lightbar, LEDs, vibration) <Kind /></td><td className="right mono">{d.outputReportsSent.toLocaleString()}</td></tr>
              <tr><td>Virtual output updates</td><td className="right">{d.output.active ? <span className="ok-text">Active</span> : <span className="muted">Not active (virtual output not enabled)</span>}</td></tr>
              <tr><td>Macros playing</td><td className="right">{d.playingMacros.length || "None"}</td></tr>
            </tbody>
          </table>
        </section>
      ))}
      <div className="notice dev">These times cover NEXUS itself: from the moment a report is read to the moment the virtual controller has it. How quickly a game reacts after that depends on the game. Live Viewer › Output Check confirms that Windows receives exactly what NEXUS sends.</div>
    </div>
  );
}
