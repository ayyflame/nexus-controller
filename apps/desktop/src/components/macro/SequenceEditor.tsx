import { useCallback, useEffect, useRef, useState } from "react";
import type { History } from "../../hooks/useHistory";
import { LIMITS, formatMs, newStep, sequenceAt, stateWithButtons, totalDuration, uid } from "../../lib/macros";
import type { Macro, MacroButton, MacroStep } from "../../types/engine";
import { ControllerVisual } from "../ControllerVisual";
import { ButtonPad } from "./ButtonPad";
import { RecordPanel } from "./RecordPanel";
import { StepInspector } from "./StepInspector";
import { Timeline } from "./Timeline";

/** Plays the sequence on screen. Never touches the controller or games. */
function usePreview(steps: MacroStep[]) {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const raf = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setElapsed(null);
  }, []);
  const play = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    const total = totalDuration(steps);
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      if (t >= total) { stop(); return; }
      setElapsed(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [steps, stop]);
  useEffect(() => stop, [stop]);
  // Editing the sequence ends a running preview.
  useEffect(() => { stop(); }, [steps, stop]);
  const point = elapsed === null ? null : sequenceAt(steps, elapsed);
  return { playing: elapsed !== null, elapsed: elapsed ?? 0, point, play, stop };
}

type Source = "record" | "manual";

/** In-app clipboard shared by every editor, so actions can be copied between macros. */
let clipboard: MacroStep[] = [];

