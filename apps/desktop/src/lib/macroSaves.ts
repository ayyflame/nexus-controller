// Saving the macro being edited: one save at a time, always of the latest
// content, so a new macro is created once and every later save updates it.
// Pages that read the macro library wait for saves still under way, so a
// change made just before leaving the editor is there when they load.

import type { Macro, ValidationIssue } from "../types/engine";

// ---- Saves under way ------------------------------------------------------

const underWay = new Set<Promise<unknown>>();

function track(p: Promise<unknown>) {
  underWay.add(p);
  const done = () => { underWay.delete(p); };
  p.then(done, done);
}

/** Resolves once no macro save is under way (including saves queued while waiting). */
export async function macroSavesSettled(): Promise<void> {
  while (underWay.size > 0) await Promise.allSettled([...underWay]);
}

let failure: string | null = null;

/** A save that failed after its editor had closed, to be shown where the macros are listed next. */
export function reportMacroSaveFailure(message: string) {
  failure = message;
}

/** The failure reported since the last call, if any (read once). */
export function takeMacroSaveFailure(): string | null {
  const m = failure;
  failure = null;
  return m;
}

// ---- The open editor ------------------------------------------------------

export interface OpenEditor {
  /** Saves the latest change now (after any save under way). */
  flush: () => Promise<SaveOutcome>;
  /**
   * The app is leaving the editor: from now on its saves and the actions
   * waiting for them must not navigate (the editor is still mounted until the
   * next page renders); then saves the latest change, as `flush`.
   */
  leave: () => Promise<SaveOutcome>;
  /** Drops any change not saved yet and saves nothing more (its macro is being deleted). */
  discard: () => void;
}

let openEditor: OpenEditor | null = null;

/** The Macro Editor registers itself while it is open; returns its unregister. */
export function setOpenMacroEditor(editor: OpenEditor): () => void {
  openEditor = editor;
  return () => { if (openEditor === editor) openEditor = null; };
}

/** Saves the open editor's latest change now, e.g. before leaving its page. */
export function flushMacroEditor(): Promise<SaveOutcome> {
  return openEditor ? openEditor.flush() : Promise.resolve("unchanged");
}

/** Called as navigation away from the editor starts (any page change, Back/Forward): see `OpenEditor.leave`. */
export function leaveMacroEditor(): Promise<SaveOutcome> {
  return openEditor ? openEditor.leave() : Promise.resolve("unchanged");
}

export function discardMacroEditor() {
  openEditor?.discard();
}

// ---- One editor's saves ---------------------------------------------------

/** What a save request did: nothing to save, not valid yet, saved, or the engine refused or failed. */
export type SaveOutcome = "unchanged" | "invalid" | "saved" | "failed";

export interface SaverHooks {
  /** The editor's content now (read when the save starts, so it is always the latest). */
  latest: () => Macro;
  save: (m: Macro) => Promise<Macro>;
  /** Local checks; content with issues isn't sent. */
  validate: (m: Macro) => ValidationIssue[];
  onStart?: () => void;
  onSaved?: (saved: Macro, wasNew: boolean) => void;
  onFailed?: (error: unknown, sent: Macro) => void;
}

/**
 * Saves one macro's edits: after a pause in editing (`schedule`) or at once
 * (`flush`). Saves never overlap: each waits for the one before it and then
 * sends the content as it is then, with the id the engine gave the macro on
 * its first save. So a new macro is created once, and edits made while a save
 * is under way are saved by the next one.
 */
export class MacroSaver {
  private id: string;
  private createdAtMs: number;
  private lastSaved: string;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly hooks: SaverHooks;
  private readonly delayMs: number;

  constructor(initial: Macro, hooks: SaverHooks, delayMs = 700) {
    this.hooks = hooks;
    this.delayMs = delayMs;
    this.id = initial.id;
    this.createdAtMs = initial.createdAtMs;
    this.lastSaved = initial.id ? JSON.stringify(this.normalize(initial)) : "";
  }

  /** The macro's id: "" until a new macro's first save succeeds. */
  get savedId() { return this.id; }

  /** Whether a save is waiting for the pause in editing. */
  get scheduled() { return this.timer !== null; }

  /** The macro as it is sent: with the id and creation time the engine gave it. */
  normalize(m: Macro): Macro {
    return { ...m, id: this.id, createdAtMs: this.createdAtMs };
  }

  /** Whether `m` is what was last saved. */
  isSaved(m: Macro): boolean {
    return this.lastSaved !== "" && JSON.stringify(this.normalize(m)) === this.lastSaved;
  }

  /** Save after the pause in editing (restarting the wait). */
  schedule() {
    this.cancel();
    if (this.closed) return;
    this.timer = setTimeout(() => { this.timer = null; void this.enqueue(); }, this.delayMs);
  }

  /** Forget the save waiting for the pause, if any. */
  cancel() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Save the latest content now, after any save under way. */
  flush(): Promise<SaveOutcome> {
    this.cancel();
    return this.enqueue();
  }

  /** Save nothing more (the macro is being deleted). */
  close() {
    this.cancel();
    this.closed = true;
  }

  private enqueue(): Promise<SaveOutcome> {
    const run = this.chain.then(() => this.saveLatest());
    this.chain = run;
    track(run);
    return run;
  }

  private async saveLatest(): Promise<SaveOutcome> {
    if (this.closed) return "unchanged";
    const sent = this.normalize(this.hooks.latest());
    if (JSON.stringify(sent) === this.lastSaved) return "unchanged";
    if (this.hooks.validate(sent).length > 0) return "invalid";
    this.hooks.onStart?.();
    try {
      const saved = await this.hooks.save(sent);
      const wasNew = !sent.id;
      this.id = saved.id;
      this.createdAtMs = saved.createdAtMs;
      this.lastSaved = JSON.stringify(this.normalize(sent));
      this.hooks.onSaved?.(saved, wasNew);
      return "saved";
    } catch (e) {
      this.hooks.onFailed?.(e, sent);
      return "failed";
    }
  }
}
