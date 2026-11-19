import { useRef } from "react";
import { Advanced, Switch } from "../macro/common";
import { Panel, Segmented, Slider } from "./widgets";
import { ButtonSelect } from "./advanced";
import { BUTTONS } from "../../lib/macros";
import {
  ROUTING_PRESETS, directionButtons, routingPresetId, routingText, sourceLabel, stickDirections,
} from "../../lib/stickMapping";
import type { MacroButton, ProcessingConfig, StickButtons, StickRouting, StickSource } from "../../types/engine";

type Side = "leftStick" | "rightStick";
const sideName = (s: Side) => (s === "leftStick" ? "left stick" : "right stick");

/** Which physical stick the game gets as its left and right stick (whole profile). */
export function StickRoutingPanel({ config, onChange }: { config: ProcessingConfig; onChange: (c: ProcessingConfig) => void }) {
  const r = config.stickRouting;
  const set = (patch: Partial<StickRouting>) => onChange({ ...config, stickRouting: { ...r, ...patch } });
  const sources: Array<{ value: StickSource; label: string }> = (["left", "right", "off"] as const).map((v) => ({ value: v, label: sourceLabel(v) }));
  return (
    <Panel title="Stick swap">
      <div className="preset-row">
        {ROUTING_PRESETS.map((p) => (
          <button key={p.id} className={`preset${routingPresetId(r) === p.id ? " selected" : ""}`} data-tip={p.hint}
            onClick={() => set(p.routing)}>{p.label}</button>
        ))}
      </div>
      <p className="small muted">{routingText(r)}</p>
      <Advanced>
        <div className="field-row">
          <span className="field-label" data-tip="Which of your sticks moves the game's left stick">Game's left stick</span>
          <Segmented label="Game's left stick" value={r.leftOutput} onChange={(leftOutput) => set({ leftOutput })} options={sources} />
        </div>
        <div className="field-row">
          <span className="field-label" data-tip="Which of your sticks moves the game's right stick (gyro aim is added to it)">Game's right stick</span>
          <Segmented label="Game's right stick" value={r.rightOutput} onChange={(rightOutput) => set({ rightOutput })} options={sources} />
        </div>
      </Advanced>
      <p className="small muted">
        Each stick keeps its own deadzone, curve and calibration. Stick clicks (L3/R3) stay where they are; remap them under
        <b> Mapping</b> if you want them swapped too.
      </p>
    </Panel>
  );
}

const DIRS: Array<{ key: "up" | "down" | "left" | "right"; label: string; dpad: MacroButton }> = [
  { key: "up", label: "Up", dpad: "dpadUp" },
  { key: "down", label: "Down", dpad: "dpadDown" },
  { key: "left", label: "Left", dpad: "dpadLeft" },
  { key: "right", label: "Right", dpad: "dpadRight" },
];

/** Stick-to-button mapping for the selected stick, with a live preview. */
export function StickButtonsPanel({ side, buttons: b, onChange, processed }: {
  side: Side; buttons: StickButtons; onChange: (b: StickButtons) => void;
  /** The stick's processed position from the live preview, if a controller is connected. */
  processed: [number, number] | null;
}) {
  const prev = useRef(0);
  const set = (patch: Partial<StickButtons>) => onChange({ ...b, ...patch });
  const dirs = b.enabled && processed ? stickDirections(b, processed[0], processed[1], prev.current) : 0;
  prev.current = dirs;
  const pressing = directionButtons(b, dirs);

  return (
    <Panel title="Stick to buttons" aside={
      <Switch checked={b.enabled} onChange={(enabled) => set({ enabled })} label={b.enabled ? "On" : "Off"} />
    }>
      <p className="small muted">Pushing the {sideName(side)} in a direction presses a button, e.g. the d-pad for menus or weapon selection.</p>
      <div className="row gap wrap">
        <button className="btn-ghost" disabled={!b.enabled} data-tip="Up/down/left/right on the d-pad"
          onClick={() => set(Object.fromEntries(DIRS.map((d) => [d.key, d.dpad])) as Partial<StickButtons>)}>Use as d-pad</button>
        <button className="btn-ghost" disabled={!b.enabled} onClick={() => set({ up: null, down: null, left: null, right: null })}>Clear</button>
      </div>
      <div className="stick-dirs">
        {DIRS.map((d) => (
          <label key={d.key} className={`stick-dir${b[d.key] && pressing.includes(b[d.key]!) ? " on" : ""}`}>
            <span className="field-label">{d.label}</span>
            <ButtonSelect label={`${sideName(side)} ${d.label}`} value={b[d.key]} noneLabel="Nothing"
              onChange={(v) => set({ [d.key]: v } as Partial<StickButtons>)} />
          </label>
        ))}
      </div>
      <Slider label="Left/right threshold" tip="How far left or right the stick must move to press" value={b.thresholdX}
        min={0.1} max={0.95} onChange={(thresholdX) => set({ thresholdX })} />
      <Slider label="Up/down threshold" tip="How far up or down the stick must move to press" value={b.thresholdY}
        min={0.1} max={0.95} onChange={(thresholdY) => set({ thresholdY })} />
      <Switch checked={b.passthrough} onChange={(passthrough) => set({ passthrough })}
        label="Also move the stick in games" tip="Off: the stick only presses buttons and stays centred for the game" />
      <Advanced>
        <Slider label="Release margin" tip="How far back below the threshold before the button lets go. Stops flicker when the stick rests near the threshold."
          value={b.hysteresis} min={0} max={0.5} onChange={(hysteresis) => set({ hysteresis })} />
        <div className="field-row">
          <span className="field-label" data-tip="8 directions: diagonals press two buttons. 4 directions: one at a time, the one already held wins.">Directions</span>
          <Segmented label="Directions" value={b.directions} onChange={(directions) => set({ directions })}
            options={[{ value: "eight", label: "8 (diagonals)" }, { value: "four", label: "4 (one at a time)" }]} />
        </div>
      </Advanced>
      {b.enabled && (
        <p className="small" role="status">
          {processed
            ? pressing.length ? <>Pressing <b>{pressing.map((x) => BUTTONS[x].name).join(" + ")}</b></> : <span className="muted">Not pressing anything</span>
            : <span className="muted">Connect your controller and move the stick to try it.</span>}
        </p>
      )}
    </Panel>
  );
}
