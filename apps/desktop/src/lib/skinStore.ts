// Saved skins and which skin is active. Skins are stored in the webview's
// built-in IndexedDB (they can hold uploaded graphics, too large for simple
// storage); the active skin's id is a small preference. Nothing here touches
// the engine, profiles or input. Records are validated when read; a record
// that can't be read is skipped, never deleted or overwritten.

import { useEffect, useMemo, useState } from "react";
import { migrateSkin, newSkin, presetSkin, type Skin } from "./skin.ts";

export interface SkinBackend {
  all(): Promise<unknown[]>;
  put(skin: Skin): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface Prefs {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const ACTIVE_KEY = "nexus.activeSkin.v1";
/** The colour switch that came before Controller Studio (black or white). */
export const OLD_FINISH_KEY = "nexus.controllerFinish.v1";

export interface LibraryState {
  loaded: boolean;
  /** Saved (user) skins, newest change first. */
  skins: Skin[];
  activeId: string;
  /** A storage problem to show, if any. */
  error: string | null;
}

export interface SkinLibrary {
  getState(): LibraryState;
  subscribe(fn: () => void): () => void;
  load(): Promise<void>;
  /** The skin for an id: a saved skin, a preset, or Midnight Black if it no longer exists. */
  resolve(id: string): Skin;
  active(): Skin;
  setActive(id: string): void;
  /** Saves (adds or replaces by id). */
  save(skin: Skin): Promise<Skin>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string): Promise<Skin>;
}

export function createSkinLibrary(backend: SkinBackend, prefs: Prefs, now: () => number = Date.now): SkinLibrary {
  // First run with Controller Studio: keep the colour chosen with the old switch.
  const initialActive = prefs.get(ACTIVE_KEY) ?? (prefs.get(OLD_FINISH_KEY) === "white" ? "preset-arctic" : "preset-midnight");
  let state: LibraryState = { loaded: false, skins: [], activeId: initialActive, error: null };
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<LibraryState>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };
  const sorted = (skins: Skin[]) => [...skins].sort((a, b) => b.updatedAt - a.updatedAt);

  const lib: SkinLibrary = {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    async load() {
      try {
        const records = await backend.all();
        const skins: Skin[] = [];
        for (const r of records) {
          const m = migrateSkin(r, now());
          if (m.ok) skins.push(m.skin);
        }
        emit({ loaded: true, skins: sorted(skins), error: null });
      } catch (e) {
        emit({ loaded: true, error: `Saved skins couldn't be read (${e instanceof Error ? e.message : String(e)}).` });
      }
    },
    resolve(id) {
      return state.skins.find((s) => s.id === id) ?? presetSkin(id) ?? presetSkin("preset-midnight")!;
    },
    active: () => lib.resolve(state.activeId),
    setActive(id) {
      prefs.set(ACTIVE_KEY, id);
      emit({ activeId: id });
    },
    async save(skin) {
      const saved = { ...skin, updatedAt: now() };
      await backend.put(saved);
      emit({ skins: sorted([saved, ...state.skins.filter((s) => s.id !== saved.id)]) });
      return saved;
    },
    async remove(id) {
      await backend.remove(id);
      emit({ skins: state.skins.filter((s) => s.id !== id) });
      if (state.activeId === id) lib.setActive("preset-midnight");
    },
    async rename(id, name) {
      const s = state.skins.find((x) => x.id === id);
      const clean = name.trim().slice(0, 40);
      if (!s || !clean) return;
      await lib.save({ ...s, name: clean });
    },
    async duplicate(id) {
      const s = lib.resolve(id);
      const copy: Skin = { ...structuredClone(s), id: newSkin(s.name, s.base, now()).id, name: `${s.name} copy`.slice(0, 40), createdAt: now() };
      return lib.save(copy);
    },
  };
  return lib;
}

// ---- Browser storage ---------------------------------------------------------------

const DB = "nexus-studio";
const STORE = "skins";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

function request<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const r = run(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(r.result); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("storage error")); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("storage full or blocked")); };
  }));
}

export const indexedDbBackend: SkinBackend = {
  all: () => request<unknown[]>("readonly", (s) => s.getAll()),
  put: (skin) => request("readwrite", (s) => s.put(skin)).then(() => undefined),
  remove: (id) => request("readwrite", (s) => s.delete(id)).then(() => undefined),
};

export function memoryBackend(initial: unknown[] = []): SkinBackend {
  const rows = new Map<string, unknown>(initial.map((r, i) => [String((r as { id?: string })?.id ?? i), r]));
  return {
    all: async () => [...rows.values()].map((r) => structuredClone(r)),
    put: async (skin) => { rows.set(skin.id, structuredClone(skin)); },
    remove: async (id) => { rows.delete(id); },
  };
}

const localPrefs: Prefs = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* display preference only */ } },
};

let shared: SkinLibrary | null = null;
/** The app-wide library (created and loaded on first use). */
export function skinLibrary(): SkinLibrary {
  if (!shared) {
    const hasIdb = typeof indexedDB !== "undefined";
    shared = createSkinLibrary(hasIdb ? indexedDbBackend : memoryBackend(), localPrefs);
    void shared.load();
  }
  return shared;
}

/** Re-renders when the library changes. */
export function useSkinLibrary(): LibraryState & { lib: SkinLibrary } {
  const lib = skinLibrary();
  const [state, setState] = useState(lib.getState());
  useEffect(() => lib.subscribe(() => setState(lib.getState())), [lib]);
  return { ...state, lib };
}

/** The skin the 3D controller shows across NEXUS. */
export function useActiveSkin(): Skin {
  const { lib, activeId, skins } = useSkinLibrary();
  return useMemo(() => lib.resolve(activeId), [lib, activeId, skins]);
}

// ---- Small colour preferences (favourites and recent colours) ---------------------

const FAV_KEY = "nexus.studio.favoriteColors.v1";
const RECENT_KEY = "nexus.studio.recentColors.v1";

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^#[0-9a-f]{6}$/.test(x)).slice(0, 24) : [];
  } catch { return []; }
}

export const colorPrefs = {
  favorites: () => readList(FAV_KEY),
  recent: () => readList(RECENT_KEY),
  setFavorites: (l: string[]) => localPrefs.set(FAV_KEY, JSON.stringify(l.slice(0, 24))),
  setRecent: (l: string[]) => localPrefs.set(RECENT_KEY, JSON.stringify(l.slice(0, 12))),
};
