// What a physical button currently does, for the controller picture: read
// from the active profile's existing settings and the macro library. Pure
// (no engine calls), so the rules are unit-tested. It mirrors the engine's
// rules in crates/input-processing (remap, layers, gyro button) and the macro
// engine (macros start from the physical button).

import type { Macro, MacroButton, PlaybackMode, ProcessingConfig } from "../types/engine";

export interface LayerUse {
  layer: string;
  /** What the button sends while this layer is active (null = nothing). */
  sends: MacroButton | null;
  also: MacroButton[];
}

export interface ButtonMapping {
  button: MacroButton;
  /** normal: sends itself. remapped: sends something else. disabled: sends nothing. */
  kind: "normal" | "remapped" | "disabled";
  /** What the base mapping sends (null = nothing). */
  sends: MacroButton | null;
  also: MacroButton[];
  /** Enabled macros started by this button. */
  macros: Array<{ id: string; name: string; mode: PlaybackMode; hidesTrigger: boolean }>;
  /** Layers in which this button sends something different. */
  layers: LayerUse[];
  /** Layers this button switches on (the button itself is not sent to games). */
  activatesLayers: string[];
  /** This button switches gyro aiming and is hidden from games. */
  gyroButtonHidden: boolean;
}

/** Small marks drawn on the controller picture. */
export interface ButtonMark {
  remapped: boolean;
  disabled: boolean;
  macro: boolean;
  /** Changes in a layer, or switches a layer or gyro. */
  special: boolean;
}

export function buttonMapping(button: MacroButton, config: ProcessingConfig, macros: Macro[]): ButtonMapping {
  const rule = config.remap.find((r) => r.from === button);
  const also = rule?.also ?? [];
  const sends = rule ? rule.to : button;
  const kind: ButtonMapping["kind"] =
    sends === null && also.length === 0 ? "disabled" : sends === button && also.length === 0 ? "normal" : "remapped";
  const layers: LayerUse[] = [];
  for (const l of config.layers) {
    const r = l.remap.find((x) => x.from === button);
    if (r) layers.push({ layer: l.name, sends: r.to, also: r.also ?? [] });
  }
  const g = config.gyro;
  return {
    button,
    kind,
    sends,
    also,
    macros: macros
      .filter((m) => m.enabled && m.trigger === button && m.steps.length > 0)
      .map((m) => ({ id: m.id, name: m.name, mode: m.mode, hidesTrigger: m.blockTrigger })),
    layers,
    activatesLayers: config.layers.filter((l) => l.activator === button).map((l) => l.name),
    gyroButtonHidden: g.enabled && g.activation !== "always" && g.suppressButton && g.button === button,
  };
}

export function buttonMarks(
  buttons: MacroButton[], config: ProcessingConfig, macros: Macro[],
): Partial<Record<MacroButton, ButtonMark>> {
  const out: Partial<Record<MacroButton, ButtonMark>> = {};
  for (const b of buttons) {
    const m = buttonMapping(b, config, macros);
    const mark: ButtonMark = {
      remapped: m.kind === "remapped",
      disabled: m.kind === "disabled",
      macro: m.macros.length > 0,
      special: m.layers.length > 0 || m.activatesLayers.length > 0 || m.gyroButtonHidden,
    };
    if (mark.remapped || mark.disabled || mark.macro || mark.special) out[b] = mark;
  }
  return out;
}

const MODE: Record<PlaybackMode, string> = { once: "plays once", repeatWhileHeld: "repeats while held", toggle: "toggles on/off" };

/** Plain-language lines for the selected button. `name` gives display names. */
export function describeMapping(m: ButtonMapping, name: (b: MacroButton) => string): string[] {
  const list = (bs: MacroButton[]) => bs.map(name).join(" + ");
  const lines: string[] = [];
  if (m.kind === "normal") lines.push(`Sends ${name(m.button)} (normal).`);
  else if (m.kind === "disabled") lines.push("Disabled: sends nothing to the game.");
  else if (m.sends === null) lines.push(`Sends ${list(m.also)} instead.`);
  else lines.push(`Remapped: sends ${list([m.sends, ...m.also])}.`);
  for (const l of m.activatesLayers) lines.push(`Switches the layer "${l}" (not sent to the game itself).`);
  if (m.gyroButtonHidden) lines.push("Switches gyro aiming (not sent to the game itself).");
  for (const l of m.layers) {
    const what = l.sends === null && l.also.length === 0 ? "nothing" : list([...(l.sends ? [l.sends] : []), ...l.also]);
    lines.push(`In the layer "${l.layer}": sends ${what}.`);
  }
  for (const x of m.macros) {
    lines.push(`Starts the macro "${x.name}" (${MODE[x.mode]}${x.hidesTrigger ? "; the button itself is hidden from the game" : ""}).`);
  }
  return lines;
}
