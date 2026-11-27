import { useEffect, useRef, useState } from "react";
import { useControllerPhase } from "./StatusPill";

const KEY = "nexus.onboarding.v1";

function done(): boolean {
  try { return localStorage.getItem(KEY) === "done"; } catch { return true; }
}
function markDone() {
  try { localStorage.setItem(KEY, "done"); } catch { /* storage unavailable: show again next time */ }
}

/** First-launch walkthrough. Shown once; can be reopened from Settings. */
export function Onboarding({ forceOpen, onClose, onNavigate }: {
  forceOpen?: boolean; onClose?: () => void; onNavigate: (page: string) => void;
}) {
  const [open, setOpen] = useState(() => forceOpen || !done());
  const [step, setStep] = useState(0);
  const phase = useControllerPhase();
  const visible = open || !!forceOpen;
  // Escape dismisses the guide, like Skip.
  const closeRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);
  if (!visible) return null;
  const close = () => { markDone(); setOpen(false); onClose?.(); };
  closeRef.current = close;
  const steps = [
    { title: "Welcome to NEXUS", body: <>NEXUS reads your DualSense or DualShock 4, lets you tune sticks and triggers, remap buttons, add gyro aiming and record macros, and saves everything in profiles.</> },
    { title: "Connect your controller", body: <>
      Plug your DualSense (USB-C) or DualShock 4 (Micro-USB) into the PC with a data cable. NEXUS finds it automatically and shows which one it is.
      <div className={`onb-status tone-${phase.tone}`}><span className="dot" /> {phase.label}: {phase.detail}</div></> },
    { title: "Let games see it", body: <>Games see NEXUS as an Xbox 360 controller through <b>ViGEmBus</b>, a free driver you install yourself (NEXUS never installs drivers). The <b>Dashboard</b> shows a <b>Get ready to play</b> checklist with each step and what to do if something isn't working.</> },
    { title: "Make it yours", body: <>Open <b>Mapping</b> to remap buttons, or <b>Sticks</b>, <b>Triggers</b>, <b>Motion</b> and <b>Touchpad</b> in the sidebar to tune them, or start from a template in <b>Profiles</b>. Changes save automatically.</> },
    { title: "Find anything fast", body: <>Press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere to search every setting. Hover any control for an explanation.</> },
  ];
  const s = steps[step]!;
  return (
    <div className="modal-backdrop">
      <div className="modal onboarding" role="dialog" aria-modal="true" aria-labelledby="onb-title">
        <div className="onb-dots" aria-hidden="true">{steps.map((_, i) => <span key={i} className={i === step ? "on" : ""} />)}</div>
        <h2 id="onb-title">{s.title}</h2>
        <div className="modal-body">{s.body}</div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={close}>Skip</button>
          {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
          {step < steps.length - 1
            ? <button className="btn-primary" autoFocus onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn-primary" autoFocus onClick={() => { close(); onNavigate("mapping"); }}>Open Mapping</button>}
        </div>
      </div>
    </div>
  );
}
