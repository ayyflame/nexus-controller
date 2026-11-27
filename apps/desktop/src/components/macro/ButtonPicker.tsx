import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { BUTTONS, stateWithButtons } from "../../lib/macros";
import { escapeEndsChoosing, focusChange, focusStart, itemState, moveFocus, pickLabel, PickerStore, type ActivePick, type PickRequest } from "../../lib/buttonPicker";
import { webglAvailable } from "../../lib/controllerViewMode";
import type { MacroButton } from "../../types/engine";
import { ControllerVisual } from "../ControllerVisual";
import { ButtonChip } from "./ButtonChip";
import { ALL_BUTTONS } from "../controller/advanced";

export type { PickRequest } from "../../lib/buttonPicker";

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

// Whether the latest input was the keyboard, so starting to choose with Enter
// or Space moves focus into the list, while a mouse click leaves focus alone.
let lastInputKeyboard = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => { lastInputKeyboard = true; }, true);
  window.addEventListener("pointerdown", () => { lastInputKeyboard = false; }, true);
}

const LIST_KEY = "nexus.pickerList.v1";
const loadListShown = () => { try { return localStorage.getItem(LIST_KEY) === "1"; } catch { return false; } };

/**
 * The editor's clickable 3D controller, with the same buttons as a list that
 * works from the keyboard: one Tab stop, the arrow keys (and Home / End) move
 * between buttons, Enter or Space chooses, Escape ends choosing. With WebGL
 * the list is behind a "Button list" switch (opened by itself when choosing
 * starts from the keyboard); without WebGL it is the only picture.
 */
