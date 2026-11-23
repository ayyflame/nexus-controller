import { useEffect } from "react";
import { modelFor, type ViewModel } from "../lib/controller3d";
import { useConnectedModel } from "./useEngine";
import type { ControllerState } from "../types/engine";

/** The model shown last, kept while no controller is connected (shared by every picture, 2D and 3D). */
let lastShown: ViewModel = "dualSense";

/**
 * Which controller every picture shows (3D model, drawing, mapping cards,
 * button pads): the one `state` came from, else the connected controller,
 * else the last one shown. Derived from the engine's existing status; there
 * is no separate controller state.
 */
export function useShownModel(state?: ControllerState | null): ViewModel {
  const connected = useConnectedModel();
  const which = modelFor(state?.format, connected, lastShown);
  useEffect(() => { lastShown = which; }, [which]);
  return which;
}
