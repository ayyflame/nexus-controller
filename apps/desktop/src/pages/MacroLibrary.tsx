import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icons";
import { ButtonSelect } from "../components/controller/advanced";
import { ButtonChip } from "../components/macro/ButtonChip";
import { ConfirmDialog } from "../components/macro/common";
import { libraryView, openDraft, openEditor, openLibrary, takeFlash } from "../components/macro/studioNav";
import { useMacroLibrary } from "../components/macro/useMacroLibrary";
import { engineApi, errorIssues, errorMessage } from "../lib/engine";
import { BUTTONS, LIMITS, MODES, newMacro, validateMacro } from "../lib/macros";
import { MACRO_SORTS, organizeMacros, usageOf, type MacroSort } from "../lib/macroStudio";
import { MACRO_TEMPLATES } from "../lib/macroTemplates";
import { relativeTime } from "../lib/profileManager";
import type { Macro, MacroButton } from "../types/engine";

const SORT_KEY = "nexus.macroSort";
const loadSort = (): MacroSort => {
  try { const v = localStorage.getItem(SORT_KEY); return MACRO_SORTS.some((s) => s.id === v) ? (v as MacroSort) : "modified"; } catch { return "modified"; }
};
/** The window's scrolling area (the page content). */
const scroller = () => document.querySelector<HTMLElement>(".content");

