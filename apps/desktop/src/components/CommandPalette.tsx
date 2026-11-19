import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteItem { label: string; hint: string; page: string; tab?: string; keywords: string }

export const SEARCH_ITEMS: PaletteItem[] = [
  { label: "Dashboard", hint: "Status overview", page: "dashboard", keywords: "home status overview" },
  { label: "Live input", hint: "Controller", page: "controller", tab: "live", keywords: "visualization test buttons" },
  { label: "Stick deadzone & curve", hint: "Controller › Sticks", page: "controller", tab: "sticks", keywords: "deadzone anti curve sensitivity drift response square circle" },
  { label: "Stick calibration", hint: "Controller › Sticks", page: "controller", tab: "sticks", keywords: "calibrate centre center range" },
  { label: "Trigger settings", hint: "Controller › Triggers", page: "controller", tab: "triggers", keywords: "l2 r2 deadzone activation click point calibrate sensitivity" },
  { label: "Gyro / motion aiming", hint: "Controller › Gyro", page: "controller", tab: "gyro", keywords: "gyroscope motion aim tilt smoothing calibrate" },
  { label: "Touchpad zones & swipes", hint: "Controller › Touchpad", page: "controller", tab: "touchpad", keywords: "touch swipe gesture zone click" },
  { label: "Button remapping", hint: "Controller › Mapping", page: "controller", tab: "buttons", keywords: "remap mapping swap disable layer shift modifier" },
  { label: "Shift layers", hint: "Controller › Mapping", page: "controller", tab: "buttons", keywords: "layer shift modifier toggle hold" },
  { label: "Virtual controller", hint: "Controller › Virtual Output", page: "controller", tab: "output", keywords: "xbox 360 dualshock ds4 output driver vigem hidhide" },
  { label: "Lightbar & vibration", hint: "Controller › Lighting & Haptics", page: "controller", tab: "lighting", keywords: "light colour color rgb led rumble vibration haptics player" },
  { label: "Controller Studio", hint: "Customise the 3D controller", page: "studio", keywords: "skin colour color theme design paint custom carbon chrome decal preset look appearance" },
  { label: "Macro Studio", hint: "Create and record macros", page: "macro-studio", keywords: "macro record sequence combo" },
  { label: "Profiles", hint: "Switch, create, games", page: "profiles", keywords: "profile game automatic switch template" },
  { label: "Backup & restore", hint: "Profiles", page: "profiles", keywords: "backup restore export import transfer file" },
  { label: "Performance", hint: "Report rate and timing", page: "performance", keywords: "latency rate dropped diagnostics" },
  { label: "Settings", hint: "App, devices, diagnostics", page: "settings", keywords: "version update diagnostics hid scan" },
  { label: "Check for updates", hint: "Settings", page: "settings", keywords: "update version release" },
];

/** Ctrl+K search over pages and settings. */
export function CommandPalette({ onNavigate }: { onNavigate: (page: string, tab?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); setQ(""); setI(0); }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => { setOpen(true); setQ(""); setI(0); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("nexus:search", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("nexus:search", onOpen); };
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return SEARCH_ITEMS;
    return SEARCH_ITEMS.filter((s) => `${s.label} ${s.hint} ${s.keywords}`.toLowerCase().includes(t));
  }, [q]);

  if (!open) return null;
  const go = (s: PaletteItem) => { setOpen(false); onNavigate(s.page, s.tab); };
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search settings" onClick={(e) => e.stopPropagation()}>
        <input ref={input} className="palette-input" placeholder="Search settings… (e.g. deadzone, gyro, backup)" value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setI(Math.min(i + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI(Math.max(i - 1, 0)); }
            if (e.key === "Enter" && results[i]) go(results[i]!);
          }}
          aria-activedescendant={results[i] ? `pal-${i}` : undefined} />
        <ul className="palette-list" role="listbox">
          {results.length === 0 && <li className="muted small palette-empty">No matching settings.</li>}
          {results.map((s, n) => (
            <li key={s.label} id={`pal-${n}`} role="option" aria-selected={n === i} className={n === i ? "active" : ""}
              onMouseEnter={() => setI(n)} onClick={() => go(s)}>
              <strong>{s.label}</strong><span className="muted small">{s.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
