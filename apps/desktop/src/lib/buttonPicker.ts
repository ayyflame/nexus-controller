// The Macro Editor's controller: which request a click on it serves, and how
// its button list works from the keyboard. No React here, so it is tested
// directly (buttonPicker.test.ts).

import type { MacroButton } from "../types/engine";

/**
 * What a click on the editor's controller does right now. Parts of the
 * editor ask for the controller (adding actions, changing one action's
 * buttons, choosing the trigger, playing the preview); the most specific
 * request wins, and the controller says which one is active.
 */
export interface PickRequest {
  /** Higher wins: 1 add actions, 2 a chosen action or the trigger, 3 the preview. */
  priority: 1 | 2 | 3;
  /** What a click does, shown above the controller. */
  title: string;
  /** Buttons shown as chosen (lit). */
  selected: MacroButton[];
  /** Buttons that can't be chosen now, with the reason. */
  blocked?: Partial<Record<MacroButton, string>>;
  /** Absent: nothing to click (the preview). */
  onPick?: (b: MacroButton) => void;
  /** Shows a Done button that ends this request. */
  onDone?: () => void;
  /**
   * What a click means, for assistive technology: "toggle" adds or removes a
   * button (an action's buttons), "choose" picks one (the trigger). Absent: a
   * click is an action (adding a step) or there is nothing to pick (preview).
   */
  kind?: "toggle" | "choose";
}

/**
 * A list button's state for screen readers: pressed / not pressed only when a
 * click toggles it; "current" for the one chosen; nothing otherwise (so adding
 * actions isn't announced as a row of toggle buttons).
 */
export function itemState(req: PickRequest | null, b: MacroButton): { pressed?: boolean; current?: boolean } {
  const on = req?.selected.includes(b) ?? false;
  if (req?.kind === "toggle") return { pressed: on };
  if (req?.kind === "choose") return on ? { current: true } : {};
  return {};
}

/** The request being served, and which part of the editor asked for it. */
export interface ActivePick { key: string; req: PickRequest }

/** The requests of one editor; the highest priority wins, the latest among equals. */
export class PickerStore {
  private entries = new Map<string, { req: PickRequest; seq: number }>();
  private seq = 0;
  private listeners = new Set<() => void>();
  private current: ActivePick | null = null;

  set(key: string, req: PickRequest | null) {
    const had = this.entries.get(key);
    if (req) this.entries.set(key, { req, seq: had ? had.seq : ++this.seq });
    else this.entries.delete(key);
    let best: { key: string; req: PickRequest; seq: number } | null = null;
    for (const [k, e] of this.entries) {
      if (!best || e.req.priority > best.req.priority || (e.req.priority === best.req.priority && e.seq > best.seq)) best = { key: k, ...e };
    }
    this.current = best ? { key: best.key, req: best.req } : null;
    this.listeners.forEach((l) => l());
  }

  get = (): ActivePick | null => this.current;

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
}

// ---- Keyboard ---------------------------------------------------------------

/** The editor's controller (ButtonPicker's outer element). */
export const PICKER_SELECTOR = ".ms-picker";

/**
 * Whether a key press deletes the selected actions (the editor's Delete /
 * Backspace shortcut). Not while typing, and not from the controller: there
 * focus is on a button being chosen, often for the very action that is
 * selected, so the keys must not delete it.
 */
export function deletesActions(key: string, target: { closest: (selector: string) => unknown } | null): boolean {
  if (key !== "Delete" && key !== "Backspace") return false;
  if (!target) return true;
  return !target.closest("input, textarea") && !target.closest(PICKER_SELECTOR);
}

/**
 * The button list is one stop in the Tab order (a toolbar): the arrow keys
 * move between its buttons, wrapping round, and Home / End go to the first and
 * last. Returns the index to move to, or null for keys the list leaves alone
 * (Enter and Space press the focused button as usual).
 */
export function moveFocus(key: string, index: number, count: number,
  mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}): number | null {
  if (count <= 0) return null;
  // Alt/Ctrl/Meta + arrow belong to the system and the app (e.g. Alt+← is Back): leave them alone.
  if (mods.altKey || mods.ctrlKey || mods.metaKey) return null;
  switch (key) {
    case "ArrowRight": case "ArrowDown": return (index + 1) % count;
    case "ArrowLeft": case "ArrowUp": return (index - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** Where focus goes in the list: the first chosen button, else the first that can be chosen, else the first. */
export function focusStart(buttons: MacroButton[], req: PickRequest | null): MacroButton | undefined {
  return buttons.find((b) => req?.selected.includes(b))
    ?? buttons.find((b) => !req?.blocked?.[b])
    ?? buttons[0];
}

/**
 * Whether Escape ends the current choosing (an action's buttons, the trigger):
 * when focus is in the controller or on the button that started it, never
 * inside a dialog (Escape closes the dialog there).
 */
export function escapeEndsChoosing(at: { inPicker: boolean; onOpener: boolean; inDialog: boolean; canEnd: boolean }): boolean {
  return at.canEnd && !at.inDialog && (at.inPicker || at.onOpener);
}

/** A list button's accessible name: unavailable buttons say why, so keyboard and screen reader users learn it too. */
export function pickLabel(name: string, reason: string | undefined): string {
  return reason ? `${name} (unavailable: ${reason})` : name;
}

/**
 * What focus should do when the controller's request changes:
 * - "enter": a chosen action's buttons or the trigger is now being chosen
 *   (priority 2), started from the keyboard: move focus into the list.
 * - "return": that choosing ended (Done, Escape, a trigger picked): put
 *   focus back where it started, if it was in the controller.
 * - null: leave focus alone (the mouse, adding actions, the preview).
 */
export function focusChange(before: ActivePick | null, after: ActivePick | null, fromKeyboard: boolean): "enter" | "return" | null {
  const choosing = (p: ActivePick | null) => p !== null && p.req.priority === 2;
  if (choosing(after) && after!.key !== before?.key) return fromKeyboard ? "enter" : null;
  if (choosing(before) && after?.key !== before!.key) return "return";
  return null;
}
