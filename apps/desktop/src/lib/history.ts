// Undo/redo rules used by hooks/useHistory.ts, as a pure reducer so they can
// be tested without React.

export const HISTORY_LIMIT = 100;

export interface HistoryState<T> { past: T[]; present: T; future: T[] }

export type HistoryAction<T> =
  | { type: "set"; value: T }
  | { type: "reset"; value: T }
  | { type: "undo" }
  | { type: "redo" };

export function historyReducer<T>(s: HistoryState<T>, a: HistoryAction<T>): HistoryState<T> {
  switch (a.type) {
    case "set":
      if (Object.is(a.value, s.present)) return s;
      return { past: [...s.past, s.present].slice(-HISTORY_LIMIT), present: a.value, future: [] };
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
