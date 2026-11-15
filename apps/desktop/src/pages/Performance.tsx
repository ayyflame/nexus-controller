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
            <thead><tr><th>Controller</th><th>Connection</th><th className="right">Report rate</th><th className="right">Reports</th><th className="right">Parse errors</th></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.device.id}>
                  <td>{modelLabel[d.device.model]}</td>
                  <td>{connectionLabel[d.device.connection]}</td>
                  <td className="right mono">{d.reportRateHz.toFixed(1)} Hz</td>
                  <td className="right mono">{d.totalReports.toLocaleString()}</td>
                  <td className="right mono">{d.parseErrors.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="notice dev">
        <strong>In development.</strong> End-to-end latency, report jitter histograms, processing time per stage and
        virtual-output timing will be added once virtual output exists (Milestone 2–3).
      </div>
    </div>
  );
}