/** Import macros from a file (adds, never overwrites) or export the whole library. */
function MacroTransfer({ onImported, setMsg }: { onImported: () => void; setMsg: (m: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ json: string; names: string[]; renamed: string[] } | null>(null);
  return (
    <>
      <button className="btn-ghost" data-tip="Add macros from a NEXUS file" onClick={() => file.current?.click()}><Icon name="upload" size={15} /> Import</button>
      <button className="btn-ghost" data-tip="Save every macro to one file in Documents\\NEXUS"
        onClick={async () => { try { const r = await engineApi.exportMacros(); setMsg(r.path ? `Saved to ${r.path}` : "Couldn't write the file."); } catch (e) { setMsg(errorMessage(e)); } }}><Icon name="download" size={15} /> Export all</button>
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

/**
 * The Macro Library: every saved macro, searchable and sorted, with pinned
 * macros first. Choosing one opens its editor page; nothing is edited here.
 * `create` opens the New macro dialog (from Mapping, with that button).
 */
export const MacroLibraryPage = memo(function MacroLibraryPage({ create, ready, profileId, blockedReason, hasDevice, playingKey }: {
  create: { trigger: MacroButton | null } | null;
  ready: boolean; profileId: number | null; blockedReason: string | null; hasDevice: boolean; playingKey: string;
}) {
  const { macros, meta, profiles, loaded, error, reload } = useMacroLibrary(ready, profileId);
  const [query, setQueryState] = useState(libraryView.query);
  const [sort, setSort] = useState<MacroSort>(loadSort);
  const [creating, setCreating] = useState<MacroButton | null | false>(() => (create ? create.trigger : false));
  const [flash] = useState(takeFlash);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The dialog was asked for by the address (from Mapping): show the plain
  // library address from now on, so Back from the new macro's editor returns
  // here rather than reopening the dialog.
  useEffect(() => { if (create) openLibrary(undefined, { quiet: true }); }, []);
  useEffect(() => { if (loaded) setNow(Date.now()); }, [loaded, macros]);
  // Back from an editor: the list where it was.
  useLayoutEffect(() => {
    if (loaded && libraryView.scrollTop) scroller()?.scrollTo(0, libraryView.scrollTop);
  }, [loaded]);

  const setQuery = (q: string) => { setQueryState(q); libraryView.query = q; };
  const chooseSort = (s: MacroSort) => { setSort(s); try { localStorage.setItem(SORT_KEY, s); } catch { /* display preference */ } };
  const { pinned, others } = useMemo(() => organizeMacros(macros, meta, query, sort), [macros, meta, query, sort]);
  const playing = useMemo(() => (playingKey ? playingKey.split("\n") : []), [playingKey]);
  const choose = (m: Macro) => { libraryView.scrollTop = scroller()?.scrollTop ?? 0; openEditor(m.id); };

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
        <button type="button" className={`pm-row ms-row${usage.activeNow ? " active" : ""}`} data-macro={m.id}
          onClick={() => choose(m)} aria-label={`Edit ${m.name}`}>
          <span className="pm-row-top">
            {m.trigger ? <ButtonChip button={m.trigger} size="sm" active={usage.activeNow} /> : <span className="chip chip-sm unassigned" title="No button">?</span>}
            <span className="pm-row-name">{isPinned && <span className="pm-pin"><Icon name="star" size={12} filled label="Pinned" /></span>}{m.name}</span>
            {isPlaying && <span className="play-dot" aria-label="Playing" />}
          </span>
          {m.description && <span className="ms-row-desc muted small">{m.description}</span>}
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

  return (
    <div className="page pm-page macro-studio ms-library">
      <header className="page-header">
        <div>
          <h1>Macro Studio</h1>
          <p className="muted">Record or build button sequences and start them from one button. Macros are shared by every profile; each profile chooses which are on. Choose a macro to edit it.</p>
        </div>
        {/* The primary action only; library-wide tools (import, export) sit with search and sort. */}
        <div className="page-actions">
          {playing.length > 0 && (
            <button className="btn-danger" onClick={() => void engineApi.stopAllMacros()} data-tip="Stop every macro immediately; nothing stays pressed"><Icon name="stop" size={13} filled /> Stop all</button>
          )}
          <button className="btn-primary" onClick={() => setCreating(null)}><Icon name="plus" size={15} /> New macro</button>
        </div>
      </header>

      {blockedReason && (
        <div className="notice warn macro-banner"><strong>Macros don't reach games yet.</strong> {blockedReason}</div>
      )}
      {!hasDevice && <div className="notice dev">Connect your controller by USB to record and test macros.</div>}
      {flash && <div className="notice dev ms-flash" role="status">{flash}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}

      <div className="pm-toolbar ms-library-tools">
        <input className="text-input pm-search" type="search" placeholder="Search macros…" title="Searches names, descriptions and trigger buttons" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search macros" />
        <label className="pm-sort">
          <span className="muted small">Sort</span>
          <select className="select" value={sort} onChange={(e) => chooseSort(e.target.value as MacroSort)} aria-label="Sort macros">
            {MACRO_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <div className="pm-toolbar-end">
          <MacroTransfer onImported={() => void reload()} setMsg={setMsg} />
        </div>
      </div>

      {!loaded && (
        <div className="ms-grid" role="status" aria-busy="true">
          <span className="sr-only">Loading macros…</span>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton-card" aria-hidden="true" />)}
        </div>
      )}

      <nav className="ms-library-list" aria-label="Macros">
        {pinned.length > 0 && <>
          <div className="pm-group">Pinned</div>
          <ul className="ms-grid">{pinned.map(row)}</ul>
        </>}
        {others.length > 0 && (
          <div className="pm-group">{pinned.length ? "All macros" : `${others.length} macro${others.length === 1 ? "" : "s"}`}</div>
        )}
        <ul className="ms-grid">{others.map(row)}</ul>
        {loaded && macros.length > 0 && pinned.length + others.length === 0 && <p className="muted small pm-empty">No macro matches “{query}”.</p>}
      </nav>
      {loaded && macros.length === 0 && (
        <div className="pm-detail ms-empty">
          <h2>Create your first macro</h2>
          <p className="muted">A macro presses a sequence of buttons for you when you press one button. Record it from your controller in a few seconds, or build it action by action.</p>
          <div><button className="btn-primary" onClick={() => setCreating(null)}><Icon name="plus" size={15} /> New macro</button></div>
        </div>
      )}

      {creating !== false && (
        <NewMacroDialog trigger={creating} macros={macros} onCancel={() => setCreating(false)} />
      )}
    </div>
  );
});

/**
 * Name, starting point and (optionally) the button for a new macro. A macro
 * from a template is saved at once and its editor opens; an empty one opens
 * in the editor and is saved once it has an action.
 */
function NewMacroDialog({ trigger, macros, onCancel }: {
  trigger: MacroButton | null;
  macros: Macro[];
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState<string>("empty");
  const [templateButton, setTemplateButton] = useState<MacroButton>("south");
  const [button, setButton] = useState<MacroButton | null>(trigger);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const taken = button ? macros.find((m) => m.trigger === button && m.enabled) : undefined;

  const create = async () => {
    const t = MACRO_TEMPLATES.find((x) => x.id === start);
    const m: Macro = { ...newMacro(), name: name.trim(), trigger: button, steps: t ? t.build(templateButton) : [] };
    // The same rules as saving; an empty sequence is fine here (it is filled in the editor).
    const issue = validateMacro(m, macros).find((i) => i.field !== "steps");
    if (issue) { setProblem(issue.message); return; }
    if (m.steps.length === 0) { openDraft(m); return; }
    setBusy(true); setProblem(null);
    try {
      const saved = await engineApi.saveMacro(m);
      openEditor(saved.id);
    } catch (e) {
      setProblem(errorIssues(e)[0]?.message ?? errorMessage(e));
      setBusy(false);
    }
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
        onSubmit={(e) => { e.preventDefault(); if (name.trim() && !busy) void create(); }}>
        <h2 id="ms-new-title">New macro</h2>
        <label className="pm-field">
          <span className="muted small">Name</span>
          <input className="text-input" autoFocus value={name} maxLength={LIMITS.maxNameLength} placeholder="e.g. Quick reload"
            onChange={(e) => { setName(e.target.value); setProblem(null); }} />
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
          <ButtonSelect label="Trigger button" value={button} noneLabel="Choose later" onChange={(b) => { setButton(b); setProblem(null); }} />
        </label>
        {taken && <div className="notice warn small">“{taken.name}” already starts from {BUTTONS[button!].name}. Pick another button, or switch that macro off first.</div>}
        {problem && <div className="notice error small" role="alert">{problem}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || busy}>{busy ? "Creating…" : "Create and edit"}</button>
        </div>
      </form>
    </div>
  );
}
