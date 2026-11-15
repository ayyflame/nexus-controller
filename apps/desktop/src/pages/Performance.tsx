import { useEngine } from "../hooks/useEngine";
import { connectionLabel, modelLabel } from "../lib/format";

export function Performance() {
  const { status } = useEngine();
  const devices = status?.devices ?? [];
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Performance</h1>
          <p className="muted">Measured input statistics from connected controllers.</p>
        </div>
      </header>
      <div className="card">
        <h2>Input Streams</h2>
        {devices.length === 0 ? <p className="muted">No controller connected.</p> : (
          <table className="table">
            <thead><tr><th>Controller</th><th>Connection</th><th className="right">Report rate</th><th className="right">Reports</th><th className="right">Parse errors</th><th className="right" data-tip="Time NEXUS adds per report: processing, macros and output">NEXUS time p50 / p99</th></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.device.id}>
                  <td>{modelLabel[d.device.model]}</td>
                  <td>{connectionLabel[d.device.connection]}</td>
                  <td className="right mono">{d.reportRateHz.toFixed(1)} Hz</td>
                  <td className="right mono">{d.totalReports.toLocaleString()}</td>
                  <td className="right mono">{d.parseErrors.toLocaleString()}</td>
                  <td className="right mono">{d.pipelineLatency.samples ? `${d.pipelineLatency.p50Us} µs / ${d.pipelineLatency.p99Us} µs` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="notice dev">
        <strong>Measured here:</strong> the time NEXUS itself adds to each report (sticks, triggers, remapping, macros and output), over the last 256 reports.
        End-to-end latency to the game will be measured once virtual output is enabled.
      </div>
    </div>
  );
}
