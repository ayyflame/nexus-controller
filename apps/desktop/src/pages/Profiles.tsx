import { useEffect, useState } from "react";
import { useEngine } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { outputLabel } from "../lib/format";
import type { Profile } from "../types/engine";

export function Profiles() {
  const { profile, setProfile, connection } = useEngine();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connection.kind !== "ready") return;
    engineApi.listProfiles().then(setProfiles).catch((e) => setError(errorMessage(e)));
  }, [connection.kind, profile]);

  const activate = async (id: number) => {
    try {
      setProfile(await engineApi.setActiveProfile(id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Profiles</h1>
          <p className="muted">Profiles are stored locally in SQLite. The last-used profile loads at start-up.</p>
        </div>
      </header>
      {error && <div className="notice error">{error}</div>}
      <div className="card">
        {connection.kind !== "ready" ? <p className="muted">Profiles are available in the desktop app.</p> : (
          <table className="table">
            <thead><tr><th>Name</th><th>Virtual output</th><th /></tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{outputLabel[p.virtualOutput]}</td>
                  <td className="right">
                    {profile?.id === p.id ? <span className="badge">Active</span> : (
                      <button className="btn-secondary" onClick={() => void activate(p.id)}>Use</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="notice dev">
        <strong>In development.</strong> Creating, renaming, duplicating, importing and exporting profiles,
        and per-game automatic switching, are planned for a later milestone.
      </div>
    </div>
  );
}
