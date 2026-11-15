import { useCallback, useEffect, useRef, useState } from "react";
import type { History } from "../../hooks/useHistory";
import { LIMITS, formatMs, newStep, sequenceAt, stateWithButtons, totalDuration, uid } from "../../lib/macros";
import type { MacroButton, MacroStep } from "../../types/engine";
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

export function SequenceEditor({ history, initialSource = "record" }: {
  history: History<MacroStep[]>;
  initialSource?: Source;
}) {
  const steps = history.value;
  const [source, setSource] = useState<Source>(initialSource);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); history.redo(); }
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
        </div>
        <span className="muted small">
          {steps.length} action{steps.length === 1 ? "" : "s"} · {formatMs(total)}
          {preview.playing && <> · <span className="gold mono">{formatMs(preview.elapsed)}</span></>}
        </span>
      </div>
      {preview.playing && (
        <div className="preview-progress"><div style={{ width: `${(preview.elapsed / Math.max(total, 1)) * 100}%` }} /></div>
      )}

      <Timeline steps={steps} selectedId={selectedId} onSelect={setSelectedId} onMove={move}
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
