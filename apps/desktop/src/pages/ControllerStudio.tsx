import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Capture } from "../components/controller3d/Controller3D";
import { StylePanel } from "../components/studio/StylePanel";
import { usePrimaryDevice } from "../hooks/useEngine";
import { useHistory } from "../hooks/useHistory";
import { webglAvailable } from "../lib/controllerViewMode";
import {
  LIGHTING, LIGHTING_IDS, PRESETS, exportSkin, fileNameFor, importSkin, isPlain, isPreset, newSkin, presetSkin,
  randomSkin, resetAll, resetComponent, searchComponents, styleOf, type ComponentId, type ComponentStyle, type Skin,
} from "../lib/skin";
import { useSkinLibrary } from "../lib/skinStore";

const Controller3D = lazy(() => import("../components/controller3d/Controller3D"));

/** Downloads text or a data URL as a file (the webview saves it to Downloads). */
function download(name: string, data: string | Blob) {
  const url = typeof data === "string" && data.startsWith("data:") ? data : URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!url.startsWith("data:")) setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Controller Studio: customise how the 3D controller looks. Edits change a
 * working copy (with undo/redo) shown live on the 3D model; Save stores it
 * and makes it the skin shown across NEXUS. Input, mappings, macros and game
 * output are never touched.
 */
