import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ButtonSelect } from "../components/controller/advanced";
import { ButtonChip } from "../components/macro/ButtonChip";
import { ConfirmDialog } from "../components/macro/common";
import { MacroEditor } from "../components/macro/MacroEditor";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { BUTTONS, LIMITS, MODES, newMacro } from "../lib/macros";
import { EMPTY_MACRO_META, MACRO_SORTS, organizeMacros, usageOf, type MacroSort } from "../lib/macroStudio";
import { MACRO_TEMPLATES } from "../lib/macroTemplates";
import { relativeTime } from "../lib/profileManager";
import type { Macro, MacroButton, MacroMeta, Profile } from "../types/engine";

const SORT_KEY = "nexus.macroSort";
const loadSort = (): MacroSort => {
  try { const v = localStorage.getItem(SORT_KEY); return MACRO_SORTS.some((s) => s.id === v) ? (v as MacroSort) : "modified"; } catch { return "modified"; }
};

/** Import macros from a file (adds, never overwrites) or export the whole library. */
function MacroTransfer({ onImported, setMsg }: { onImported: () => void; setMsg: (m: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ json: string; names: string[]; renamed: string[] } | null>(null);
  return (
    <>
      <button className="btn-ghost" data-tip="Add macros from a NEXUS file" onClick={() => file.current?.click()}>Import</button>
      <button className="btn-ghost" data-tip="Save every macro to one file in Documents\\NEXUS"
        onClick={async () => { try { const r = await engineApi.exportMacros(); setMsg(r.path ? `Saved to ${r.path}` : "Couldn't write the file."); } catch (e) { setMsg(errorMessage(e)); } }}>Export all</button>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        try {
          const json = await f.text();
          const p = await engineApi.previewImport(json, "add");
          setPending({ json, names: p.macros, renamed: p.renamed });
        } catch (err) { setMsg(errorMessage(err)); }
      }} />
      {pending && (
        <ConfirmDialog title={`Import ${pending.names.length} macro(s)?`} confirmLabel="Import"
          body={<><p>{pending.names.join(", ") || "No macros in this file."}</p>{pending.renamed.length > 0 && <p>Renamed: {pending.renamed.join(", ")}</p>}<p>Imported macros start switched off. Nothing you have is changed.</p></>}
          onCancel={() => setPending(null)}
          onConfirm={async () => { const p = pending; setPending(null); try { await engineApi.importConfig(p.json, "add"); onImported(); setMsg("Imported."); } catch (e) { setMsg(errorMessage(e)); } }} />
      )}
    </>
  );
}

/** What the editor shows: a saved macro, or a new one that isn't saved yet. */
type Open = { key: number; macro: Macro } | null;

/**
 * Macro Studio: every saved macro in a searchable list, with the selected one
 * open beside it. `initialTab` comes from other pages: "new:<button>" starts a
 * macro for that button, "edit:<id>" opens one.
 */
export function MacroStudio({ initialTab }: { initialTab?: string }) {
  const { connection, status, profile } = useEngine();
  const device = usePrimaryDevice();
  // Status arrives about 60 times a second: pass on only what the workspace
  // shows, so the list and editor re-render when it changes, not every report.
  return (
    <Workspace initialTab={initialTab} ready={connection.kind === "ready"} profileId={profile?.id ?? null}
      blockedReason={status && !status.macros.gamesCanReceive ? status.macros.blockedReason : null}
      hasDevice={device !== null} playingKey={(device?.playingMacros ?? []).join("\n")} />
  );
}

