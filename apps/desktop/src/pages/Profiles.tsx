import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog, Switch } from "../components/macro/common";
import { AutoSwitchToggle, GamesEditor, PortabilityPanel } from "../components/profiles/Portability";
import { useEngine } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { outputLabel } from "../lib/format";
import {
  EMPTY_META, SORTS, compatibility, copyName, lastUsed, organize, relativeTime, summary,
  type ProfileMeta, type SortKey,
} from "../lib/profileManager";
import type { Profile, ProfileTemplate } from "../types/engine";

const SORT_KEY = "nexus.profileSort.v1";
const go = (page: string) => window.dispatchEvent(new CustomEvent("nexus:navigate", { detail: { page } }));

/**
 * Profile Manager: every profile in one list with its game, when it was
 * last used and changed, and whether it is active; the selected profile's
 * actions and details beside it. Uses the existing profile store; nothing
 * here changes how a profile is applied.
 */
export function Profiles() {
  const { profile: active, setProfile, connection } = useEngine();
  const ready = connection.kind === "ready";
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [meta, setMeta] = useState<ProfileMeta>(EMPTY_META);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(() => {
    try { const v = localStorage.getItem(SORT_KEY); return SORTS.some((s) => s.id === v) ? (v as SortKey) : "recent"; } catch { return "recent"; }
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    if (!ready) return;
    try {
      const [list, m] = await Promise.all([engineApi.listProfiles(), engineApi.getProfileMeta()]);
      setProfiles(list);
      setMeta(m);
      setNow(Date.now());
    } catch (e) { setError(errorMessage(e)); }
  }, [ready]);
  // Reload whenever the active profile changes (here, from the sidebar, or a game).
  useEffect(() => { void reload(); }, [reload, active?.id, active?.updatedAtMs]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); }
    await reload();
  };
  const chooseSort = (s: SortKey) => { setSort(s); try { localStorage.setItem(SORT_KEY, s); } catch { /* display preference */ } };

  const { pinned, others } = useMemo(() => organize(profiles, meta, query, sort), [profiles, meta, query, sort]);
  const selected = profiles.find((p) => p.id === (selectedId ?? active?.id)) ?? profiles[0] ?? null;

  if (!ready) {
    return (
      <div className="page">
        <header className="page-header"><div><h1>Profiles</h1></div></header>
        <div className="card"><p className="muted">Profiles are available in the desktop app.</p></div>
      </div>
    );
  }

  const row = (p: Profile) => {
    const isActive = active?.id === p.id;
    const isPinned = meta.pinned.includes(p.id);
    const compat = compatibility(p);
    return (
      <li key={p.id}>
        <button type="button" className={`pm-row${selected?.id === p.id ? " selected" : ""}${isActive ? " active" : ""}`}
          aria-current={selected?.id === p.id ? "true" : undefined} onClick={() => setSelectedId(p.id)}
          data-profile={p.id}>
          <span className="pm-row-top">
            <span className="pm-row-name">{isPinned && <span className="pm-pin" aria-label="Pinned">★</span>}{p.name}</span>
            {isActive && <span className="badge pm-active">Active</span>}
            {meta.startup === p.id && <span className="badge tone-neutral">Start-up</span>}
          </span>
          <span className="pm-row-sub">
            <span className={p.games.length ? "pm-game" : "muted"}>{p.games.length ? p.games.join(", ") : "No game linked"}</span>
            <span className="muted">· used {relativeTime(lastUsed(meta, p.id), now)}</span>
            {compat.dualShock4.length > 0 && <span className="pm-note" title={`On a DualShock 4: ${compat.dualShock4.join("; ")}`}>DualSense features</span>}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="page pm-page">
      <header className="page-header">
        <div>
          <h1>Profiles</h1>
          <p className="muted">A profile holds your mapping, stick and trigger settings, which macros are on, and the virtual controller type. Link a game and NEXUS switches to its profile while the game is in front.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>＋ New profile</button>
      </header>

      <div className="pm-toolbar">
        <input className="text-input pm-search" type="search" placeholder="Search profiles or games…" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search profiles" />
        <label className="pm-sort">
          <span className="muted small">Sort</span>
          <select className="select" value={sort} onChange={(e) => chooseSort(e.target.value as SortKey)} aria-label="Sort profiles">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <div className="pm-auto"><AutoSwitchToggle /></div>
      </div>

      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <div className="notice dev" role="status">{notice} <button className="btn-ghost" onClick={() => setNotice(null)}>OK</button></div>}

      <div className="pm-workspace">
        <nav className="pm-list" aria-label="Profiles">
          {pinned.length > 0 && <>
            <div className="pm-group">Pinned</div>
            <ul>{pinned.map(row)}</ul>
          </>}
          <div className="pm-group">{pinned.length ? "All profiles" : `${others.length} profile${others.length === 1 ? "" : "s"}`}</div>
          <ul>{others.map(row)}</ul>
          {pinned.length + others.length === 0 && <p className="muted small pm-empty">No profile matches “{query}”.</p>}
        </nav>

        {selected && (
          <ProfileDetail key={selected.id} profile={selected} profiles={profiles} meta={meta} now={now}
            isActive={active?.id === selected.id}
            run={run} setNotice={setNotice}
            onActivated={(p) => setProfile(p)}
            onDeleted={(nowActive) => { setProfile(nowActive); setSelectedId(nowActive.id); }}
            onDuplicated={(p) => setSelectedId(p.id)} />
        )}
      </div>

      <PortabilityPanel onChanged={() => { void reload(); void engineApi.getActiveProfile().then(setProfile); }} />

      {creating && active && (
        <NewProfileDialog profiles={profiles} current={active} onCancel={() => setCreating(false)}
          onCreated={(p) => { setCreating(false); setSelectedId(p.id); setNotice(`Created “${p.name}”. Click “Use now” to switch to it.`); void reload(); }} />
      )}
    </div>
  );
}

