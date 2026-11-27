import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { engineApi, errorMessage } from "../lib/engine";
import { describeCheck, nextStreak, rowsFor } from "../lib/outputCheck";
import type { OutputCheck as Check } from "../types/engine";

/** How often Windows is asked while this tab is open (not at all otherwise). */
const POLL_MS = 150;
/** Consecutive matching reads before the result is called a pass. */
const STABLE = 5;

/**
 * Live Viewer › Output Check: reads the virtual Xbox 360 controller back
 * through XInput (what games read) and compares it with what NEXUS sent.
 * Read-only; it never sends anything.
 */
export function OutputCheck() {
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streak, setStreak] = useState({ matches: 0, mismatches: 0 });
  const [passedOnce, setPassedOnce] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const c = await engineApi.checkVirtualOutput();
        if (!alive) return;
        setCheck(c);
        setError(null);
        setStreak((s) => {
          const n = nextStreak(s, c);
          if (n.matches >= STABLE) setPassedOnce(true);
          return n;
        });
      } catch (e) {
        if (alive) setError(errorMessage(e));
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  if (error) return <div className="card"><p className="warn-text">{error}</p></div>;
  // Until the first read-back arrives from the engine.
  if (!check) return <div className="card" role="status" aria-busy="true"><span className="loading-inline"><span className="spinner" aria-hidden="true" /> Reading the virtual controller…</span></div>;
  const d = describeCheck(check);
  const stable = check.state === "compared" && (streak.matches >= STABLE || streak.mismatches >= STABLE);
  const tone = check.state === "compared" ? (streak.matches >= STABLE ? "ok" : streak.mismatches >= STABLE ? "bad" : "warn") : d.tone;

  return (
    <div className="lv-section">
      <section className="card">
        <div className="oc-head">
          <i className={`oc-dot ${tone}`} aria-hidden="true" />
          <div>
            <h3 style={{ margin: 0 }}>{check.state === "compared" && streak.mismatches >= STABLE ? "Windows doesn't receive what NEXUS sends" : d.title}</h3>
            <p className="muted small" style={{ margin: "2px 0 0" }}>{check.state === "compared" && !stable ? "Checking…" : d.detail}</p>
          </div>
        </div>
        {check.state === "compared" && passedOnce && <p className="ok-text small">Passed at least once since this tab opened.</p>}
        <p className="muted small">
          NEXUS reads the virtual controller back through XInput, the same way games read it, about 6 times a second while this tab is open, and compares it with what it sent.
          Press buttons, pull the triggers and move the sticks: every row should stay green. Windows never shows the PS (Guide) button to games, so it isn't listed.
        </p>
      </section>
      {check.state === "compared" && (
        <section className="card">
          <div className="oc-grid">
            <div className="oc-row head"><span>Input</span><span className="mono">Sent</span><span className="mono">Windows</span><span /></div>
            {rowsFor(check.sent, check.read).map((r) => (
              <div key={r.label} className={`oc-row${r.ok ? "" : " bad"}`}>
                <span>{r.label}</span><span className="mono">{r.sent}</span><span className="mono">{r.read}</span>
                <span className={r.ok ? "ok-text" : "err-text"}><Icon name={r.ok ? "check" : "x"} size={13} label={r.ok ? "match" : "different"} /></span>
              </div>
            ))}
          </div>
          {check.differences.length > 0 && streak.mismatches >= STABLE && (
            <ul className="warn-text small">{check.differences.map((x) => <li key={x}>{x}</li>)}</ul>
          )}
        </section>
      )}
    </div>
  );
}
