import { useCallback, useEffect, useState } from "react";
import { useEngine } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import type { Profile } from "../types/engine";

/** The active profile, switchable from every page (and when a game switched it). */
export function ProfileSwitcher() {
  const { connection, profile, setProfile } = useEngine();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ready = connection.kind === "ready";
  const load = useCallback(() => {
    if (ready) engineApi.listProfiles().then(setProfiles, () => setProfiles([]));
  }, [ready]);
  // Reload when the active profile changes (created, renamed, switched by a game).
  useEffect(load, [load, profile?.id, profile?.name]);
  if (!ready || !profile) return null;
  const switchTo = async (id: number) => {
    setError(null);
    try { setProfile(await engineApi.setActiveProfile(id)); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <div className="profile-switcher">
      <label className="profile-switcher-label" htmlFor="active-profile">Active profile</label>
      <select id="active-profile" className="select" value={profile.id} onFocus={load}
        onChange={(e) => void switchTo(Number(e.target.value))}>
        {(profiles.some((p) => p.id === profile.id) ? profiles : [profile, ...profiles]).map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.games.length ? ` (${p.games.length} game${p.games.length === 1 ? "" : "s"})` : ""}</option>
        ))}
      </select>
      {error && <div className="small err-text">{error}</div>}
    </div>
  );
}