function ProfileDetail({ profile: p, profiles, meta, now, isActive, run, setNotice, onActivated, onDeleted, onDuplicated }: {
  profile: Profile; profiles: Profile[]; meta: ProfileMeta; now: number; isActive: boolean;
  run: (fn: () => Promise<void>) => Promise<void>; setNotice: (s: string | null) => void;
  onActivated: (p: Profile) => void; onDeleted: (active: Profile) => void; onDuplicated: (p: Profile) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isPinned = meta.pinned.includes(p.id);
  const isProtected = meta.protected === p.id;
  const isStartup = meta.startup === p.id;
  const compat = compatibility(p);
  const only = profiles.length <= 1;
  const deleteBlock = only ? "You need at least one profile." : isProtected
    ? isStartup ? "NEXUS starts with this profile. Turn off “Start NEXUS with this profile” first." : "NEXUS falls back to this profile (your first one). Choose a start-up profile first."
    : null;

  return (
    <section className={`pm-detail${isActive ? " active" : ""}`} aria-label={`Profile ${p.name}`}>
      <header className="pm-detail-head">
        {renaming !== null ? (
          <form className="row gap-sm pm-rename" onSubmit={(e) => {
            e.preventDefault();
            const name = renaming;
            void run(async () => { const r = await engineApi.renameProfile(p.id, name); if (isActive) onActivated(r); setRenaming(null); });
          }}>
            <input className="text-input" autoFocus value={renaming} maxLength={40} aria-label="Profile name"
              onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
            <button className="btn-primary" disabled={!renaming.trim()}>Save</button>
            <button type="button" className="btn-ghost" onClick={() => setRenaming(null)}>Cancel</button>
          </form>
        ) : (
          <div className="pm-title">
            <h2>{p.name}</h2>
            {isActive ? <span className="badge pm-active">Active</span> : null}
            {isProtected && <span className="badge tone-neutral" title="Can't be deleted">Protected</span>}
          </div>
        )}
        <button type="button" className={`pm-pin-btn${isPinned ? " on" : ""}`} aria-pressed={isPinned}
          title={isPinned ? "Unpin" : "Pin to the top of the list"}
          onClick={() => void run(async () => { await engineApi.setProfilePinned(p.id, !isPinned); })}>
          {isPinned ? "★ Pinned" : "☆ Pin"}
        </button>
      </header>

      <div className="pm-actions">
        {isActive
          ? <span className="pm-in-use">✓ In use now</span>
          : <button className="btn-primary" onClick={() => void run(async () => onActivated(await engineApi.setActiveProfile(p.id)))}>Use now</button>}
        <button className="btn-ghost" onClick={() => setRenaming(p.name)}>Rename</button>
        <button className="btn-ghost" title="A full copy: settings, macros that are on, virtual controller type"
          onClick={() => void run(async () => { const c = await engineApi.createProfile(copyName(p.name, profiles.map((x) => x.name)), p.id); onDuplicated(c); setNotice(`Duplicated as “${c.name}”.`); })}>Duplicate</button>
        <button className="btn-ghost" title="Save this profile (and the macros it uses) to a file"
          onClick={() => void run(async () => { const r = await engineApi.exportConfig([p.id], false); setNotice(r.path ? `“${p.name}” exported to ${r.path}` : "Couldn't write the file."); })}>Export</button>
        <button className="btn-ghost danger" disabled={deleteBlock !== null} title={deleteBlock ?? "Delete this profile"}
          onClick={() => setConfirmDelete(true)}>Delete</button>
      </div>
      {deleteBlock && !only && <p className="muted small">{deleteBlock}</p>}

      <dl className="pm-facts">
        <dt>Game</dt>
        <dd>
          <GamesEditor profile={p} onSaved={(np) => { if (isActive) onActivated(np); void run(async () => {}); }} />
          <p className="muted small">NEXUS switches to this profile while one of these programs is in front, and back when you leave it. Only the program's file name counts, so moving the game to another folder keeps the link.</p>
        </dd>
        <dt>Changes</dt>
        <dd>
          <span>{summary(p).join(" · ")} <span className="muted">· {outputLabel[p.virtualOutput]} output</span></span>
          {isActive
            ? <div className="pm-edit-links">Edit: <button className="map-link" onClick={() => go("mapping")}>Mapping</button> · <button className="map-link" onClick={() => go("sticks")}>Sticks</button> · <button className="map-link" onClick={() => go("triggers")}>Triggers</button> · <button className="map-link" onClick={() => go("macro-studio")}>Macros</button></div>
            : <div className="muted small">Settings pages edit the active profile: click “Use now” to edit this one.</div>}
        </dd>
        <dt>Controllers</dt>
        <dd>
          <span className="pm-compat ok">DualSense ✓</span>
          <span className={`pm-compat${compat.dualShock4.length ? " partial" : " ok"}`}>
            DualShock 4 {compat.dualShock4.length ? "· partly" : "✓"}
          </span>
          {compat.dualShock4.length > 0 && <div className="muted small">On a DualShock 4: {compat.dualShock4.join("; ")}.</div>}
          {compat.general.map((g) => <div key={g} className="warn-text small">Note: {g}.</div>)}
        </dd>
        <dt>Start-up</dt>
        <dd>
          <Switch checked={isStartup} label="Start NEXUS with this profile"
            tip="Otherwise NEXUS starts with whichever profile was used last"
            onChange={(on) => void run(async () => { await engineApi.setDefaultProfile(on ? p.id : null); })} />
        </dd>
        <dt>History</dt>
        <dd className="muted small">
          Last used {relativeTime(lastUsed(meta, p.id), now)} · changed {relativeTime(p.updatedAtMs, now)} · created {new Date(p.createdAtMs).toLocaleDateString()}
        </dd>
      </dl>

      {confirmDelete && (
        <ConfirmDialog title={`Delete “${p.name}”?`} danger confirmLabel="Delete profile"
          body={<>
            Its settings, linked games and macro choices are removed. Your macros stay in Macro Studio and other profiles are not changed.
            {isActive && " NEXUS switches to your protected profile."}
            {" "}A copy of every profile is kept in the daily restore point.
          </>}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); void run(async () => onDeleted(await engineApi.deleteProfile(p.id))); }} />
      )}
    </section>
  );
}

