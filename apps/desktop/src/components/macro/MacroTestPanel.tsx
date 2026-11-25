import { useEffect, useState } from "react";
import { useEngine, usePrimaryDevice } from "../../hooks/useEngine";
import { engineApi } from "../../lib/engine";
import { buttonNames, formatMs } from "../../lib/macros";
import { describeStep, runView } from "../../lib/macroStudio";
import type { Macro } from "../../types/engine";
import { ControllerVisual } from "../ControllerVisual";
import { ButtonChip } from "./ButtonChip";

/**
 * Test a macro with the real controller: what the engine reports it is doing
 * (waiting for its button, arming, running action N, stopped) and what NEXUS
 * sends. Redraws only while the macro is arming or running.
 */
export function MacroTestPanel({ macro, savedEnabled }: { macro: Macro; savedEnabled: boolean }) {
  const { status } = useEngine();
  const device = usePrimaryDevice();
  const run = device?.macroRuns?.find((r) => r.id === macro.id);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const tick = () => { setNow(Date.now()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);
  const view = runView(macro, run, now);
  const anyPlaying = (device?.playingMacros.length ?? 0) > 0;
  const games = status?.macros.gamesCanReceive ?? false;

  let state: string, detail: string | null = null, progress: number | null = null;
  if (!device?.processed) { state = "No controller"; detail = "Connect your controller to test this macro."; }
  else if (!macro.trigger) { state = "No button"; detail = "Choose a button that starts this macro to test it."; }
  else if (!savedEnabled) { state = "Off"; detail = "Turn the macro on (in this profile) to test it."; }
  else if (view.state === "arming") {
    state = "Arming"; detail = `Keep holding: ${view.heldMs} of ${view.neededMs} ms.`; progress = view.neededMs ? view.heldMs / view.neededMs : 1;
  } else if (view.state === "running") {
    state = "Running";
    const what = view.step !== null ? `Action ${view.step + 1} of ${macro.steps.length}: ${describeStep(macro.steps, view.step)}` : "Pause between repeats";
    const pass = view.passes !== null ? (view.passes > 1 ? ` · pass ${view.pass + 1} of ${view.passes}` : "") : ` · repeat ${view.pass + 1}`;
    detail = `${what}${pass}${view.down.length ? ` · down: ${buttonNames(view.down)}` : ""}`;
    progress = view.progress;
  } else { state = "Waiting"; detail = null; }

  return (
    <div className="card macro-test" aria-live="polite">
      <div className="card-title-row">
        <h2>Test</h2>
        <span className={`badge ${games ? "tone-warn" : "dev"}`}>{games ? "Games receive this" : "NEXUS only · not sent to games"}</span>
      </div>
      <div className={`run-state run-${state.toLowerCase().replace(" ", "-")}`}>
        <span className="run-dot" aria-hidden="true" />
        <strong>{state}</strong>
        {state === "Waiting" && macro.trigger && (
          <span className="muted small">Press <ButtonChip button={macro.trigger} size="sm" /> on your controller{macro.activationMs ? ` and hold it ${macro.activationMs} ms` : ""}.</span>
        )}
      </div>
      {detail && <p className="small run-detail">{detail}</p>}
      {progress !== null && <div className="preview-progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
      {device?.processed && (
        <div className="live-test-visual"><ControllerVisual state={device.processed} live /></div>
      )}
      <div className="row gap-sm wrap">
        <button className="btn-danger small" disabled={!anyPlaying} onClick={() => void engineApi.stopAllMacros()}
          data-tip="Stops every running macro at once; nothing stays pressed">■ Stop all macros</button>
        <span className="muted small">{games
          ? "The virtual controller is on, so a game in front receives what the macro presses."
          : "Turn on the virtual controller for games to receive it."} Timing follows controller reports (about every 4 ms over USB); {formatMs(4)} is the finest step.</span>
      </div>
    </div>
  );
}
