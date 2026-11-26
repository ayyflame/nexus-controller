import { useEffect, useState } from "react";
import { ButtonChip } from "../components/macro/ButtonChip";
import { ButtonSelect, LayersPanel } from "../components/controller/advanced";
import { CombosPanel } from "../components/controller/CombosPanel";
import { MappingView } from "../components/controller/MappingView";
import { ProcessingPage } from "../components/controller/ProcessingPage";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { useShownModel } from "../hooks/useShownModel";
import { Icon } from "../components/Icons";
import { connectionLabel, modelLabel, outputLabel } from "../lib/format";
import { engineApi } from "../lib/engine";
import { macroSavesSettled } from "../lib/macroSaves";
import { BUTTONS, pressedButtons } from "../lib/macros";
import {
  EMPTY_HISTORY, recordEdit, redoRemap, setRemapAlso, setRemapTarget, undoRemap, type RemapHistory,
} from "../lib/mappingView";
import type { ControllerState, Macro, MacroButton, ProcessingConfig, RemapRule, VirtualOutputKind } from "../types/engine";

/** `initialControl`: a button to select when the page opens (from Macro Studio's "Show in Mapping"). */
export function MappingPage({ initialControl }: { initialControl?: string }) {
  const { profile } = useEngine();
  const control = initialControl && Object.hasOwn(BUTTONS, initialControl) ? (initialControl as MacroButton) : null;
  return (
    <ProcessingPage title="Mapping" className="mapping-page"
      description="Click any control on the controller, or its card, to change what it does.">
      {(config, onChange) => <>
        <ButtonsTab key={profile?.id ?? 0} config={config} onChange={onChange} output={profile?.virtualOutput ?? "xbox360"} initialControl={control} />
        <LayersPanel config={config} onChange={onChange} />
        <CombosPanel config={config} onChange={onChange} />
      </>}
    </ProcessingPage>
  );
}

const openOutput = () => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page: "virtual-controller" } }));

// ---- Buttons -------------------------------------------------------------

const BUTTON_ORDER: MacroButton[] = [
  "south", "east", "west", "north", "leftShoulder", "rightShoulder", "leftTrigger", "rightTrigger",
  "leftStick", "rightStick", "dpadUp", "dpadDown", "dpadLeft", "dpadRight", "select", "start", "touchpad", "home", "mute",
];