const Workspace = memo(function Workspace({ initialTab, ready, profileId, blockedReason, hasDevice, playingKey }: {
  initialTab?: string; ready: boolean; profileId: number | null; blockedReason: string | null; hasDevice: boolean; playingKey: string;
}) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [meta, setMeta] = useState<MacroMeta>(EMPTY_MACRO_META);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MacroSort>(loadSort);
  const [creating, setCreating] = useState<MacroButton | null | false>(false);
  const [toDelete, setToDelete] = useState<Macro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const nextKey = useRef(1);
  const handledTab = useRef(false);

  const openMacro = (m: Macro) => setOpen({ key: nextKey.current++, macro: m });

  const reload = useCallback(async () => {
    if (!ready) return;
    try {
      const [list, m, ps] = await Promise.all([engineApi.listMacros(), engineApi.getMacroMeta(), engineApi.listProfiles()]);
      setMacros(list); setMeta(m); setProfiles(ps); setLoaded(true); setNow(Date.now());
      return list;
    } catch (e) { setError(errorMessage(e)); }
  }, [ready]);
  // Which macros are on depends on the active profile.
  useEffect(() => { void reload(); }, [reload, profileId]);

  // Open what another page asked for, once the list has loaded.
  useEffect(() => {
    if (!loaded || handledTab.current) return;
    handledTab.current = true;
    if (initialTab?.startsWith("new:")) {
      const b = initialTab.slice(4) as MacroButton;
      setCreating(b in BUTTONS ? b : null);
      return;
    }
    const wanted = initialTab?.startsWith("edit:") ? macros.find((m) => m.id === initialTab.slice(5)) : undefined;
    const first = wanted ?? organizeMacros(macros, meta, "", sort).pinned[0] ?? organizeMacros(macros, meta, "", sort).others[0];
    if (first) openMacro(first);
  }, [loaded, initialTab, macros, meta, sort]);

  const { pinned, others } = useMemo(() => organizeMacros(macros, meta, query, sort), [macros, meta, query, sort]);
  const playing = useMemo(() => (playingKey ? playingKey.split("\n") : []), [playingKey]);
  const selectedId = open?.macro.id ?? "";

  const upsert = (m: Macro) => setMacros((list) =>
    list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); }
  };
  const chooseSort = (s: MacroSort) => { setSort(s); try { localStorage.setItem(SORT_KEY, s); } catch { /* display preference */ } };

  if (!ready) {
    return (
      <div className="page">
        <header className="page-header"><div><h1>Macro Studio</h1></div></header>
        <div className="card"><p className="muted">Macro Studio is available in the NEXUS desktop app.</p></div>
      </div>
    );
  }

  const row = (m: Macro) => {
    const usage = usageOf(m, meta, profiles, profileId);
    const isPinned = meta.pinned.includes(m.id);
    const isPlaying = playing.includes(m.id);
    return (
      <li key={m.id}>
        <button type="button" className={`pm-row ms-row${selectedId === m.id ? " selected" : ""}${usage.activeNow ? " active" : ""}`}
          aria-current={selectedId === m.id ? "true" : undefined} data-macro={m.id}
          onClick={() => { if (selectedId !== m.id) openMacro(m); }}>
          <span className="pm-row-top">
            {m.trigger ? <ButtonChip button={m.trigger} size="sm" active={usage.activeNow} /> : <span className="chip chip-sm unassigned" title="No button">?</span>}
            <span className="pm-row-name">{isPinned && <span className="pm-pin" aria-label="Pinned">★</span>}{m.name}</span>
            {isPlaying && <span className="play-dot" aria-label="Playing" />}
          </span>
          <span className="pm-row-sub">
            <span>{MODES[m.mode].title}</span>
            <span className="muted">· {m.steps.length} action{m.steps.length === 1 ? "" : "s"}</span>
            <span className="muted">· {relativeTime(m.updatedAtMs, now)}</span>
          </span>
          <span className="pm-row-sub">
            <span className={usage.profiles.length ? "ms-on" : "pm-note"}>
              {usage.profiles.length ? `On in ${usage.profiles.map((p) => p.name).join(", ")}` : "Off in every profile"}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const remove = (m: Macro) => {
    setToDelete(null);
    void run(async () => {
      await engineApi.deleteMacro(m.id);
      const list = await reload();
      const next = list?.[0];
      if (next) openMacro(next); else setOpen(null);
    });
  };

  return (
    <div className="page pm-page macro-studio">
      <header className="page-header">
        <div>
          <h1>Macro Studio</h1>
          <p className="muted">Record or build button sequences and start them from one button. Macros are shared by every profile; each profile chooses which are on.</p>
        </div>
        <div className="row gap-sm">
          {playing.length > 0 && (
            <button className="btn-danger" onClick={() => void engineApi.stopAllMacros()} data-tip="Stop every macro immediately; nothing stays pressed">■ Stop all</button>
          )}
          <MacroTransfer onImported={() => void reload()} setMsg={setMsg} />
          <button className="btn-primary" onClick={() => setCreating(null)}>＋ New macro</button>
        </div>
      </header>

      {blockedReason && (
        <div className="notice warn macro-banner"><strong>Macros don't reach games yet.</strong> {blockedReason}</div>
      )}
      {!hasDevice && <div className="notice dev">Connect your controller by USB to record and test macros.</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}

      <div className="pm-workspace ms-workspace">
        <nav className="pm-list ms-list" aria-label="Macros">
          <div className="ms-list-tools">
            <input className="text-input pm-search" type="search" placeholder="Search macros…" title="Searches names, descriptions and trigger buttons" value={query}
              onChange={(e) => setQuery(e.target.value)} aria-label="Search macros" />
            <select className="select" value={sort} onChange={(e) => chooseSort(e.target.value as MacroSort)} aria-label="Sort macros">
              {MACRO_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          {pinned.length > 0 && <>
            <div className="pm-group">Pinned</div>
            <ul>{pinned.map(row)}</ul>
          </>}
          {(others.length > 0 || pinned.length === 0) && (
            <div className="pm-group">{pinned.length ? "All macros" : `${others.length} macro${others.length === 1 ? "" : "s"}`}</div>
          )}
          <ul>{others.map(row)}</ul>
          {open && !open.macro.id && (
            <ul><li><button type="button" className="pm-row ms-row selected" aria-current="true">
              <span className="pm-row-top"><span className="pm-row-name">{open.macro.name || "New macro"}</span></span>
              <span className="pm-row-sub"><span className="pm-note">Not saved yet</span></span>
            </button></li></ul>
          )}
          {loaded && macros.length > 0 && pinned.length + others.length === 0 && <p className="muted small pm-empty">No macro matches “{query}”.</p>}
          {loaded && macros.length === 0 && !open && (
            <p className="muted small pm-empty">No macros yet. A macro presses a sequence of buttons for you when you press one button.</p>
          )}
        </nav>

        {open ? (
          <MacroEditor key={open.key} initial={open.macro} others={macros.filter((x) => x.id !== open.macro.id)}
            profiles={profiles} meta={meta} activeProfileId={profileId}
            onSaved={(m, wasNew) => {
              upsert(m); setNow(Date.now());
              if (wasNew) setOpen((o) => (o ? { key: o.key, macro: m } : o));
              void engineApi.getMacroMeta().then(setMeta).catch(() => undefined);
            }}
            onDuplicate={(m) => void run(async () => { const c = await engineApi.duplicateMacro(m.id); await reload(); openMacro(c); setMsg(`Made “${c.name}” (no button assigned).`); })}
            onExport={(m) => void run(async () => { const r = await engineApi.exportMacro([m.id]); setMsg(r.path ? `Saved to ${r.path}` : "Couldn't write the file."); })}
            onDelete={(m) => setToDelete(m)}
            onPin={(m, on) => void run(async () => setMeta(await engineApi.setMacroPinned(m.id, on)))} />
        ) : (
          <div className="pm-detail ms-empty">
            <h2>{macros.length ? "Choose a macro" : "Create your first macro"}</h2>
            <p className="muted">Record it from your controller in a few seconds, or build it action by action.</p>
            <div><button className="btn-primary" onClick={() => setCreating(null)}>＋ New macro</button></div>
          </div>
        )}
      </div>

      {creating !== false && (
        <NewMacroDialog trigger={creating} macros={macros}
          onCancel={() => {
            setCreating(false);
            // Opened from Mapping and cancelled: show a macro rather than an empty pane.
            if (!open) { const first = pinned[0] ?? others[0]; if (first) openMacro(first); }
          }}
          onCreate={(m) => { setCreating(false); openMacro(m); }} />
      )}
      {toDelete && (
        <ConfirmDialog title={`Delete “${toDelete.name}”?`} confirmLabel="Delete macro" danger
          body={<p>It is removed from every profile{toDelete.trigger ? ` and from ${BUTTONS[toDelete.trigger].name}` : ""}. This can't be undone. To keep it but stop it, switch it off or remove its button instead.</p>}
          onCancel={() => setToDelete(null)} onConfirm={() => remove(toDelete)} />
      )}
    </div>
  );
});

/** Name, starting point and (optionally) the button for a new macro. Nothing is saved until it has an action. */
function NewMacroDialog({ trigger, macros, onCancel, onCreate }: {
  trigger: MacroButton | null;
  macros: Macro[];
  onCancel: () => void;
  onCreate: (m: Macro) => void;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState<string>("empty");
  const [templateButton, setTemplateButton] = useState<MacroButton>("south");
  const [button, setButton] = useState<MacroButton | null>(trigger);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const taken = button ? macros.find((m) => m.trigger === button && m.enabled) : undefined;

  const create = () => {
    const t = MACRO_TEMPLATES.find((x) => x.id === start);
    onCreate({ ...newMacro(), name: name.trim(), trigger: button, steps: t ? t.build(templateButton) : [] });
  };
  const option = (id: string, title: string, sub: string) => (
    <label key={id} className={`pm-start${start === id ? " selected" : ""}`}>
      <input type="radio" name="ms-start" checked={start === id} onChange={() => setStart(id)} />
      <span><strong>{title}</strong><span className="muted small">{sub}</span></span>
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal pm-new" role="dialog" aria-modal="true" aria-labelledby="ms-new-title" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create(); }}>
        <h2 id="ms-new-title">New macro</h2>
        <label className="pm-field">
          <span className="muted small">Name</span>
          <input className="text-input" autoFocus value={name} maxLength={LIMITS.maxNameLength} placeholder="e.g. Quick reload" onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="pm-starts ms-starts">
          <legend className="muted small">Start from</legend>
          {option("empty", "An empty sequence", "Record it from your controller, or add actions by hand.")}
          {MACRO_TEMPLATES.map((t) => option(t.id, t.name, t.description))}
        </fieldset>
        {start !== "empty" && (
          <label className="pm-field">
            <span className="muted small">Template button</span>
            <ButtonSelect label="Template button" value={templateButton} onChange={(b) => b && setTemplateButton(b)} />
          </label>
        )}
        <label className="pm-field">
          <span className="muted small">Button that starts it (you can change this later)</span>
          <ButtonSelect label="Trigger button" value={button} noneLabel="Choose later" onChange={setButton} />
        </label>
        {taken && <div className="notice warn small">“{taken.name}” already starts from {BUTTONS[button!].name}. Pick another button, or switch that macro off first.</div>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim()}>Create</button>
        </div>
      </form>
    </div>
  );
}
