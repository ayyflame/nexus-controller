import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../components/macro/common";
import { AutoSwitchToggle, GamesEditor, PortabilityPanel, TemplatePicker } from "../components/profiles/Portability";
import { useEngine } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { outputLabel } from "../lib/format";
import { withDefaults } from "../lib/processing";
import type { Profile } from "../types/engine";

function summary(raw: Profile): string {
  const p = { ...raw, processing: withDefaults(raw.processing) };
  const parts = [outputLabel[p.virtualOutput] + " output"];
  if (p.processing.remap.length) parts.push(`${p.processing.remap.length} remapped button${p.processing.remap.length === 1 ? "" : "s"}`);
  const curve = p.processing.rightStick.curve.type !== "linear" || p.processing.leftStick.curve.type !== "linear";
  if (curve) parts.push("custom stick curves");
  if (p.processing.layers.length) parts.push(`${p.processing.layers.length} layer${p.processing.layers.length === 1 ? "" : "s"}`);
  if (p.processing.gyro.enabled) parts.push("gyro");
  return parts.join(" · ");
}

export function Profiles() {
  const { profile: active, setProfile, connection } = useEngine();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [toDelete, setToDelete] = useState<Profile | null>(null);
  /** The profile NEXUS starts with (null: whichever was used last). */
  const [defaultId, setDefaultId] = useState<number | null>(null);
  const ready = connection.kind === "ready";

  const reload = useCallback(async () => {
    if (!ready) return;
    try {
      setProfiles(await engineApi.listProfiles());
      setDefaultId(await engineApi.getDefaultProfile());
    } catch (e) { setError(errorMessage(e)); }
  }, [ready]);
  useEffect(() => { void reload(); }, [reload, active]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); }
    await reload();
  };

  if (!ready) {
    return (
      <div className="page">
        <header className="page-header"><div><h1>Profiles</h1></div></header>
        <div className="card"><p className="muted">Profiles are available in the desktop app.</p></div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Profiles</h1>
          <p className="muted">A profile keeps your stick and trigger settings, button remapping, which macros are on, and the virtual controller type. The last profile you used loads when NEXUS starts.</p>
        </div>
      </header>

      <div className="card panel">
        <div className="card-title-row"><h2>Games</h2><AutoSwitchToggle /></div>
        <p className="muted small">Link a game to a profile below: start the game once, then pick it from the recently used programs, or type its program name (for example eldenring.exe). When that game is in front, NEXUS switches to the profile, and switches back when you leave the game. NEXUS only looks at which program is in front; it never reads or changes game memory.</p>
      </div>

      <section className="card panel">
        <h2>Start from a template</h2>
        <TemplatePicker onCreated={() => void reload()} />
      </section>

      <form className="card new-profile" onSubmit={(e) => {
        e.preventDefault();
        const name = newName;
        void run(async () => { await engineApi.createProfile(name); setNewName(""); });
      }}>
        <input className="text-input" placeholder="New profile name, e.g. Racing" value={newName} maxLength={40}
          onChange={(e) => setNewName(e.target.value)} aria-label="New profile name" />
        <button className="btn-primary" disabled={!newName.trim()}>＋ Create profile</button>
      </form>

      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice dev" role="status">{notice} <button className="btn-ghost" onClick={() => setNotice(null)}>OK</button></div>}

      <div className="profile-list">
        {profiles.map((p) => {
          const isActive = active?.id === p.id;
          return (
            <article key={p.id} className={`card profile-card${isActive ? " active" : ""}`}>
              <div className="profile-main">
                {renaming?.id === p.id ? (
                  <form className="row gap-sm" onSubmit={(e) => {
                    e.preventDefault();
                    const { id, name } = renaming;
                    void run(async () => {
                      const r = await engineApi.renameProfile(id, name);
                      if (isActive) setProfile(r);
                      setRenaming(null);
                    });
                  }}>
                    <input className="text-input" autoFocus value={renaming.name} maxLength={40} aria-label="Profile name"
                      onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
                    <button className="btn-primary">Save</button>
                    <button type="button" className="btn-ghost" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                ) : (
                  <div className="row gap-sm">
                    <h3>{p.name}</h3>
                    {isActive && <span className="badge">Active</span>}
                    {defaultId === p.id && <span className="badge default" data-tip="NEXUS starts with this profile">Default</span>}
                  </div>
                )}
                <p className="muted small">{summary(p)}</p>
                <GamesEditor profile={p} onSaved={(np) => { if (isActive) setProfile(np); void reload(); }} />
              </div>
              <div className="row gap-sm">
                {!isActive && (
                  <button className="btn-primary" data-tip="Switch to this profile now"
                    onClick={() => void run(async () => setProfile(await engineApi.setActiveProfile(p.id)))}>Use</button>
                )}
                <button className="btn-ghost" onClick={() => setRenaming({ id: p.id, name: p.name })}>Rename</button>
                <button className="btn-ghost" title={defaultId === p.id ? "NEXUS will start with whichever profile was used last" : "NEXUS starts with this profile"}
                  onClick={() => void run(async () => setDefaultId(await engineApi.setDefaultProfile(defaultId === p.id ? null : p.id)))}>
                  {defaultId === p.id ? "Remove default" : "Make default"}
                </button>
                <button className="btn-ghost" data-tip="Save this profile to a file you can share"
                  onClick={() => void run(async () => { const r = await engineApi.exportConfig([p.id], false); setNotice(r.path ? `“${p.name}” saved to ${r.path}` : "Couldn't write the file."); })}>Export</button>
                <button className="btn-ghost" data-tip="Copy all settings and macro choices"
                  onClick={() => void run(async () => { await engineApi.duplicateProfile(p.id); })}>Duplicate</button>
                <button className="btn-ghost danger" disabled={profiles.length <= 1}
                  data-tip={profiles.length <= 1 ? "You need at least one profile" : "Delete this profile"}
                  onClick={() => setToDelete(p)}>Delete</button>
              </div>
            </article>
          );
        })}
      </div>

      <PortabilityPanel onChanged={() => { void reload(); void engineApi.getActiveProfile().then(setProfile); }} />

      {toDelete && (
        <ConfirmDialog title={`Delete “${toDelete.name}”?`}
          body={<>Its settings and macro choices will be removed. Your macros themselves stay in Macro Studio.{active?.id === toDelete.id && " NEXUS will switch to another profile."}</>}
          confirmLabel="Delete profile" danger onCancel={() => setToDelete(null)}
          onConfirm={() => { const id = toDelete.id; setToDelete(null); void run(async () => setProfile(await engineApi.deleteProfile(id))); }} />
      )}
    </div>
  );
}
