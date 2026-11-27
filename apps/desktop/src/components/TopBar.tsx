import { Icon } from "./Icons";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { useControllerPhase } from "./StatusPill";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { modelLabel } from "../lib/format";
import { pageTrail, type PageId } from "../lib/navigation";
import { outputLine } from "../lib/sidebarStatus";

/**
 * The bar above every page: where you are, the active profile (switchable
 * here), and whether the controller and the virtual controller are working.
 * Everything shown comes from the engine's live status.
 */
export function TopBar({ page, tab }: { page: PageId; tab?: string }) {
  const phase = useControllerPhase();
  const { status, connection } = useEngine();
  const device = usePrimaryDevice();
  const output = outputLine(status, device, connection.kind);
  const trail = pageTrail(page, tab);
  // "Xbox output: on" → a short label and its state, so narrow windows can drop the label.
  const [outKey, outValue] = output.label.includes(": ") ? output.label.split(": ", 2) : [null, output.label];

  return (
    <header className="topbar">
      <nav className="crumbs" aria-label="Location">
        {trail.group && <>
          <span className="crumb-group">{trail.group}</span>
          <span className="crumb-sep crumb-group" aria-hidden="true"><Icon name="chevronRight" size={13} /></span>
        </>}
        <span className={trail.sub ? undefined : "crumb-current"} aria-current={trail.sub ? undefined : "page"}>{trail.label}</span>
        {trail.sub && <>
          <span className="crumb-sep" aria-hidden="true"><Icon name="chevronRight" size={13} /></span>
          <span className="crumb-current" aria-current="page">{trail.sub}</span>
        </>}
      </nav>
      <div className="topbar-end">
        <ProfileSwitcher />
        <span className="topbar-sep" aria-hidden="true" />
        <span className={`status-chip tone-${phase.tone}`} title={phase.detail} role="status" aria-label={`Controller: ${phase.label}`}>
          <span className="dot" />
          <Icon name="controller" size={15} />
          <span><span className="chip-detail">{device ? modelLabel[device.device.model] : "Controller"} · </span><strong>{phase.label}</strong></span>
        </span>
        <span className={`status-chip tone-${output.tone}`} title={output.tip} aria-label={output.label}>
          <span className="dot" />
          <Icon name="output" size={15} />
          <span>{outKey && <span className="chip-detail">{outKey} · </span>}<strong>{outValue}</strong></span>
        </span>
      </div>
    </header>
  );
}