export function ControllerStudio() {
  const { lib, skins, activeId, loaded, error } = useSkinLibrary();
  const device = usePrimaryDevice();
  const [editingId, setEditingId] = useState(activeId);
  const saved = useMemo(() => lib.resolve(editingId), [lib, editingId, skins]);
  const history = useHistory<Skin>(saved);
  const draft = history.value;
  const [selected, setSelected] = useState<ComponentId>("frontShell");
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<ComponentId>>(new Set());
  const [compare, setCompare] = useState(false);
  const [clipboard, setClipboard] = useState<ComponentStyle | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ mode: "new" | "rename"; id?: string; name: string } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const capture = useRef<Capture | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify({ ...draft, thumbnail: undefined, updatedAt: 0 }) !== JSON.stringify({ ...saved, thumbnail: undefined, updatedAt: 0 });

  // When the library finishes loading, show the active skin.
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!loaded || loadedOnce.current) return;
    loadedOnce.current = true;
    setEditingId(activeId);
    history.reset(lib.resolve(activeId));
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = useCallback((next: Skin, merge?: string) => history.set(next, merge), [history]);
  const flash = (tone: "ok" | "warn", text: string) => { setNotice({ tone, text }); setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 4000); };

  /** Opens a skin for editing and makes it the active skin straight away. */
  const open = (id: string) => {
    if (dirty && id !== editingId) { setPendingSwitch(id); return; }
    setPendingSwitch(null);
    setEditingId(id);
    history.reset(lib.resolve(id));
    lib.setActive(id);
  };

  const thumbnail = () => capture.current?.image({ skin: draft, defaultAngle: true, width: 320 });
  const save = async () => {
    if (isPreset(draft.id)) { setNaming({ mode: "new", name: draft.name === "Custom" ? "My skin" : `${draft.name} custom` }); return; }
    const s = await lib.save({ ...draft, thumbnail: thumbnail() ?? draft.thumbnail });
    history.reset(s);
    lib.setActive(s.id);
    flash("ok", `Saved “${s.name}”. It's now the controller shown across NEXUS.`);
  };
  const saveAsNew = async (name: string) => {
    const base = newSkin(name.trim().slice(0, 40) || "My skin", draft.base);
    const s = await lib.save({ ...draft, id: base.id, name: base.name, createdAt: base.createdAt, thumbnail: thumbnail() });
    setEditingId(s.id);
    history.reset(s);
    lib.setActive(s.id);
    setNaming(null);
    flash("ok", `Saved “${s.name}”.`);
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    const r = importSkin(await file.text());
    if (!r.ok) { flash("warn", r.error); return; }
    const s = await lib.save(r.skin);
    setEditingId(s.id);
    history.reset(s);
    lib.setActive(s.id);
    flash(r.warnings.length ? "warn" : "ok", r.warnings.length ? `Imported “${s.name}”. ${r.warnings.join(" ")}` : `Imported “${s.name}”.`);
  };

  // Keyboard: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z / Ctrl+S (not while typing in a text field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && !["range", "checkbox", "color", "radio"].includes((t as HTMLInputElement).type));
      if (!(e.ctrlKey || e.metaKey) || typing) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); history.undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); history.redo(); }
      else if (k === "s") { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Preset thumbnails: rendered once from the real model when the view is ready.
  // One at a time with pauses in between, so the page stays responsive on slower graphics.
  const onReady = useCallback((api: Capture) => {
    capture.current = api;
    let i = 0;
    let stopped = false;
    const next = () => {
      if (stopped || i >= PRESETS.length) return;
      const p = PRESETS[i++]!;
      const sk = presetSkin(p.id);
      if (sk) { const img = api.image({ skin: sk, defaultAngle: true, width: 220 }); setThumbs((t) => ({ ...t, [p.id]: img })); }
      thumbTimer.current = window.setTimeout(next, 120);
    };
    thumbTimer.current = window.setTimeout(next, 800);
    stopThumbs.current = () => { stopped = true; };
  }, []);
  const thumbTimer = useRef<number | undefined>(undefined);
  const stopThumbs = useRef<() => void>(() => {});
  useEffect(() => () => { stopThumbs.current(); window.clearTimeout(thumbTimer.current); }, []);

  const list = searchComponents(query);
  const groups = [...new Set(list.map((c) => c.group))];
  const shown = compare ? saved : draft;
  const canUse3D = webglAvailable();

  return (
    <div className="page studio">
      <header className="st-toolbar" role="toolbar" aria-label="Controller Studio">
        <div className="st-title">
          <h1>Controller Studio</h1>
          <span className="muted small">{draft.name}{dirty ? " · unsaved changes" : ""}</span>
        </div>
        <div className="st-tools">
          <button type="button" className="btn-ghost small" disabled={!history.canUndo} onClick={history.undo} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button type="button" className="btn-ghost small" disabled={!history.canRedo} onClick={history.redo} title="Redo (Ctrl+Y)">↷ Redo</button>
          <span className="st-sep" />
          <button type="button" className="btn-ghost small" onClick={() => edit(randomSkin(draft, Date.now()))} title="A random, coordinated design">⚄ Randomise</button>
          <button type="button" className="btn-ghost small" disabled={isPlain(styleOf(draft, selected)) && !draft.decals.some((d) => d.component === selected) && (selected !== "lightBar" || draft.lightBar === "#4b6bff")}
            onClick={() => edit(resetComponent(draft, selected))}>Reset part</button>
          <button type="button" className="btn-ghost small" onClick={() => edit(resetAll(draft))}>Reset all</button>
          <button type="button" className={`btn-ghost small${compare ? " on" : ""}`} aria-pressed={compare} onClick={() => setCompare((c) => !c)}
            title="Switch between your changes and the saved version">{compare ? "Showing: saved" : "Compare"}</button>
          <span className="st-sep" />
          <label className="st-inline">Lighting
            <select className="select small" value={draft.lighting} onChange={(e) => edit({ ...draft, lighting: e.target.value as Skin["lighting"] })}>
              {LIGHTING_IDS.map((l) => <option key={l} value={l}>{LIGHTING[l]}</option>)}
            </select>
          </label>
          <label className="st-inline">Base
            <select className="select small" value={draft.base} onChange={(e) => edit({ ...draft, base: e.target.value as Skin["base"] })} title="How parts without a colour look">
              <option value="black">Midnight Black</option>
              <option value="white">White</option>
            </select>
          </label>
          <span className="st-sep" />
          <input ref={importInput} type="file" hidden accept=".json,application/json" onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="btn-ghost small" onClick={() => importInput.current?.click()}>Import</button>
          <button type="button" className="btn-ghost small" onClick={() => download(fileNameFor(draft), exportSkin(draft))}>Export</button>
          <button type="button" className="btn-ghost small" disabled={!capture.current} onClick={() => { const img = capture.current?.image(); if (img) download(`${fileNameFor(draft).replace(".nexusskin.json", "")}.png`, img); }}>Screenshot</button>
          <button type="button" className="btn-primary small" onClick={() => void save()} title="Save (Ctrl+S)">{isPreset(draft.id) ? "Save as new…" : dirty ? "Save" : "Saved"}</button>
          {!isPreset(draft.id) && <button type="button" className="btn-ghost small" onClick={() => setNaming({ mode: "new", name: `${draft.name} copy` })}>Save as…</button>}
        </div>
      </header>

      {notice && <div className={`notice ${notice.tone === "ok" ? "" : "warn"} st-notice`} role="status">{notice.text}</div>}
      {error && <div className="notice warn st-notice">{error}</div>}
      {pendingSwitch && (
        <div className="notice warn st-notice" role="alert">
          You have unsaved changes to “{draft.name}”.
          <button type="button" className="btn-ghost small" onClick={() => { void save(); }}>Save first</button>
          <button type="button" className="btn-ghost small danger" onClick={() => { const id = pendingSwitch; setPendingSwitch(null); setEditingId(id); history.reset(lib.resolve(id)); lib.setActive(id); }}>Discard and switch</button>
          <button type="button" className="btn-ghost small" onClick={() => setPendingSwitch(null)}>Cancel</button>
        </div>
      )}
      {naming && (
        <form className="notice st-notice st-naming" onSubmit={(e) => { e.preventDefault(); if (naming.mode === "rename" && naming.id) { void lib.rename(naming.id, naming.name); setNaming(null); } else void saveAsNew(naming.name); }}>
          <label>{naming.mode === "rename" ? "New name" : "Name for this skin"}
            <input autoFocus value={naming.name} maxLength={40} onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
          </label>
          <button type="submit" className="btn-primary small" disabled={!naming.name.trim()}>{naming.mode === "rename" ? "Rename" : "Save"}</button>
          <button type="button" className="btn-ghost small" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}

      <div className="st-workspace">
        <aside className="st-parts" aria-label="Parts">
          <input className="st-search" type="search" placeholder="Search parts…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search parts" />
          {groups.map((g) => (
            <div key={g} className="st-group">
              <h4>{g}</h4>
              {list.filter((c) => c.group === g).map((c) => {
                const st = styleOf(draft, c.id);
                const dot = c.id === "lightBar" ? draft.lightBar : st.color;
                const isHidden = hidden.has(c.id);
                return (
                  <div key={c.id} className={`st-part${selected === c.id ? " on" : ""}${isHidden ? " hidden" : ""}`}>
                    <button type="button" className="st-part-main" onClick={() => setSelected(c.id)} aria-pressed={selected === c.id}>
                      <i className={dot ? "" : "plain"} style={dot ? { background: dot } : undefined} />
                      <span>{c.label}</span>
                      {!isPlain(st) && <em>{st.finish !== "original" ? st.finish : "colour"}</em>}
                    </button>
                    <button type="button" className="st-eye" aria-pressed={!isHidden} title={isHidden ? "Show" : "Hide (for a look underneath)"}
                      onClick={() => { const n = new Set(hidden); if (isHidden) n.delete(c.id); else n.add(c.id); setHidden(n); }}>{isHidden ? "◌" : "◉"}</button>
                  </div>
                );
              })}
            </div>
          ))}
          {!list.length && <p className="muted small">No part matches “{query}”.</p>}
          {hidden.size > 0 && <button type="button" className="btn-ghost small" onClick={() => setHidden(new Set())}>Show all parts</button>}
        </aside>

        <main className="st-stage">
          {canUse3D ? (
            <Suspense fallback={<div className="c3d c3d-loading" />}>
              <Controller3D state={device?.input ?? null} live={Boolean(device?.input)} skin={shown} hidden={hidden} inStudio
                onReady={onReady} onSelectComponent={(c) => setSelected(c)} offlineLabel="No controller connected · the design still updates" />
            </Suspense>
          ) : <div className="notice warn">Controller Studio needs 3D graphics (WebGL), which this PC's graphics driver doesn't provide.</div>}
          <p className="muted small st-hint">Click a part on the controller or in the list. Drag to turn it, scroll to zoom; Rear and Top show the back and the triggers.</p>
        </main>

        <aside className="st-style" aria-label="Appearance">
          <StylePanel skin={draft} id={selected} edit={edit} clipboard={clipboard} setClipboard={(s) => { setClipboard(s); flash("ok", "Style copied. Select another part and Paste."); }} />
        </aside>
      </div>

      <section className="st-library" aria-label="Skins">
        <div className="st-lib-row">
          <h3>Presets</h3>
          <div className="st-cards">
            {PRESETS.map((p) => (
              <SkinCard key={p.id} name={p.spec.name} thumb={thumbs[p.id]} active={activeId === p.id} editing={editingId === p.id} onOpen={() => open(p.id)} />
            ))}
          </div>
        </div>
        <div className="st-lib-row">
          <h3>My skins {loaded ? `(${skins.length})` : ""}</h3>
          <div className="st-cards">
            {skins.map((s) => (
              <SkinCard key={s.id} name={s.name} thumb={s.thumbnail} active={activeId === s.id} editing={editingId === s.id} onOpen={() => open(s.id)}
                actions={[
                  ["Rename", () => setNaming({ mode: "rename", id: s.id, name: s.name })],
                  ["Duplicate", () => { void lib.duplicate(s.id).then((c) => flash("ok", `Made “${c.name}”.`)); }],
                  ["Export", () => download(fileNameFor(s), exportSkin(s))],
                  ["Delete", () => { if (editingId === s.id) { setEditingId("preset-midnight"); history.reset(lib.resolve("preset-midnight")); } void lib.remove(s.id).then(() => flash("ok", `Deleted “${s.name}”.`)); }],
                ]} />
            ))}
            {loaded && !skins.length && <p className="muted small">No saved skins yet. Start from a preset, change anything, then Save.</p>}
          </div>
        </div>
      </section>
      <p className="muted small st-credit">Skins change only how the controller looks in NEXUS. They never change input, mappings, macros or what games receive.</p>
    </div>
  );
}

function SkinCard({ name, thumb, active, editing, onOpen, actions }: {
  name: string; thumb?: string; active: boolean; editing: boolean; onOpen: () => void; actions?: Array<[string, () => void]>;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className={`st-card${editing ? " editing" : ""}`}>
      <button type="button" className="st-card-main" onClick={onOpen} aria-label={`Use ${name}`}>
        <span className="st-thumb">{thumb ? <img src={thumb} alt="" /> : <i />}</span>
        <span className="st-card-name">{name}</span>
        {active && <span className="st-badge">Active</span>}
      </button>
      {actions && (
        <div className="st-card-actions">
          {actions.map(([label, run]) => label === "Delete"
            ? (confirm
              ? <button key={label} type="button" className="danger" onClick={() => { setConfirm(false); run(); }}>Confirm delete</button>
              : <button key={label} type="button" onClick={() => setConfirm(true)}>Delete</button>)
            : <button key={label} type="button" onClick={run}>{label}</button>)}
        </div>
      )}
    </div>
  );
}
