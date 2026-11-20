import { useEffect, useState } from "react";
import { useControllerPhase } from "./StatusPill";
import { CopyText } from "./CopyText";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { engineApi } from "../lib/engine";
import { readinessSteps, readyToPlay, type ReadyStep } from "../lib/readiness";

const MARK: Record<ReadyStep["state"], string> = { done: "✓", todo: "•", problem: "!", waiting: "…", optional: "○" };

function go(page: string, tab?: string) {
  window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page, tab } }));
}

/** The experimental-output switch, re-read whenever the requested output changes. */
function useOutputConsent(): boolean | null {
  const { connection, status } = useEngine();
  const [consent, setConsent] = useState<boolean | null>(null);
  const requested = status?.requestedOutput;
  useEffect(() => {
    if (connection.kind !== "ready") return;
    engineApi.getOutputConsent().then((c) => setConsent(c.enabled), () => setConsent(null));
  }, [connection.kind, requested]);
  return consent;
}

/** What still stands between the user and a game seeing NEXUS, with the fix for each. */
export function SetupChecklist() {
  const { status, connection } = useEngine();
  const device = usePrimaryDevice();
  const phase = useControllerPhase();
  const consent = useOutputConsent();
  const [expanded, setExpanded] = useState(false);
  if (connection.kind !== "ready") return null;
  const steps = readinessSteps({ status, device, phase: phase.key, consent });
  const ready = readyToPlay(steps);
  const open = expanded || !ready;
  return (
    <section className={`card setup-check${ready ? " ready" : ""}`} aria-label="Ready to play">
      <div className="card-title-row">
        <h2>{ready ? "Ready to play" : "Get ready to play"}</h2>
        {ready && (
          <button className="btn-ghost" onClick={() => setExpanded(!expanded)} aria-expanded={open}>
            {open ? "Hide details" : "Details"}
          </button>
        )}
      </div>
      {ready && !open && <p className="small muted">Your DualSense reaches games as an Xbox 360 controller.</p>}
      {open && (
        <ol className="setup-steps">
          {steps.map((s) => (
            <li key={s.id} className={`setup-step st-${s.state}`}>
              <span className="setup-mark" aria-hidden="true">{MARK[s.state]}</span>
              <div>
                <div className="setup-title">{s.title}</div>
                <div className="small muted">{s.detail}</div>
                {s.action && s.state !== "done" && ("url" in s.action
                  ? <CopyText text={s.action.url} />
                  : <button className="btn-secondary small" onClick={() => { const a = s.action as { page: string; tab?: string }; go(a.page, a.tab); }}>{s.action.label}</button>)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
