import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icons";
import { engineApi, errorMessage } from "../../lib/engine";
import { pickable } from "../../lib/games";
import { restoreLabel, visiblePoints } from "../../lib/restorePoints";
import type { ExportResult, ImportMode, ImportPreview, ImportReport, Profile, RestorePoint } from "../../types/engine";
import { ConfirmDialog, Switch } from "../macro/common";

/** Game executables that switch to a profile. */
export function GamesEditor({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const save = async (games: string[]) => {
    setError(null);
    try { onSaved(await engineApi.setProfileGames(profile.id, games)); setText(""); } catch (e) { setError(errorMessage(e)); }
  };
  const refresh = () => { engineApi.recentPrograms().then(setRecent, () => setRecent([])); };
  useEffect(refresh, []);
  const offered = pickable(recent, profile.games);
  return (
    <div className="games">
      <div className="row gap-sm wrap">
        {profile.games.map((g) => (
          <span key={g} className="game-chip">{g}
            <button aria-label={`Remove ${g}`} onClick={() => void save(profile.games.filter((x) => x !== g))}><Icon name="x" size={12} /></button>
          </span>
        ))}
        <form className="row gap-sm" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void save([...profile.games, text]); }}>
          <input className="text-input game-input" placeholder="Add game, e.g. eldenring.exe" value={text}
            onChange={(e) => setText(e.target.value)} aria-label="Game program name" />
          <button className="btn-ghost" disabled={!text.trim()}>Add</button>
        </form>
        <select className="select" aria-label="Add a recently used program" value=""
          onFocus={refresh} onChange={(e) => { if (e.target.value) void save([...profile.games, e.target.value]); }}>
          <option value="">{offered.length ? "Pick a recently used program…" : "Start the game once, then pick it here"}</option>
          {offered.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {error && <p className="small err-text">{error}</p>}
    </div>
  );
}

export function AutoSwitchToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { engineApi.getAutoSwitch().then(setOn).catch(() => setOn(null)); }, []);
  if (on === null) return null;
  return (
    <Switch checked={on} label={on ? "Switch profiles automatically for games" : "Automatic switching off"}
      tip="When a game listed on a profile is in front, NEXUS switches to that profile and switches back when you leave the game"
      onChange={async (v) => { await engineApi.setAutoSwitch(v); setOn(v); }} />
  );
}

