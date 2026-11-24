import { Component, Suspense, lazy, type ReactNode } from "react";
import type { Anchors } from "./controller3d/Controller3D";
import { webglAvailable } from "../lib/controllerViewMode";
import type { ButtonMark } from "../lib/buttonMapping";
import { describeState } from "../lib/controllerView";
import type { ControllerState, MacroButton } from "../types/engine";

/**
 * The controller picture used across NEXUS: the interactive 3D model of the
 * controller shown (DualSense or DualShock 4), driven only by real, parsed
 * input. Gold marks a pressed control, teal the selected one (the accent
 * colour on the Mapping page).
 *
 * - `state` null: shown in a neutral pose with a "no live input" badge, never animated.
 * - `onSelect`: controls become clickable; `selected` is highlighted.
 * - `marks`: small indicators for remapped, disabled and macro buttons.
 */
interface VisualProps {
  state: ControllerState | null;
  live: boolean;
  selected?: MacroButton | null;
  onSelect?: (b: MacroButton) => void;
  marks?: Partial<Record<MacroButton, ButtonMark>>;
  /** Wording of the badge shown while there is no live input. */
  offlineLabel?: string;
  /** Projected positions of the controls, for the Mapping page's connectors. */
  onAnchors?: (a: Anchors) => void;
  /** Show the selected control in the NEXUS accent colour (the Mapping workspace) instead of teal. */
  accentSelection?: boolean;
  /** Put the view buttons (presets, zoom, colour) in this element instead of over the picture. */
  toolbarHost?: HTMLElement | null;
}

/** The 3D view is loaded on first use, so pages without a controller picture stay light. */
const Controller3D = lazy(() => import("./controller3d/Controller3D"));

export function ControllerVisual(props: VisualProps) {
  if (!webglAvailable()) return <NoPicture state={props.state} />;
  return (
    <Fallback3D fallback={<NoPicture state={props.state} />}>
      <Suspense fallback={<div className="c3d c3d-loading" aria-label="Loading the 3D controller" />}>
        <Controller3D {...props} />
      </Suspense>
    </Fallback3D>
  );
}

/**
 * Shown where the PC can't draw 3D (no WebGL, or the graphics driver refuses
 * it): what is pressed, in words. Everything else on the page keeps working
 * (the Mapping page's cards still select and edit controls).
 */
function NoPicture({ state }: { state: ControllerState | null }) {
  return (
    <div className="c3d-unavailable" role="status">
      <strong>The 3D controller can't be shown on this PC</strong>
      <span className="muted small">It needs graphics acceleration (WebGL) in the app's web view. Updating the graphics driver usually fixes this.</span>
      <span className="small">{describeState(state)}</span>
    </div>
  );
}

/** If the 3D view fails (e.g. the graphics driver refuses WebGL), show the notice instead. */
class Fallback3D extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn("3D controller view unavailable.", e); }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