export function ButtonPicker() {
  const store = useContext(PickerContext);
  const active = useSyncExternalStore(store?.subscribe ?? (() => () => undefined), store?.get ?? (() => null));
  const req = active?.req ?? null;
  // `n` re-creates the alert each time, so choosing the same unavailable button again is announced again.
  const [notice, setNotice] = useState<{ text: string; n: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<MacroButton, HTMLButtonElement>());
  const listId = useId();
  // A 3D view that fails while the app runs counts as no WebGL: the list is then always shown.
  const [failed3d, setFailed3d] = useState(false);
  const gl = webglAvailable() && !failed3d;
  const [listShown, setListShownState] = useState(() => !gl || loadListShown());
  const showList = listShown || !gl;
  const setListShown = (on: boolean) => {
    setListShownState(on);
    try { localStorage.setItem(LIST_KEY, on ? "1" : "0"); } catch { /* display preference only */ }
  };
  // The list's one Tab stop (roving focus), and a focus move waiting for the list to render.
  const [current, setCurrent] = useState<MacroButton | undefined>(undefined);
  const pendingFocus = useRef<MacroButton | null>(null);
  // Where focus was when choosing started, to return it when choosing ends.
  const opener = useRef<HTMLElement | null>(null);

  const title = req?.title ?? "Choose Build Manually to add actions by clicking the controller";
  // A new job (e.g. Choose trigger): bring the controller into view if it isn't.
  const lastTitle = useRef(title);
  useEffect(() => {
    if (title === lastTitle.current) return;
    lastTitle.current = title;
    setNotice(null);
    if (req && req.priority === 2) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [title, req]);

  // Focus when choosing starts and ends (see focusChange).
  const before = useRef<ActivePick | null>(null);
  useEffect(() => {
    const prev = before.current;
    before.current = active;
    const inBox = (el: Element | null) => !!el && !!box.current?.contains(el);
    if (active && active.req.priority === 2 && active.key !== prev?.key) {
      const el = document.activeElement;
      opener.current = el instanceof HTMLElement && el !== document.body && !inBox(el) ? el : null;
    }
    const change = focusChange(prev, active, lastInputKeyboard);
    if (change === "enter") {
      const start = focusStart(ALL_BUTTONS, active!.req);
      if (!start) return;
      setCurrent(start);
      pendingFocus.current = start;
      // Opened for this choice only; the Button list switch keeps its saved setting.
      if (!showList) setListShownState(true);
      else items.current.get(start)?.focus();
    } else if (change === "return") {
      const back = opener.current;
      opener.current = null;
      const el = document.activeElement;
      // Only take focus back from the controller (or from nowhere, when Done disappeared), never from elsewhere.
      if (back?.isConnected && (!el || el === document.body || inBox(el))) back.focus();
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // The list has rendered (it was just opened): do the waiting focus move.
  useEffect(() => {
    const b = pendingFocus.current;
    if (!b || !showList) return;
    pendingFocus.current = null;
    items.current.get(b)?.focus();
  }, [showList]);

  // Escape ends choosing (see escapeEndsChoosing): from the controller or from the button that started it.
  const reqRef = useRef(req);
  reqRef.current = req;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      const r = reqRef.current;
      if (!escapeEndsChoosing({
        canEnd: !!r?.onDone,
        inDialog: !!t?.closest('[role="dialog"], [role="alertdialog"]'),
        inPicker: !!t && !!box.current?.contains(t),
        onOpener: !!t && t === opener.current,
      })) return;
      e.preventDefault();
      r!.onDone!();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = req?.onPick ? (b: MacroButton) => {
    const reason = req.blocked?.[b];
    if (reason) { setNotice((p) => ({ text: `${BUTTONS[b].name}: ${reason}`, n: (p?.n ?? 0) + 1 })); return; }
    setNotice(null);
    req.onPick!(b);
  } : undefined;

  const tabStop = current && ALL_BUTTONS.includes(current) ? current : focusStart(ALL_BUTTONS, req);
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = ALL_BUTTONS.indexOf((e.target as HTMLElement).dataset.button as MacroButton);
    if (at < 0) return;
    const to = moveFocus(e.key, at, ALL_BUTTONS.length, e);
    if (to === null) return;
    e.preventDefault();
    const b = ALL_BUTTONS[to]!;
    setCurrent(b);
    items.current.get(b)?.focus();
  };

  return (
    <div className={`card ms-picker${req && req.priority === 2 ? " focused" : ""}`} ref={box} aria-label="Controller">
      <div className="ms-picker-head">
        <strong role="status" aria-live="polite">{title}</strong>
        <span className="ms-picker-actions">
          {gl && (
            <button type="button" className="btn-ghost small" aria-expanded={listShown} aria-controls={listId}
              onClick={() => setListShown(!listShown)}>Button list</button>
          )}
          {req?.onDone && <button type="button" className="btn-ghost small" onClick={req.onDone}>Done</button>}
        </span>
      </div>
      {gl && <ControllerVisual state={stateWithButtons(req?.selected ?? [])} live onSelect={pick} onUnavailable={() => setFailed3d(true)} />}
      {showList && (
        <div className="pick-list" id={listId} role="toolbar" aria-label={`Buttons: ${title}`} onKeyDown={onListKey}>
          {ALL_BUTTONS.map((b) => {
            const reason = req?.blocked?.[b];
            const on = req?.selected.includes(b) ?? false;
            const st = itemState(req, b);
            return (
              <button key={b} type="button" data-button={b} className={`pick-item${on ? " selected" : ""}`}
                ref={(el) => { if (el) items.current.set(b, el); else items.current.delete(b); }}
                tabIndex={b === tabStop ? 0 : -1} aria-disabled={!pick || !!reason}
                aria-pressed={st.pressed} aria-current={st.current ? "true" : undefined}
                aria-label={pickLabel(BUTTONS[b].name, reason)} title={reason ?? BUTTONS[b].name}
                onFocus={() => setCurrent(b)} onClick={() => pick?.(b)}>
                <ButtonChip button={b} size="sm" active={on} /> {BUTTONS[b].name}
              </button>
            );
          })}
        </div>
      )}
      {notice && <p key={notice.n} className="small warn-text" role="alert">{notice.text}</p>}
    </div>
  );
}
