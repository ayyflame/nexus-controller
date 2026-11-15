import type { ReactNode } from "react";
import { ControllerVisual } from "../components/ControllerVisual";
import { Icon } from "../components/Icons";
import { StatusPill, useControllerPhase } from "../components/StatusPill";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import {
  backendReady, connectionLabel, describeDeviceEvent, formatLabel, modelLabel, outputLabel, time,
} from "../lib/format";
import type { ControllerState } from "../types/engine";

function StatCard({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`card stat${accent ? " accent" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Axis({ label, value }: { label: string; value: number }) {
  const pct = ((value + 1) / 2) * 100;
  return (
    <div className="axis">
      <span className="axis-label">{label}</span>
      <div className="axis-track"><div className="axis-centre" /><div className="axis-thumb" style={{ left: `${pct}%` }} /></div>
      <span className="mono axis-num">{value.toFixed(3)}</span>
    </div>
  );
}

function Bar({ label, value, raw }: { label: string; value: number; raw: number }) {
  return (
    <div className="axis">
      <span className="axis-label">{label}</span>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${value * 100}%` }} /></div>
      <span className="mono axis-num">{raw}</span>
    </div>
  );
}

function LiveReadout({ s }: { s: ControllerState }) {
  return (
    <div className="readout">
      <Axis label="LX" value={s.leftStick.x} />
      <Axis label="LY" value={s.leftStick.y} />
      <Axis label="RX" value={s.rightStick.x} />
      <Axis label="RY" value={s.rightStick.y} />
      <Bar label="L2" value={s.leftTrigger.value} raw={s.leftTrigger.raw} />
      <Bar label="R2" value={s.rightTrigger.value} raw={s.rightTrigger.raw} />
    </div>
  );
}

export function Dashboard() {
  const { status, profile, deviceEvents } = useEngine();
  const phase = useControllerPhase();
  const device = usePrimaryDevice();
  const live = phase.key === "live";
  const input = device?.input ?? null;
  const battery = input?.battery;

  const requested = status?.requestedOutput ?? "disabled";
  const driverReady = status ? backendReady(status.outputBackendStatus) : false;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{phase.detail}</p>
        </div>
        <StatusPill tone={phase.tone}>{phase.label}</StatusPill>
      </header>

      <section className="stat-grid">
        <StatCard
          label="Controller"
          accent={live}
          value={device ? modelLabel[device.device.model] : "—"}
          sub={device ? (battery ? `Battery ${battery.percent}% · ${battery.status}` : "Battery not reported") : phase.label}
        />
        <StatCard
          label="Connection"
          value={device ? (
            <span className="inline-icon">
              {device.device.connection !== "unknown" && <Icon name={device.device.connection} size={18} />}
              {connectionLabel[device.device.connection]}
            </span>
          ) : "—"}
          sub={device ? `${device.reportRateHz.toFixed(0)} reports/s` : "Not connected"}
        />
        <StatCard
          label="Virtual Output"
          value={outputLabel[requested]}
          sub={requested === "disabled" ? "No virtual controller" : driverReady ? "Driver ready" : "Not active · no driver installed"}
        />
        <StatCard label="Profile" value={profile?.name ?? "—"} sub="Last used profile" />
      </section>

      <section className="dash-main">
        <div className="card visual-card">
          <div className="card-title-row">
            <h2>Live Input</h2>
            {input && <span className="muted mono small">{formatLabel[input.format]}</span>}
          </div>
          <div className="visual-wrap">
            <ControllerVisual state={live ? input : null} live={live} />
            {!live && <div className="visual-overlay">{phase.key === "stale" ? "Input stopped" : "No live input"}</div>}
          </div>
          {live && input ? <LiveReadout s={input} /> : (
            <p className="muted small center">Live values appear here only when a real controller is sending input.</p>
          )}
        </div>

        <div className="card events-card">
          <h2>Connection Events</h2>
          {deviceEvents.length === 0 ? (
            <p className="muted small">No device events since NEXUS started.</p>
          ) : (
            <ul className="event-list">
              {deviceEvents.map((e, i) => (
                <li key={`${e.at}-${i}`} className={`event ev-${e.event.type}`}>
                  <span className="mono small muted">{time(e.at)}</span>
                  <span>{describeDeviceEvent(e.event)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
