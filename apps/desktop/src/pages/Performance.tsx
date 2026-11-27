import { useMemo, useState, type ReactNode } from "react";
import { DeviceSelector } from "../components/controller/advanced";
import { Panel } from "../components/controller/widgets";
import { Icon } from "../components/Icons";
import { StatusStrip, StatusTile, type TileTone } from "../components/StatusTile";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { useNow } from "../hooks/useNow";
import { buildDiagnosticsReport } from "../lib/diagnostics";
import { freshness, reportAge } from "../lib/diagHealth";
import { errorMessage } from "../lib/engine";
import { connectionLabel, formatLabel, modelLabel, outputLabel } from "../lib/format";
import { formatNs } from "../lib/outputCheck";
import { withDefaults } from "../lib/processing";
import {
  DIST_COLUMNS, findingsHeadline, formatUs, performanceFindings, rateText, stageDist, usDist, type Dist, type Finding,
} from "../lib/performanceView";
import type { DeviceSnapshot } from "../types/engine";

const go = (page: string, tab?: string) => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page, tab } }));

function Kind({ estimate }: { estimate?: boolean }) {
  return estimate
    ? <span className="kind est" title="Estimated from data the controller sends; not a direct measurement">estimate</span>
    : <span className="kind" title="Measured directly by NEXUS">measured</span>;
}

/**
 * Test › Performance: what NEXUS measures about its own work, from the
 * controller's reports to the virtual controller. Read-only: it changes no
 * setting, and a value NEXUS can't measure says so.
 */