function ExportNotice({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  return (
    <div className="notice dev">
      {result.path ? <>Saved to <code className="mono break">{result.path}</code></> : "Couldn't write a file. Copy the text instead."}
      <div className="row gap-sm" style={{ marginTop: 8 }}>
        <button className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(result.json)}>Copy to clipboard</button>
        <button className="btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** Export, import, backup and restore. */
export function PortabilityPanel({ onChanged }: { onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>("add");
  const [pending, setPending] = useState<{ json: string; preview: ImportPreview; mode: ImportMode } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (m: ImportMode) => { setMode(m); setError(null); setReport(null); fileRef.current?.click(); };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("That file is larger than 5 MB, so it isn't a NEXUS configuration."); return; }
    const json = await file.text();
    try { setPending({ json, preview: await engineApi.previewImport(json, mode), mode }); }
    catch (e) { setError(errorMessage(e)); }
    if (fileRef.current) fileRef.current.value = "";
  };
  const confirm = async () => {
    if (!pending) return;
    const p = pending; setPending(null);
    try { setReport(await engineApi.importConfig(p.json, p.mode)); onChanged(); } catch (e) { setError(errorMessage(e)); }
    loadPoints();
  };
  const [points, setPoints] = useState<RestorePoint[]>([]);
  const [showAll, setShowAll] = useState(false);
  const loadPoints = () => { engineApi.listRestorePoints().then(setPoints, () => setPoints([])); };
  useEffect(loadPoints, []);
  const restoreFrom = async (point: RestorePoint) => {
    setError(null); setReport(null);
    try {
      const json = await engineApi.readRestorePoint(point.id);
      setPending({ json, preview: await engineApi.previewImport(json, "replace"), mode: "replace" });
    } catch (e) { setError(errorMessage(e)); }
  };
  const { shown, more } = visiblePoints(points, showAll ? points.length : 5);

  return (
    <section className="card panel">
      <h2>Backup and transfer</h2>
      <p className="muted small">Files are saved in your Documents\NEXUS folder. Importing adds to your setup and never overwrites anything; restoring a backup replaces everything (after NEXUS saves a safety copy).</p>
      <div className="row gap wrap">
        <button className="btn-secondary" onClick={async () => { try { setExported(await engineApi.exportConfig([], true)); } catch (e) { setError(errorMessage(e)); } }}><Icon name="download" size={15} /> Export all profiles</button>
        <button className="btn-secondary" onClick={async () => { try { setExported(await engineApi.exportMacros()); } catch (e) { setError(errorMessage(e)); } }}><Icon name="download" size={15} /> Export macros</button>
        <button className="btn-secondary" onClick={() => pick("add")}><Icon name="upload" size={15} /> Import file…</button>
        <span className="divider" />
        <button className="btn-secondary" onClick={async () => { try { setExported(await engineApi.createBackup()); } catch (e) { setError(errorMessage(e)); } }}><Icon name="shield" size={15} /> Create backup</button>
        <button className="btn-ghost danger" onClick={() => pick("replace")}>Restore backup…</button>
      </div>
      <h3 className="restore-head">Restore points</h3>
      <p className="muted small">NEXUS keeps a backup every day (the last 14 days), before every restore and before every update. Restoring one replaces your current profiles and macros, after saving a safety copy of them.</p>
      {points.length === 0 ? <p className="small muted">No restore points yet.</p> : (
        <ul className="restore-list">
          {shown.map((p) => (
            <li key={p.id} className="restore-item">
              <span><b>{restoreLabel(p)}</b> <span className="muted small">{new Date(p.modifiedMs).toLocaleString()}</span></span>
              <button className="btn-ghost" onClick={() => void restoreFrom(p)}>Restore…</button>
            </li>
          ))}
          {more > 0 && <li><button className="btn-ghost" onClick={() => setShowAll(true)}>Show {more} more</button></li>}
        </ul>
      )}
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {exported && <ExportNotice result={exported} onClose={() => setExported(null)} />}
      {error && <div className="notice error">{error}</div>}
      {report && (
        <div className="notice dev">
          Imported {report.profilesAdded} profile{report.profilesAdded === 1 ? "" : "s"} and {report.macrosAdded} macro{report.macrosAdded === 1 ? "" : "s"}.
          {report.renamed.length > 0 && <> Renamed to avoid clashes: {report.renamed.join(", ")}.</>}
          {report.disabledForConflicts.length > 0 && <> Left switched off because their button was already used: {report.disabledForConflicts.join(", ")}.</>}
        </div>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.mode === "replace" ? "Replace your whole configuration?" : "Import this file?"}
          danger={pending.mode === "replace"}
          confirmLabel={pending.mode === "replace" ? "Replace everything" : "Import"}
          onCancel={() => setPending(null)} onConfirm={() => void confirm()}
          body={<>
            <p>{pending.preview.profiles.length} profile(s){pending.preview.profiles.length ? `: ${pending.preview.profiles.join(", ")}` : ""}</p>
            <p>{pending.preview.macros.length} macro(s){pending.preview.macros.length ? `: ${pending.preview.macros.slice(0, 8).join(", ")}${pending.preview.macros.length > 8 ? "…" : ""}` : ""}</p>
            {pending.preview.renamed.length > 0 && <p>Will be renamed: {pending.preview.renamed.join(", ")}</p>}
            {pending.mode === "replace"
              ? <p><strong>All current profiles and macros will be replaced.</strong> A safety backup is saved automatically first.</p>
              : <p>Nothing you already have will be changed.</p>}
          </>} />
      )}
    </section>
  );
}
