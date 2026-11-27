import { useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * Underline tabs with the keyboard behaviour screen-reader users expect:
 * one Tab stop (the selected tab), arrow keys move between tabs and select
 * them, Home and End jump to the ends. The panel is labelled by its tab.
 */
export function Tabs<T extends string>({ id, label, tabs, value, onChange }: {
  id: string; label: string; tabs: Array<{ id: T; label: string }>; value: T; onChange: (t: T) => void;
}) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const t = tabs[to]!.id;
    onChange(t);
    refs.current[t]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab"
          id={`${id}-tab-${t.id}`} aria-controls={`${id}-panel`} aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
          className={value === t.id ? "selected" : ""} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>{t.label}</button>
      ))}
    </div>
  );
}

/** The panel of the selected tab. */
export function TabPanel({ id, tab, children, className }: { id: string; tab: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} className={className}>{children}</div>
  );
}