function ButtonsTab({ config, onChange, output, initialControl }: {
  config: ProcessingConfig; onChange: (c: ProcessingConfig) => void; output: VirtualOutputKind; initialControl: MacroButton | null;
}) {
  const device = usePrimaryDevice();
  const { connection, profile } = useEngine();
  const [view, setView] = useState<"picture" | "list">(() => {
    if (initialControl) return "picture"; // the selected control is shown in the picture
    try { return localStorage.getItem(MAPPING_VIEW_KEY) === "list" ? "list" : "picture"; } catch { return "picture"; }
  });
  const [history, setHistory] = useState<RemapHistory>(EMPTY_HISTORY);
  const [macros, setMacros] = useState<Macro[]>([]);
  useEffect(() => {
    // After any macro save under way (e.g. a trigger changed just before Show in Mapping).
    if (connection.kind === "ready") macroSavesSettled().then(() => engineApi.listMacros()).then(setMacros).catch(() => setMacros([]));
  }, [connection.kind]);

  /** Every remap change goes through here so it can be undone. */
  const edit = (next: ProcessingConfig) => {
    setHistory((h) => recordEdit(h, config.remap, next.remap));
    onChange(next);
  };
  const step = (r: { history: RemapHistory; remap: RemapRule[] } | null) => {
    if (!r) return;
    setHistory(r.history);
    onChange({ ...config, remap: r.remap });
  };
  const chooseView = (v: "picture" | "list") => {
    setView(v);
    try { localStorage.setItem(MAPPING_VIEW_KEY, v); } catch { /* per-viewer convenience only */ }
  };
  const input = device?.input ?? null;
  const shownModel = useShownModel(input);
  // The picture's own view buttons (3D presets, zoom, 2D/3D) sit in this toolbar, clear of the connectors.
  const [viewTools, setViewTools] = useState<HTMLElement | null>(null);

  return (
    <section className="map-workspace" aria-label="Button mapping">
      <p className="muted small map-info">
        Saved to the profile <b>{profile?.name ?? "—"}</b>. Games receive it once the{" "}
        <button type="button" className="map-link" onClick={openOutput}>virtual controller</button> is on
        {output === "disabled" ? " (it is off in this profile)" : ""}. Macros always start from the physical button.
      </p>
      <div className="map-toolbar">
        <div className="map-toolbar-info">
          <span className="map-pill" title={device ? "The connected controller" : "No controller connected: showing the last one used"}>
            <Icon name="controller" size={15} />
            {device ? `${modelLabel[device.device.model]} · ${connectionLabel[device.device.connection]}` : `${shownModel === "dualShock4" ? "DualShock 4" : "DualSense"} (not connected)`}
          </span>
          <button type="button" className="map-pill map-pill-link" onClick={openOutput} title="Change on the Virtual Controller page">
            Games see: {output === "disabled" ? "nothing (output off)" : outputLabel[output]}
          </button>
        </div>
        <div className="map-toolbar-actions">
          {view === "picture" && <div className="map-view-tools" ref={setViewTools} />}
          <button type="button" className="btn-ghost small" disabled={history.past.length === 0}
            onClick={() => step(undoRemap(history, config.remap))} title="Undo the last mapping change">↶ Undo</button>
          <button type="button" className="btn-ghost small" disabled={history.future.length === 0}
            onClick={() => step(redoRemap(history, config.remap))} title="Redo">↷ Redo</button>
          <div className="segmented small" role="group" aria-label="View">
            <button type="button" className={view === "picture" ? "selected" : ""} aria-pressed={view === "picture"} onClick={() => chooseView("picture")}>Picture</button>
            <button type="button" className={view === "list" ? "selected" : ""} aria-pressed={view === "list"} onClick={() => chooseView("list")}>List</button>
          </div>
          <button type="button" className="btn-ghost small" disabled={config.remap.length === 0}
            title="Every button back to normal (layers and combos are kept)"
            onClick={() => edit({ ...config, remap: [] })}>Reset all</button>
        </div>
      </div>
      {view === "picture"
        ? <MappingView config={config} onEdit={edit} input={input} output={output} macros={macros} onMacrosChanged={setMacros} onOpenOutput={openOutput} toolbarHost={viewTools} initialSelected={initialControl} />
        : <ButtonList config={config} onEdit={edit} input={input} />}
      {device?.device.model === "dualSenseEdge" && (
        <p className="muted small map-info">
          DualSense Edge back buttons and Fn buttons: NEXUS doesn't read them yet, so they can't be mapped here. Paddles you set up on the
          controller itself (to send another button) work as that button.
        </p>
      )}
    </section>
  );
}

const MAPPING_VIEW_KEY = "nexus.mappingView";

/** The original list: one row per button with what it sends and an optional second button. */
function ButtonList({ config, onEdit, input }: { config: ProcessingConfig; onEdit: (c: ProcessingConfig) => void; input: ControllerState | null }) {
  const pressed = new Set(pressedButtons(input));
  return (
    <div className="remap-list">
      {BUTTON_ORDER.map((b) => {
        const rule = config.remap.find((r) => r.from === b);
        const value = !rule || rule.to === b ? "same" : rule.to === null ? "off" : rule.to;
        return (
          <div key={b} className={`remap-row${pressed.has(b) ? " lit" : ""}${rule ? " changed" : ""}`}>
            <ButtonChip button={b} size="lg" active={pressed.has(b)} />
            <span className="remap-name">{BUTTONS[b].name}</span>
            <span className="muted" aria-hidden="true">→</span>
            <select className="select" value={value} aria-label={`${BUTTONS[b].name} sends`}
              onChange={(e) => onEdit(setRemapTarget(config, b, e.target.value as MacroButton | "same" | "off"))}>
              <option value="same">{BUTTONS[b].name} (normal)</option>
              <option value="off">Disabled</option>
              {BUTTON_ORDER.filter((x) => x !== b).map((x) => <option key={x} value={x}>{BUTTONS[x].name}</option>)}
            </select>
            <ButtonSelect label={`${BUTTONS[b].name} also presses`} value={rule?.also?.[0] ?? null} noneLabel="+ also press…"
              onChange={(x) => onEdit(setRemapAlso(config, b, x))} />
          </div>
        );
      })}
    </div>
  );
}
