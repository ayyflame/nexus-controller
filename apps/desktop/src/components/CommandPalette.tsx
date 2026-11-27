import { useEffect, useMemo, useRef, useState } from "react";
import { SEARCH_ITEMS, type PaletteItem } from "../lib/navigation";

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
