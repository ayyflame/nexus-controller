import { Icon, type IconName } from "./Icons";
import { useControllerPhase } from "./StatusPill";

export type PageId =
  | "dashboard" | "stick-tuning" | "button-mapping" | "trigger-settings" | "macro-studio"
  | "controller-settings" | "profiles" | "performance" | "obs-overlay" | "settings";

export const NAV: Array<{ id: PageId; label: string; icon: IconName }> = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "stick-tuning", label: "Stick Tuning", icon: "stick" },
  { id: "button-mapping", label: "Button Mapping", icon: "mapping" },
  { id: "trigger-settings", label: "Trigger Settings", icon: "trigger" },
  { id: "macro-studio", label: "Macro Studio", icon: "macro" },
  { id: "controller-settings", label: "Controller Settings", icon: "controller" },
  { id: "profiles", label: "Profiles", icon: "profiles" },
  { id: "performance", label: "Performance", icon: "performance" },
  { id: "obs-overlay", label: "OBS Overlay", icon: "overlay" },
];

function NexusMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="nx-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d488" />
          <stop offset="1" stopColor="#b88a2e" />
        </linearGradient>
      </defs>
      <path d="M16 2 28 9v14l-12 7-12-7V9Z" fill="none" stroke="url(#nx-gold)" strokeWidth="2" />
      <path d="M11 21V11l10 10V11" fill="none" stroke="url(#nx-gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar({ page, onNavigate }: { page: PageId; onNavigate: (p: PageId) => void }) {
  const phase = useControllerPhase();
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
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item${page === item.id ? " active" : ""}`}
            onClick={() => onNavigate(item.id)}
            aria-current={page === item.id ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`mini-status tone-${phase.tone}`}>
          <span className="dot" />
          <span>{phase.label}</span>
        </div>
        <button
          className={`nav-item${page === "settings" ? " active" : ""}`}
          onClick={() => onNavigate("settings")}
          aria-current={page === "settings" ? "page" : undefined}
        >
          <Icon name="settings" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
