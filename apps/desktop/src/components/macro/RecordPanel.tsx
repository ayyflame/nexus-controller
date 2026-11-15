import { useEffect, useRef, useState } from "react";
import { useEngine } from "../../hooks/useEngine";
import { engineApi, errorMessage } from "../../lib/engine";
import { formatMs, uid } from "../../lib/macros";
import type { MacroStep } from "../../types/engine";
import { ButtonChip } from "./ButtonChip";

const MAX_SECONDS = 60;

/**
 * Records button presses from the physical controller (USB or Bluetooth).
 * The engine captures presses, releases and timing; this panel only drives it.
 */
export function RecordPanel({ hasSteps, onRecorded }: {
  hasSteps: boolean;
  onRecorded: (steps: MacroStep[], how: "replace" | "append") => void;
}) {
  const { status, connection } = useEngine();
  const rec = status?.macros.recording ?? null;
  const device = status?.devices[0];
  const controllerReady = connection.kind === "ready" && !!device?.input;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<MacroStep[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const recordingRef = useRef(false);
  recordingRef.current = !!rec;

  // Never leave a recording running when the panel goes away.
  useEffect(() => () => {
    if (recordingRef.current) void engineApi.cancelMacroRecording();
  }, []);

  const start = async () => {
    setError(null); setNote(null); setPending(null);
    try { await engineApi.startMacroRecording(); } catch (e) { setError(errorMessage(e)); }
  };

  const stop = async () => {
    try {
      const result = await engineApi.stopMacroRecording();
      const steps = result.steps.map((s) => ({ ...s, id: uid() }));
      if (steps.length === 0) {
        setNote("No button presses were captured. Press Start Recording and try again.");
        return;
      }
      setNote(`Captured ${steps.length} action${steps.length === 1 ? "" : "s"} (${formatMs(result.durationMs)}).` +
        (result.limitReached ? " Recording reached its limit and stopped early." : ""));
      if (hasSteps) setPending(steps);
      else onRecorded(steps, "replace");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (rec) {
    const seconds = Math.floor(rec.elapsedMs / 1000);
    return (
      <div className="record-panel recording" aria-live="polite">
        <div className="rec-head">
          <span className="rec-dot" aria-hidden="true" />
          <strong>Recording</strong>
          <span className="mono">{String(Math.floor(seconds / 60)).padStart(1, "0")}:{String(seconds % 60).padStart(2, "0")}</span>
          <span className="muted small">· {rec.presses} press{rec.presses === 1 ? "" : "es"} · stops automatically after {MAX_SECONDS} s</span>
        </div>
        <div className="rec-held">
          {rec.held.length > 0
            ? rec.held.map((b) => <ButtonChip key={b} button={b} size="lg" active />)
            : <span className="muted">Press buttons on your controller…</span>}
        </div>
        {rec.interrupted && <div className="notice warn">Your controller disconnected, so recording stopped. Press Stop to keep what was captured.</div>}
        {rec.limitReached && <div className="notice warn">Recording limit reached. Press Stop to keep it.</div>}
        <div className="row gap">
          <button className="btn-primary" onClick={() => void stop()}>■ Stop Recording</button>
          <button className="btn-ghost" onClick={() => void engineApi.cancelMacroRecording()}>Cancel</button>
        </div>
        <p className="muted small">Macros are paused while you record. Stick movement is not recorded, only buttons, D-pad and triggers.</p>
      </div>
    );
  }

  return (
    <div className="record-panel">
      {pending ? (
        <div className="rec-choice">
          <p>{note} What should we do with it?</p>
          <div className="row gap">
            <button className="btn-primary" onClick={() => { onRecorded(pending, "replace"); setPending(null); }}>Replace my sequence</button>
            <button className="btn-secondary" onClick={() => { onRecorded(pending, "append"); setPending(null); }}>Add to the end</button>
            <button className="btn-ghost" onClick={() => { setPending(null); setNote(null); }}>Discard</button>
          </div>
        </div>
      ) : (
        <>
          <div className="row gap">
            <button className="btn-record" onClick={() => void start()} disabled={!controllerReady}
              data-tip={controllerReady ? "Then press buttons on your controller" : "Connect your controller first"}>
              <span className="rec-dot" aria-hidden="true" /> Start Recording
            </button>
            <p className="muted small">
              {controllerReady
                ? "Press Start, perform your button presses on the controller, then press Stop. Timing is captured automatically."
                : "Connect your DualSense by USB or Bluetooth to record."}
            </p>
          </div>
          {note && <div className="notice dev">{note}</div>}
        </>
      )}
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
