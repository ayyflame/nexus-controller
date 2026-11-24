import { Icon } from "./Icons";
import { NAV_GROUPS, type PageId } from "../lib/navigation";
import { useControllerPhase } from "./StatusPill";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { outputLine } from "../lib/sidebarStatus";
import { modelLabel } from "../lib/format";

export type { PageId } from "../lib/navigation";

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
  const { status } = useEngine();
  const device = usePrimaryDevice();
  const output = outputLine(status, device);
  return (
    <aside className="sidebar">
      <div className="brand">
        <NexusMark />
        <div>
          <div className="brand-name">NEXUS</div>
          <div className="brand-sub">Controller Engine</div>
        </div>
      </div>

      <ProfileSwitcher />

      <nav className="nav" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? "top"} className="nav-group" role="group" aria-label={group.label ?? undefined}>
            {group.label && <div className="nav-group-label" aria-hidden="true">{group.label}</div>}
            {group.items.map((item) => (
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
          </div>
        ))}
      </nav>

      <button className="search-button" onClick={() => window.dispatchEvent(new Event("nexus:search"))}
        aria-label="Search settings (Ctrl+K)">
        <span>Search settings</span><kbd>Ctrl K</kbd>
      </button>

      <div className="sidebar-footer">
        <div className={`mini-status tone-${phase.tone}`} title={phase.detail}>
          <span className="dot" />
          <span>{device ? modelLabel[device.device.model] : "Controller"}: {phase.label}</span>
        </div>
        <div className={`mini-status tone-${output.tone}`} title={output.tip}>
          <span className="dot" />
          <span>{output.label}</span>
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
