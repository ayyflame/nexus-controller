import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../components/macro/common";
import { useEngine } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { outputLabel } from "../lib/format";
import type { Profile } from "../types/engine";

function summary(p: Profile): string {
  const parts = [outputLabel[p.virtualOutput] + " output"];
  if (p.processing.remap.length) parts.push(`${p.processing.remap.length} remapped button${p.processing.remap.length === 1 ? "" : "s"}`);
  const curve = p.processing.rightStick.curve.type !== "linear" || p.processing.leftStick.curve.type !== "linear";
  if (curve) parts.push("custom stick curves");
  return parts.join(" · ");
}

export function Profiles() {
  const { profile: active, setProfile, connection } = useEngine();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [toDelete, setToDelete] = useState<Profile | null>(null);
  const ready = connection.kind === "ready";

  const reload = useCallback(async () => {
    if (!ready) return;
    try { setProfiles(await engineApi.listProfiles()); } catch (e) { setError(errorMessage(e)); }
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
                  </div>
                )}
                <p className="muted small">{summary(p)}</p>
              </div>
              <div className="row gap-sm">
                {!isActive && (
                  <button className="btn-primary" data-tip="Switch to this profile now"
                    onClick={() => void run(async () => setProfile(await engineApi.setActiveProfile(p.id)))}>Use</button>
                )}
                <button className="btn-ghost" onClick={() => setRenaming({ id: p.id, name: p.name })}>Rename</button>
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

      {toDelete && (
        <ConfirmDialog title={`Delete “${toDelete.name}”?`}
          body={<>Its settings and macro choices will be removed. Your macros themselves stay in Macro Studio.{active?.id === toDelete.id && " NEXUS will switch to another profile."}</>}
          confirmLabel="Delete profile" danger onCancel={() => setToDelete(null)}
          onConfirm={() => { const id = toDelete.id; setToDelete(null); void run(async () => setProfile(await engineApi.deleteProfile(id))); }} />
      )}
    </div>
  );
}
