import { useEngine, usePrimaryDevice } from "../../hooks/useEngine";
import type { Macro } from "../../types/engine";
import { ControllerVisual } from "../ControllerVisual";
import { ButtonChip } from "./ButtonChip";

/**
 * Shows what NEXUS would send to games: real controller input after macros.
 * This works today, even though games can't receive it until virtual output
 * exists, so users can test macros with their real controller.
 */
export function LiveTest({ macros, focus }: { macros: Macro[]; focus?: Macro }) {
  const { status } = useEngine();
  const device = usePrimaryDevice();
  const playing = device?.playingMacros ?? [];
  const names = macros.filter((m) => playing.includes(m.id)).map((m) => m.name);

  return (
    <div className="card live-test">
      <div className="card-title-row">
        <h2>Test with your controller</h2>
        {!status?.macros.gamesCanReceive && <span className="badge dev">NEXUS only · not sent to games</span>}
      </div>
      {!device?.processed ? (
        <p className="muted small">Connect your controller to try your macros here.</p>
      ) : (
        <>
          <p className="muted small">
            {focus?.trigger
              ? <>Press <ButtonChip button={focus.trigger} size="sm" /> on your controller. The picture shows what NEXUS would send to the game.</>
              : "Press a macro's button on your controller. The picture shows what NEXUS would send to the game."}
          </p>
          <div className="live-test-visual">
            <ControllerVisual state={device.processed} live flat />
          </div>
          <div className="live-test-status" aria-live="polite">
            {names.length > 0
              ? <><span className="play-dot" aria-hidden="true" /> Playing: <strong>{names.join(", ")}</strong></>
              : <span className="muted small">No macro playing</span>}
          </div>
        </>
      )}
    </div>
  );
}
