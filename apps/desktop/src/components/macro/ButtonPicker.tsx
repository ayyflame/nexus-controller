import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BUTTONS, stateWithButtons } from "../../lib/macros";
import { webglAvailable } from "../../lib/controllerViewMode";
import type { MacroButton } from "../../types/engine";
import { ControllerVisual } from "../ControllerVisual";
import { ButtonChip } from "./ButtonChip";
import { ALL_BUTTONS } from "../controller/advanced";

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
}

class PickerStore {
  private entries = new Map<string, { req: PickRequest; seq: number }>();
  private seq = 0;
  private listeners = new Set<() => void>();
  private current: PickRequest | null = null;
  set(key: string, req: PickRequest | null) {
    const had = this.entries.get(key);
    if (req) this.entries.set(key, { req, seq: had ? had.seq : ++this.seq });
    else this.entries.delete(key);
    let best: { req: PickRequest; seq: number } | null = null;
    for (const e of this.entries.values()) {
      if (!best || e.req.priority > best.req.priority || (e.req.priority === best.req.priority && e.seq > best.seq)) best = e;
    }
    this.current = best?.req ?? null;
    this.listeners.forEach((l) => l());
  }
  get = () => this.current;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
}

const PickerContext = createContext<PickerStore | null>(null);

/** One controller per editor: wrap the editor in this. */
export function PickerProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new PickerStore());
  return <PickerContext.Provider value={store}>{children}</PickerContext.Provider>;
}

/** Ask for the editor's controller while `req` is not null (kept up to date on every render). */
export function usePick(key: string, req: PickRequest | null) {
  const store = useContext(PickerContext);
  useLayoutEffect(() => { store?.set(key, req); });
  useEffect(() => () => store?.set(key, null), [store, key]);
}

/**
 * The editor's clickable 3D controller. Without WebGL, a plain list of
 * buttons does the same job.
 */
export function ButtonPicker() {
  const store = useContext(PickerContext);
  const req = useSyncExternalStore(store?.subscribe ?? (() => () => undefined), store?.get ?? (() => null));
  const [notice, setNotice] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const title = req?.title ?? "Choose Build Manually to add actions by clicking the controller";
  // A new job (e.g. Choose trigger): bring the controller into view if it isn't.
  const lastTitle = useRef(title);
  useEffect(() => {
    if (title === lastTitle.current) return;
    lastTitle.current = title;
    setNotice(null);
    if (req && req.priority === 2) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [title, req]);

  const pick = req?.onPick ? (b: MacroButton) => {
    const reason = req.blocked?.[b];
    if (reason) { setNotice(`${BUTTONS[b].name}: ${reason}`); return; }
    setNotice(null);
    req.onPick!(b);
  } : undefined;

  return (
    <div className={`card ms-picker${req && req.priority === 2 ? " focused" : ""}`} ref={box} aria-label="Controller">
      <div className="ms-picker-head">
        <strong role="status" aria-live="polite">{title}</strong>
        {req?.onDone && <button type="button" className="btn-ghost small" onClick={req.onDone}>Done</button>}
      </div>
      {webglAvailable() ? (
        <ControllerVisual state={stateWithButtons(req?.selected ?? [])} live onSelect={pick} />
      ) : (
        <div className="pick-list" role="group" aria-label="Buttons">
          {ALL_BUTTONS.map((b) => {
            const reason = req?.blocked?.[b];
            const on = req?.selected.includes(b) ?? false;
            return (
              <button key={b} type="button" className={`pick-item${on ? " selected" : ""}`} disabled={!pick || !!reason}
                aria-pressed={on} title={reason ?? BUTTONS[b].name} onClick={() => pick?.(b)}>
                <ButtonChip button={b} size="sm" active={on} /> {BUTTONS[b].name}
              </button>
            );
          })}
        </div>
      )}
      {notice && <p className="small warn-text" role="alert">{notice}</p>}
    </div>
  );
}