export function Performance() {
  const { status, appInfo, connection } = useEngine();
  const device = usePrimaryDevice();
  const [report, setReport] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportDiagnostics = async () => {
    setExporting(true); setReport(null);
    try {
      await navigator.clipboard.writeText(await buildDiagnosticsReport(appInfo));
      setReport({ tone: "ok", text: "Diagnostics report copied to the clipboard. Paste it into your bug report." });
    } catch (e) { setReport({ tone: "error", text: `Couldn't build the diagnostics report: ${errorMessage(e)}` }); }
    finally { setExporting(false); }
  };

  return (
    <div className="page perf-page">
      <header className="page-header">
        <div>
          <h1>Performance</h1>
          <p className="muted">What NEXUS measures about its own work, from each controller report to the virtual controller. Values NEXUS can't measure say so instead of showing 0.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" disabled={connection.kind !== "ready" || exporting} aria-busy={exporting} onClick={() => void exportDiagnostics()}>
            <Icon name="copy" size={14} /> Copy diagnostics
          </button>
        </div>
      </header>
      {report && <div className={`notice ${report.tone === "ok" ? "ok" : "error"}`} role={report.tone === "ok" ? "status" : "alert"}>{report.text}</div>}
      {connection.kind === "unavailable" && <div className="notice dev" role="status">The controller engine isn't running here (this is not the NEXUS desktop app), so there is nothing to measure.</div>}
      {connection.kind === "error" && <div className="notice error" role="alert">The controller engine didn't start: {connection.message}</div>}
      <DeviceSelector />

      {device ? <DeviceView device={device} /> : (
        <section className="card">
          <div className="empty-state">
            <Icon name="performance" size={22} />
            <strong>{connection.kind === "loading" || (connection.kind === "ready" && !status) ? "Starting the controller engine…" : "No controller connected"}</strong>
            <span>Timing appears here once a controller sends input. Connect a DualSense or DualShock 4 with a USB cable.</span>
          </div>
        </section>
      )}

      <div className="perf-grid">
        <ConfigurationPanel device={device} />
        <DiagnosticsPanel />
      </div>
    </div>
  );
}

function DeviceView({ device: d }: { device: DeviceSnapshot }) {
  const { status } = useEngine();
  const now = useNow(500);
  const findings = useMemo(() => performanceFindings(d, status, now), [d, status, now]);
  const head = findingsHeadline(findings);
  const f = freshness(reportAge(d.lastReportMs, now));
  const inputTone: TileTone = f === "live" || f === "slow" ? "ok" : f === "stale" ? "error" : "warn";
  const active = d.output.active;
  const call = d.stageLatency?.output;
  const slow = d.stageLatency?.slowOutput;
  const gap = d.flow?.reportGaps;
  const p = d.pipelineLatency;

  return (
    <>
      <StatusStrip label="Performance overview">
        <StatusTile icon={d.device.connection === "bluetooth" ? "bluetooth" : "usb"} label="Controller reports" tone={inputTone}
          value={rateText(d)}
          sub={gap?.samples && gap.meanUs !== undefined ? `One every ${(gap.meanUs / 1000).toFixed(2)} ms on average` : f === "stale" ? "Stopped sending" : "Spacing not measured yet"} />
        <StatusTile icon="bolt" label="Time inside NEXUS" tone={p.samples ? "ok" : "idle"}
          value={p.samples ? `${formatUs(p.p50Us)} median` : "Not measured yet"}
          sub={p.samples ? `99th % ${formatUs(p.p99Us)} · report read → virtual controller` : "Needs input reports"} />
        <StatusTile icon="output" label="Virtual controller submission" tone={!active ? "idle" : slow && slow.over50ms > 0 ? "error" : slow && slow.over4ms > 0 ? "warn" : "ok"}
          value={!active ? "Off" : call?.samples ? `${formatNs(call.p50Ns)} median` : "Not measured yet"}
          sub={!active ? "Nothing is submitted while it's off" : slow?.calls ? `${slow.over4ms} over 4 ms · ${slow.over50ms} over 50 ms` : "No driver calls timed yet"} />
        <StatusTile icon={head.tone === "ok" ? "checkCircle" : "alert"} label="Findings" tone={head.tone} value={head.value} sub={head.sub} />
      </StatusStrip>

      {findings.length > 0 && <Findings list={findings} />}

      <p className="perf-device muted small">
        Showing {modelLabel[d.device.model]} · {connectionLabel[d.device.connection]}. Timings cover about the last 256 reports (about 1 s over USB); counts are since the controller connected.
      </p>

      <div className="perf-grid">
        <Panel title="1 · Controller reports" aside={<Kind />}>
          <p className="muted small perf-lead">How evenly the controller's reports arrive. Report spacing is how often the controller sends, not a delay: over USB a report arrives about every 4 ms.</p>
          <DistTable caption="Time between controller reports" rows={[
            { label: "Time between reports", dist: usDist(d.flow?.reportGaps, "No reports yet") },
          ]} />
          <Rows rows={[
            ["Report rate", rateText(d)],
            ["Reports received", d.totalReports.toLocaleString("en-US")],
            ["Spacing since connect, min / avg / max", d.reportIntervals.intervals ? `${(d.reportIntervals.minUs / 1000).toFixed(2)} / ${(d.reportIntervals.meanUs / 1000).toFixed(2)} / ${(d.reportIntervals.maxUs / 1000).toFixed(1)} ms` : "No reports yet"],
            ["Late reports, over 8 ms / over 50 ms", d.reportIntervals.intervals ? `${d.reportIntervals.over8ms.toLocaleString("en-US")} / ${d.reportIntervals.over50ms.toLocaleString("en-US")}` : "No reports yet"],
            ["Unreadable reports", d.parseErrors.toLocaleString("en-US")],
            [<>Dropped reports <Kind estimate /></>, d.input ? d.sequenceGaps.toLocaleString("en-US") : "No input yet"],
          ]} />
        </Panel>

        <Panel title="2 · Processing in NEXUS" aside={<Kind />}>
          <p className="muted small perf-lead">From the moment NEXUS reads a report until the virtual controller has the result. The total is split into the stages below.</p>
          <DistTable caption="Processing time by stage" rows={[
            { label: "Total: read → virtual controller", dist: usDist(p, "No reports processed yet"), strong: true },
            { label: "Report hand-over", hint: "Read → processing starts", dist: stageDist(d.stageLatency?.input, "No reports processed yet") },
            { label: "Mapping", hint: "Sticks, triggers, remap, layers, gyro, touchpad", dist: stageDist(d.stageLatency?.mapping, "No reports processed yet") },
            { label: "Macros", dist: stageDist(d.stageLatency?.macros, "No reports processed yet") },
            { label: "Virtual controller driver call", hint: "Part 3 below", dist: active ? stageDist(call, "No frames sent yet") : { cells: null, missing: "Virtual controller off" } },
          ]} />
          <Rows rows={[
            ["Reports already waiting (NEXUS behind), most in a row", d.flow ? `${d.flow.queuedReports.toLocaleString("en-US")} · ${d.flow.longestBacklog}` : "Not reported by this engine build"],
            ["Stale reports skipped after slow calls", d.staleReportsSkipped === undefined ? "Not reported by this engine build" : d.staleReportsSkipped.toLocaleString("en-US")],
          ]} />
        </Panel>

        <Panel title="3 · Virtual controller submission" aside={<Kind />}>
          <p className="muted small perf-lead">Handing each frame to the ViGEmBus driver. {active ? `Games see ${outputLabel[active]}.` : "The virtual controller is off, so nothing is submitted."}</p>
          <DistTable caption="Virtual controller submission timing" rows={[
            { label: "Driver call (ViGEmBus)", dist: active ? stageDist(call, "No frames sent yet") : { cells: null, missing: "Virtual controller off" } },
            { label: "Time between frames sent", hint: "Should match the report spacing in part 1", dist: active ? usDist(d.flow?.outputGaps, "No frames sent yet") : { cells: null, missing: "Virtual controller off" } },
          ]} />
          <Rows rows={[
            ["Slow driver calls, over 4 ms / over 50 ms", !active ? "Virtual controller off" : !slow ? "Not reported by this engine build" : slow.calls ? `${slow.over4ms} / ${slow.over50ms} · longest ${formatNs(slow.longestNs)}` : "No frames sent yet"],
            ["Repeated frames (sent anyway)", !active ? "Virtual controller off" : d.flow ? `${d.flow.unchangedOutputs.toLocaleString("en-US")} of ${d.flow.outputs.toLocaleString("en-US")}` : "Not reported by this engine build"],
            ["Settings sent to the controller (lightbar, LEDs, vibration)", d.outputReportsSent.toLocaleString("en-US")],
          ]} />
        </Panel>

        <Panel title="4 · End to end" aside={<span className="badge dev">Not measured</span>}>
          <p className="small">NEXUS can't measure the full time from a button press to a game's reaction. It sees only its own part:</p>
          <ol className="perf-chain small">
            <li><strong>Controller and USB</strong><span className="muted">The controller samples and sends a report. NEXUS sees when it arrives, not when you pressed.</span></li>
            <li><strong>NEXUS</strong><span className="muted">{p.samples ? `${formatUs(p.p50Us)} median, ${formatUs(p.p99Us)} at the 99th percentile (part 2).` : "Measured in part 2 once reports arrive."}</span></li>
            <li><strong>Windows and the game</strong><span className="muted">When the game reads the virtual controller depends on the game. NEXUS can't see it.</span></li>
          </ol>
          <p className="muted small">Live Viewer › <button type="button" className="map-link" onClick={() => go("live-viewer", "output")}>Output Check</button> confirms that Windows receives exactly what NEXUS sends.</p>
        </Panel>
      </div>
    </>
  );
}

function Findings({ list }: { list: Finding[] }) {
  return (
    <section className="card perf-findings" aria-labelledby="perf-findings-title">
      <h2 id="perf-findings-title">Findings</h2>
      <ul>
        {list.map((f) => (
          <li key={f.id} className={`notice ${f.tone === "error" ? "error" : "warn"}`}>
            <strong>{f.title}</strong>
            <span>{f.detail}</span>
            {f.action && <button type="button" className="btn-ghost small" onClick={() => go(f.action!.page, f.action!.tab)}>{f.action.label}</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DistTable({ caption, rows }: { caption: string; rows: Array<{ label: string; hint?: string; dist: Dist; strong?: boolean }> }) {
  return (
    <div className="perf-dist-wrap">
      <table className="table perf-dist">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">Timing</th>{DIST_COLUMNS.map((c) => <th key={c} scope="col" className="right">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.strong ? "strong" : undefined}>
              <th scope="row">{r.label}{r.hint && <span className="perf-hint">{r.hint}</span>}</th>
              {r.dist.cells ? r.dist.cells.map((c, i) => <td key={i} className="right mono">{c}</td>)
                : <td colSpan={5} className="right muted perf-missing">{r.dist.missing}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rows({ rows }: { rows: Array<[ReactNode, string]> }) {
  return (
    <div className="perf-rows">
      {rows.map(([k, v], i) => (
        <div key={i} className="kv-row"><span className="muted">{k}</span><span className={/^[\d.,/·\s]+(?:[µnm]s)?$/.test(v) ? "mono" : undefined}>{v}</span></div>
      ))}
    </div>
  );
}

/** Read-only: the settings in effect that change what NEXUS does for each report. */
function ConfigurationPanel({ device }: { device: DeviceSnapshot | null }) {
  const { status, profile } = useEngine();
  const config = useMemo(() => withDefaults(profile?.processing), [profile?.processing]);
  const playing = device?.playingMacros.length ?? 0;
  return (
    <Panel title="Configuration in effect">
      <p className="muted small perf-lead">Performance has no settings of its own. These are the settings that change what NEXUS does for each report.</p>
      <Rows rows={[
        ["Connection", device ? connectionLabel[device.device.connection] : "No controller"],
        ["Report format", device?.input ? formatLabel[device.input.format] : "No input yet"],
        ["Virtual controller", status ? `${outputLabel[status.requestedOutput]} requested · ${device?.output.active ? `${outputLabel[device.output.active]} active` : "none active"}` : "Unknown"],
        ["Active profile", profile?.name ?? "Unknown"],
        ["Shift layers in this profile", profile ? String(config.layers.length) : "Unknown"],
        ["Gyro", profile ? (config.gyro.enabled ? "On" : "Off") : "Unknown"],
        ["Macros", status ? `${status.macros.armed} on · ${playing} playing now` : "Unknown"],
      ]} />
      <div className="row gap-sm wrap perf-links">
        <button type="button" className="btn-ghost small" onClick={() => go("profiles")}>Profiles</button>
        <button type="button" className="btn-ghost small" onClick={() => go("virtual-controller")}>Virtual Controller</button>
        <button type="button" className="btn-ghost small" onClick={() => go("macro-studio")}>Macro Studio</button>
      </div>
    </Panel>
  );
}

function DiagnosticsPanel() {
  const { status, connection } = useEngine();
  const stats = status?.stats;
  const device = usePrimaryDevice();
  return (
    <Panel title="Diagnostics">
      <Rows rows={[
        ["Engine", connection.kind === "ready" ? "Running" : connection.kind === "loading" ? "Starting…" : connection.kind === "error" ? "Didn't start" : "Not available here"],
        ["Controller access (HID)", !status ? "Unknown" : status.hidAvailable ? `Available (${status.hidBackend})` : "Not available"],
        ["Plug-in detection", !status ? "Unknown" : status.hotplugActive ? "Active" : "Not active (NEXUS checks periodically)"],
        ["Connections since NEXUS started", stats ? stats.connects.toLocaleString("en-US") : "Unknown"],
        ["Disconnects · connection errors", stats ? `${stats.disconnects.toLocaleString("en-US")} · ${(stats.connectionErrors ?? 0).toLocaleString("en-US")}` : "Unknown"],
      ]} />
      {status?.enumerationError && <div className="notice warn small">Device search failed: {status.enumerationError}</div>}
      {device?.lastParseError && <div className="notice warn small">Last unreadable report: {device.lastParseError}</div>}
      <p className="muted small">Copy diagnostics (top of the page) puts a report on the clipboard: status, timings, recent raw reports and the event log. It leaves out serial numbers, your user name in file paths, and your macros and profiles.</p>
    </Panel>
  );
}