type Start = "blank" | "current" | "other" | "template";

function NewProfileDialog({ profiles, current, onCancel, onCreated }: {
  profiles: Profile[]; current: Profile; onCancel: () => void; onCreated: (p: Profile) => void;
}) {
  const [start, setStart] = useState<Start>("blank");
  const [name, setName] = useState("");
  const [other, setOther] = useState<number>(profiles.find((p) => p.id !== current.id)?.id ?? current.id);
  const [templates, setTemplates] = useState<ProfileTemplate[]>([]);
  const [template, setTemplate] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { engineApi.listTemplates().then((t) => { setTemplates(t); setTemplate(t[0]?.id ?? ""); }, () => setTemplates([])); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const n = name.trim();
      const p = start === "blank" ? await engineApi.createProfile(n)
        : start === "current" ? await engineApi.createProfile(n, current.id)
          : start === "other" ? await engineApi.createProfile(n, other)
            : await engineApi.createProfileFromTemplate(n, template);
      onCreated(p);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  const option = (id: Start, title: string, sub: string, extra?: React.ReactNode) => (
    <label className={`pm-start${start === id ? " selected" : ""}`}>
      <input type="radio" name="pm-start" checked={start === id} onChange={() => setStart(id)} />
      <span><strong>{title}</strong><span className="muted small">{sub}</span>{start === id && extra}</span>
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal pm-new" role="dialog" aria-modal="true" aria-labelledby="pm-new-title" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
        <h2 id="pm-new-title">New profile</h2>
        <label className="pm-field">
          <span className="muted small">Name</span>
          <input className="text-input" autoFocus value={name} maxLength={40} placeholder="e.g. Warzone ranked" onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="pm-starts">
          <legend className="muted small">Start from</legend>
          {option("blank", "Default settings", "A plain controller: nothing remapped, no macros on.")}
          {option("current", `A copy of “${current.name}”`, "The profile in use now: all its settings and macro choices.")}
          {profiles.length > 1 && option("other", "A copy of another profile", "All its settings and macro choices (not its games).",
            <select className="select" value={other} onChange={(e) => setOther(Number(e.target.value))} aria-label="Profile to copy">
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>)}
          {templates.length > 0 && option("template", "A template", "Ready-made settings for a kind of game.",
            <select className="select" value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Template">
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}: {t.description}</option>)}
            </select>)}
        </fieldset>
        {error && <div className="notice error small">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || busy}>{busy ? "Creating…" : "Create profile"}</button>
        </div>
      </form>
    </div>
  );
}
