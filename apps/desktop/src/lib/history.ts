// Undo/redo rules used by hooks/useHistory.ts, as a pure reducer so they can
// be tested without React.

export const HISTORY_LIMIT = 100;

export interface HistoryState<T> {
  past: T[]; present: T; future: T[];
  /** Key of the last "set" that may be merged with the next one (e.g. dragging a slider). */
  lastMerge?: string;
}

export type HistoryAction<T> =
  /** `merge`: consecutive sets with the same key become one undo step. */
  | { type: "set"; value: T; merge?: string }
  | { type: "reset"; value: T }
  | { type: "undo" }
  | { type: "redo" };

export function historyReducer<T>(s: HistoryState<T>, a: HistoryAction<T>): HistoryState<T> {
  switch (a.type) {
    case "set":
      if (Object.is(a.value, s.present)) return s;
      if (a.merge && a.merge === s.lastMerge) return { ...s, present: a.value, future: [] };
      return { past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: a.value, future: [], lastMerge: a.merge };
    case "reset":
      return { past: [], present: a.value, future: [] };
    case "undo": {
      const prev = s.past[s.past.length - 1];
      if (prev === undefined) return s;
      return { past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future] };
    }
    case "redo": {
      const next = s.future[0];
      if (next === undefined) return s;
      return { past: [...s.past, s.present], present: next, future: s.future.slice(1) };
    }
  }
}
