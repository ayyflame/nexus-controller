import { useCallback, useState } from "react";
import { historyReducer, type HistoryState } from "../lib/history";

/** Value with undo/redo. `set` records a history entry. */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({ past: [], present: initial, future: [] });

  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => {
      const value = typeof next === "function" ? (next as (p: T) => T)(s.present) : next;
      return historyReducer(s, { type: "set", value });
    });
  }, []);

  /** Replaces the value without creating an undo entry (e.g. after loading). */
  const reset = useCallback((value: T) => setState((s) => historyReducer(s, { type: "reset", value })), []);
  const undo = useCallback(() => setState((s) => historyReducer(s, { type: "undo" })), []);
  const redo = useCallback(() => setState((s) => historyReducer(s, { type: "redo" })), []);

  return {
    value: state.present,
    set,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

export type History<T> = ReturnType<typeof useHistory<T>>;
