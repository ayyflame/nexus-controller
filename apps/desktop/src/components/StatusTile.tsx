import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icons";

export type TileTone = "ok" | "warn" | "error" | "idle";

/**
 * One status card: what it is, its state now, and a line of detail (the
 * Dashboard's overview and the status rows of Virtual Controller,
 * Performance and Live Viewer). The tone is never the only signal: the
 * value says the state in words.
 */
export function StatusTile({ icon, label, value, sub, tone, action, className }: {
  icon: IconName; label: string; value: ReactNode; sub: ReactNode; tone: TileTone;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={`card status-tile tone-${tone}${className ? ` ${className}` : ""}`}>
      <div className="status-tile-head">
        <span className="status-tile-label">{label}</span>
        <span className="status-tile-icon" aria-hidden="true"><Icon name={icon} size={16} /></span>
      </div>
      <div className="status-tile-value">{value}</div>
      <div className="status-tile-sub">{sub}</div>
      {action && <button type="button" className="map-link status-tile-link" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** A row of status tiles; four across on wide windows, two below 1280 px. */
export function StatusStrip({ label, children, count = 4 }: { label: string; children: ReactNode; count?: 3 | 4 }) {
  return <section className={`status-strip${count === 3 ? " three" : ""}`} aria-label={label}>{children}</section>;
}
