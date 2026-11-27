import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import { NAV_GROUPS, type PageId } from "../lib/navigation";

export type { PageId } from "../lib/navigation";

function NexusMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="nx-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8fbaff" />
          <stop offset="1" stopColor="#2f6fe4" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#121a2b" stroke="url(#nx-mark)" strokeWidth="1.5" />
      <path d="M11 21.5V10.5l10 11V10.5" fill="none" stroke="url(#nx-mark)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Main navigation. Labels are always visible at the app's supported window
 * sizes (the window is at least 1100 px wide); below 1040 px it becomes an
 * icon rail (styles/shell.css), where the labels show as tooltips and stay
 * readable to screen readers.
 * Controller and profile status live in the top bar (components/TopBar.tsx).
 */
/** Matches styles/shell.css: below this width the sidebar is an icon rail. */
const RAIL_QUERY = "(max-width: 1040px)";

/** Whether the sidebar is the icon rail now (labels hidden), so it can offer tooltips only then. */
function useRail(): boolean {
  const [rail, setRail] = useState(() => window.matchMedia?.(RAIL_QUERY).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(RAIL_QUERY);
    if (!mq) return;
    const on = () => setRail(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return rail;
}

export function Sidebar({ page, onNavigate }: { page: PageId; onNavigate: (p: PageId) => void }) {
  // Native tooltips only in the rail: with the labels visible they would repeat them.
  const rail = useRail();
  const item = (id: PageId, label: string, icon: Parameters<typeof Icon>[0]["name"]) => (
    <button
      key={id}
      className={`nav-item${page === id ? " active" : ""}`}
      onClick={() => onNavigate(id)}
      aria-current={page === id ? "page" : undefined}
      title={rail ? label : undefined}
    >
      <Icon name={icon} size={17} />
      <span>{label}</span>
    </button>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <NexusMark />
        <div>
          <div className="brand-name">NEXUS</div>
          <div className="brand-sub">Controller Engine</div>
        </div>
      </div>

      <nav className="nav" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? "top"} className="nav-group" role="group" aria-label={group.label ?? undefined}>
            {group.label && <div className="nav-group-label" aria-hidden="true">{group.label}</div>}
            {group.items.map((i) => item(i.id, i.label, i.icon))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="search-button" onClick={() => window.dispatchEvent(new Event("nexus:search"))}
          aria-label="Search settings (Ctrl+K)" title={rail ? "Search settings (Ctrl+K)" : undefined}>
          <Icon name="search" size={15} />
          <span>Search</span><kbd>Ctrl K</kbd>
        </button>
        {item("settings", "Settings", "settings")}
      </div>
    </aside>
  );
}
