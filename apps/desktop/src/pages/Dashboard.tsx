import { ControllerVisual } from "../components/ControllerVisual";
import { SetupChecklist } from "../components/SetupChecklist";
import { Icon, type IconName } from "../components/Icons";
import { StatusStrip, StatusTile } from "../components/StatusTile";
import { useControllerPhase, type Tone } from "../components/StatusPill";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import {
  backendReady, connectionLabel, describeDeviceEvent, formatLabel, modelLabel, outputLabel, time,
} from "../lib/format";
import type { ControllerState } from "../types/engine";

const go = (page: string, tab?: string) => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page, tab } }));

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

const QUICK: { page: string; icon: IconName; title: string; text: string }[] = [
  { page: "mapping", icon: "mapping", title: "Mapping", text: "Change what each button does" },
  { page: "macro-studio", icon: "macro", title: "Macro Studio", text: "Record or build a macro" },
  { page: "profiles", icon: "profiles", title: "Profiles", text: "Switch, and link games" },
  { page: "live-viewer", icon: "live", title: "Live Viewer", text: "Test every input" },
];

export function Dashboard() {
  const { status, profile, deviceEvents } = useEngine();
  const phase = useControllerPhase();
  const device = usePrimaryDevice();
  const live = phase.key === "live";
  const input = device?.input ?? null;
  const battery = input?.battery;

  const requested = status?.requestedOutput ?? "disabled";
  const driverReady = status ? backendReady(status.outputBackendStatus) : false;
  const activeOutput = device?.output.active ?? null;
  const vigem = status?.drivers.vigembus;
  const playing = device?.playingMacros.length ?? 0;
  const armed = status?.macros.armed ?? 0;

  // Virtual controller: what games see now, and why not when they don't.
  const outputTone: Tone = activeOutput ? (device?.output.playerIndex ? "warn" : "ok")
    : device?.output.retrying ? "warn" : requested === "disabled" ? "idle" : driverReady ? "idle" : "error";
  const outputValue = activeOutput ? outputLabel[activeOutput]
    : device?.output.retrying ? "Reconnecting…" : requested === "disabled" ? "Off" : "Not connected";
  const outputSub = activeOutput
    ? `Connected${device?.output.playerIndex != null ? ` · player ${device.output.playerIndex + 1}` : ""}`
    : device?.output.retrying ? "Trying again automatically"
      : requested === "disabled" ? "Games don't see NEXUS"
        : vigem === "notInstalled" ? "ViGEmBus driver not installed"
          : driverReady ? `${outputLabel[requested]} · waiting for a controller` : "Driver not available yet";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{phase.detail}</p>
        </div>
      </header>

      <SetupChecklist />

      <StatusStrip label="Status">
        <StatusTile icon="controller" label="Controller" tone={phase.tone}
          value={device ? modelLabel[device.device.model] : "Not connected"}
          sub={device ? <>
            {device.device.connection !== "unknown" && <Icon name={device.device.connection} size={13} />}
            {connectionLabel[device.device.connection]} · {device.reportRateHz.toFixed(0)} reports/s{battery ? ` · ${battery.percent}%` : ""}
          </> : phase.label} />
        <StatusTile icon="output" label="Virtual controller" tone={outputTone} value={outputValue} sub={outputSub}
          action={activeOutput ? undefined : { label: "Set up", onClick: () => go("virtual-controller") }} />
        <StatusTile icon="profiles" label="Active profile" tone="idle" value={profile?.name ?? "—"}
          sub={profile ? (profile.games.length ? `Switches for ${profile.games.length} game${profile.games.length === 1 ? "" : "s"}` : "No game linked") : "—"}
          action={{ label: "Manage profiles", onClick: () => go("profiles") }} />
        <StatusTile icon="macro" label="Macros" tone={playing > 0 || (armed > 0 && status?.macros.gamesCanReceive) ? "ok" : "idle"}
          value={`${armed} on`}
          sub={playing > 0 ? `${playing} playing now` : status?.macros.gamesCanReceive ? "Reaching games" : "Testable in NEXUS only"} />
      </StatusStrip>

      <section className="dash-main">
        <div className="card visual-card">
          <div className="card-title-row">
            <h2>Live input</h2>
            {input && <span className="muted mono small">{formatLabel[input.format]}</span>}
          </div>
          <div className="visual-wrap">
            <ControllerVisual state={live ? input : null} live={live} offlineLabel={phase.key === "stale" ? "Input stopped" : "No live input"} />
          </div>
          {live && input ? <LiveReadout s={input} /> : (
            <p className="muted small center">Live values appear here only when a real controller is sending input.</p>
          )}
        </div>

        <div className="dash-side">
          <div className="card">
            <h2>Quick actions</h2>
            <div className="quick-actions">
              {QUICK.map((q) => (
                <button key={q.page} type="button" className="qa-item" onClick={() => go(q.page)}>
                  <Icon name={q.icon} size={17} />
                  <strong>{q.title}</strong>
                  <span>{q.text}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card events-card">
            <h2>Connection events</h2>
            {deviceEvents.length === 0 ? (
              <div className="empty-state">
                <Icon name="usb" size={20} />
                <span>No device events since NEXUS started.</span>
              </div>
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
        </div>
      </section>
    </div>
  );
}