export function SequenceEditor({ history, initialSource = "record", library = [] }: {
  history: History<MacroStep[]>;
  initialSource?: Source;
  /** Other macros whose sequences can be inserted as reusable blocks. */
  library?: Macro[];
}) {
  const steps = history.value;
  const [source, setSource] = useState<Source>(initialSource);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [clipCount, setClipCount] = useState(clipboard.length);
  const selected_ = selection.length ? selection : selectedId ? [selectedId] : [];

  const select = (id: string, mode: "single" | "toggle" | "range") => {
    if (mode === "single") { setSelectedId(id); setSelection([id]); return; }
    if (mode === "toggle") {
      setSelection((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
      setSelectedId(id);
      return;
    }
    const a = steps.findIndex((s) => s.id === (selectedId ?? id));
    const b = steps.findIndex((s) => s.id === id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelection(steps.slice(lo, hi + 1).map((s) => s.id));
    setSelectedId(id);
  };
  const copy = () => { clipboard = steps.filter((s) => selected_.includes(s.id)).map((s) => ({ ...s })); setClipCount(clipboard.length); };
  const paste = () => {
    if (!clipboard.length) return;
    const fresh = clipboard.map((s) => ({ ...s, id: uid() }));
    const at = selected_.length ? Math.max(...selected_.map((id) => steps.findIndex((s) => s.id === id))) + 1 : steps.length;
    history.set([...steps.slice(0, at), ...fresh, ...steps.slice(at)].slice(0, LIMITS.maxSteps));
    setSelection(fresh.map((s) => s.id)); setSelectedId(fresh[0]!.id);
  };
  const removeSelected = () => {
    history.set(steps.filter((s) => !selected_.includes(s.id)));
    setSelection([]); setSelectedId(null);
  };
  const duplicateSelected = () => { copy(); paste(); };
  const insertFrom = (m: Macro) => {
    const fresh = m.steps.map((s) => ({ ...s, id: uid() }));
    history.set([...steps, ...fresh].slice(0, LIMITS.maxSteps));
    setSelection(fresh.map((s) => s.id));
  };
  const preview = usePreview(steps);
  const selectedIndex = steps.findIndex((s) => s.id === selectedId);
  const selected = selectedIndex >= 0 ? steps[selectedIndex]! : null;

  const update = (fn: (s: MacroStep[]) => MacroStep[]) => history.set(fn(steps));

  const add = (b: MacroButton) => {
    if (steps.length >= LIMITS.maxSteps) return;
    const step = newStep([b]);
    update((s) => [...s, step]);
    setSelectedId(step.id);
  };
  const move = (from: number, to: number) => update((s) => {
    const next = [...s];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    return next;
  });
  const remove = (index: number) => {
    const next = steps.filter((_, i) => i !== index);
    history.set(next);
    setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? null);
  };
  const duplicate = (index: number) => {
    const copy = { ...steps[index]!, id: uid() };
    update((s) => [...s.slice(0, index + 1), copy, ...s.slice(index + 1)]);
    setSelectedId(copy.id);
  };

  // Keyboard: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z / Delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "c" && selected_.length) { e.preventDefault(); copy(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); paste(); }
      else if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSelection(steps.map((s) => s.id)); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); history.redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected_.length > 1) { e.preventDefault(); removeSelected(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectedIndex >= 0) { e.preventDefault(); remove(selectedIndex); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pressedNow = preview.point?.pressed && preview.point.step !== null
    ? steps[preview.point.step]!.buttons : [];
  const total = totalDuration(steps);

  return (
    <div className="seq-editor">
      <div className="source-tabs" role="tablist" aria-label="How to create the sequence">
        <button role="tab" aria-selected={source === "record"} className={source === "record" ? "selected" : ""}
          onClick={() => setSource("record")}>
          <span className="tab-icon rec-dot" aria-hidden="true" />
          <span><strong>Record</strong><small>Press buttons on your controller</small></span>
        </button>
        <button role="tab" aria-selected={source === "manual"} className={source === "manual" ? "selected" : ""}
          onClick={() => setSource("manual")}>
          <span className="tab-icon" aria-hidden="true">✚</span>
          <span><strong>Build Manually</strong><small>Click buttons to add actions</small></span>
        </button>
      </div>

      {source === "record" ? (
        <RecordPanel hasSteps={steps.length > 0} onRecorded={(rec, how) => {
          history.set(how === "replace" ? rec : [...steps, ...rec].slice(0, LIMITS.maxSteps));
          setSelectedId(null);
        }} />
      ) : (
        <div className="manual-panel">
          <p className="muted small">Click a button to add it to the end of your sequence. Click an action in the timeline to change its timing or press several buttons together.</p>
          <ButtonPad selected={[]} onPick={add} label="Add an action" />
        </div>
      )}

      <div className="seq-toolbar">
        <div className="row gap-sm">
          {preview.playing ? (
            <button className="btn-primary" onClick={preview.stop} data-tip="Stop the preview">■ Stop</button>
          ) : (
            <button className="btn-primary" onClick={preview.play} disabled={steps.length === 0}
              data-tip="Play the sequence on screen (does not press anything in games)">▶ Play preview</button>
          )}
          <button className="btn-icon" onClick={history.undo} disabled={!history.canUndo} data-tip="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
          <button className="btn-icon" onClick={history.redo} disabled={!history.canRedo} data-tip="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
          <span className="divider" />
          <button className="btn-ghost" onClick={copy} disabled={!selected_.length} data-tip="Copy selected actions (Ctrl+C)">Copy</button>
          <button className="btn-ghost" onClick={paste} disabled={!clipCount} data-tip="Paste after the selection (Ctrl+V)">Paste{clipCount ? ` (${clipCount})` : ""}</button>
          {selected_.length > 1 && <>
            <button className="btn-ghost" onClick={duplicateSelected} data-tip="Duplicate the selected group">Duplicate {selected_.length}</button>
            <button className="btn-ghost danger" onClick={removeSelected} data-tip="Delete the selected group">Delete {selected_.length}</button>
          </>}
          {library.length > 0 && (
            <select className="select insert-select" value="" aria-label="Insert another macro's sequence"
              onChange={(e) => { const m = library.find((x) => x.id === e.target.value); if (m) insertFrom(m); }}>
              <option value="">Insert from macro…</option>
              {library.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.steps.length})</option>)}
            </select>
          )}
        </div>
        <span className="muted small">
          {steps.length} action{steps.length === 1 ? "" : "s"} · {formatMs(total)}
          {preview.playing && <> · <span className="gold mono">{formatMs(preview.elapsed)}</span></>}
        </span>
      </div>
      {preview.playing && (
        <div className="preview-progress"><div style={{ width: `${(preview.elapsed / Math.max(total, 1)) * 100}%` }} /></div>
      )}

      <Timeline steps={steps} selectedId={selectedId} selection={selection} onSelect={select} onMove={move}
        playing={preview.point ? { step: preview.point.step, pressed: preview.point.pressed } : null} />

      {preview.playing && (
        <div className="preview-visual">
          <ControllerVisual state={stateWithButtons(pressedNow)} live />
          <span className="badge dev">Preview only</span>
        </div>
      )}

      {selected && !preview.playing && (
        <StepInspector
          step={selected} index={selectedIndex} count={steps.length}
          onChange={(s) => update((all) => all.map((x) => (x.id === s.id ? s : x)))}
          onMove={(d) => { const to = selectedIndex + d; if (to >= 0 && to < steps.length) move(selectedIndex, to); }}
          onDuplicate={() => duplicate(selectedIndex)}
          onDelete={() => remove(selectedIndex)}
        />
      )}
    </div>
  );
}
