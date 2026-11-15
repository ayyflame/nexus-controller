import type { PageId } from "../components/Sidebar";

interface PlaceholderInfo { title: string; summary: string; planned: string[]; milestone: string }

export const PLACEHOLDERS: Partial<Record<PageId, PlaceholderInfo>> = {
  "stick-tuning": {
    title: "Stick Tuning",
    summary: "Shape how each analog stick responds.",
    planned: ["Inner and outer deadzones (radial and axial)", "Response curves and sensitivity", "Anti-deadzone for game compatibility", "Live input vs. output plot"],
    milestone: "Milestone 3",
  },
  "button-mapping": {
    title: "Button Mapping",
    summary: "Remap any input to any virtual output control.",
    planned: ["Per-profile remapping", "Shift layers", "Touchpad regions as buttons", "Edge back paddles"],
    milestone: "Milestone 3",
  },
  "trigger-settings": {
    title: "Trigger Settings",
    summary: "Analog trigger ranges and DualSense adaptive trigger effects.",
    planned: ["Trigger deadzones and hair-trigger thresholds", "Adaptive trigger resistance profiles", "Digital/analog behaviour per output mode"],
    milestone: "Milestone 4",
  },
  "macro-studio": {
    title: "Macro Studio",
    summary: "Record and play back user-triggered input sequences.",
    planned: ["Timeline editor", "Record from controller", "Trigger bindings and repeat options"],
    milestone: "Milestone 5",
  },
  "controller-settings": {
    title: "Controller Settings",
    summary: "Hardware features of the connected DualSense.",
    planned: ["Lightbar colour and player LEDs", "Rumble strength", "Gyro calibration", "Bluetooth power-off"],
    milestone: "Milestone 4",
  },
  "obs-overlay": {
    title: "OBS Overlay",
    summary: "A browser source showing live controller input for streams.",
    planned: ["Local overlay server", "Themes matching NEXUS", "Per-scene layouts"],
    milestone: "Milestone 6",
  },
};

export function Placeholder({ info }: { info: PlaceholderInfo }) {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{info.title}</h1>
          <p className="muted">{info.summary}</p>
        </div>
        <span className="badge dev">In development · {info.milestone}</span>
      </header>
      <div className="card placeholder">
        <p>This page is a development placeholder. Nothing here is functional yet, and no settings are applied.</p>
        <h3>Planned</h3>
        <ul className="planned">
          {info.planned.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </div>
    </div>
  );
}
