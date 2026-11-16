import { useEffect, useRef, useState } from "react";
import { engineApi, errorMessage } from "../../lib/engine";
import type { ExportResult, ImportMode, ImportPreview, ImportReport, Profile, ProfileTemplate } from "../../types/engine";
import { ConfirmDialog, Switch } from "../macro/common";

/** Game executables that switch to a profile. */
export function GamesEditor({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async (games: string[]) => {
    setError(null);
    try { onSaved(await engineApi.setProfileGames(profile.id, games)); setText(""); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <div className="games">
      <div className="row gap-sm wrap">
        {profile.games.map((g) => (
          <span key={g} className="game-chip">{g}
            <button aria-label={`Remove ${g}`} onClick={() => void save(profile.games.filter((x) => x !== g))}>✕</button>
          </span>
        ))}
        <form className="row gap-sm" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void save([...profile.games, text]); }}>
          <input className="text-input game-input" placeholder="Add game, e.g. eldenring.exe" value={text}
            onChange={(e) => setText(e.target.value)} aria-label="Game program name" />
          <button className="btn-ghost" disabled={!text.trim()}>Add</button>
        </form>
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

export function TemplatePicker({ onCreated }: { onCreated: (p: Profile) => void }) {
  const [templates, setTemplates] = useState<ProfileTemplate[]>([]);
  const [chosen, setChosen] = useState<ProfileTemplate | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { engineApi.listTemplates().then(setTemplates).catch(() => setTemplates([])); }, []);
  return (
    <div className="templates">
      <div className="template-grid">
        {templates.map((t) => (
          <button key={t.id} className={`template-card${chosen?.id === t.id ? " selected" : ""}`}
            onClick={() => { setChosen(t); setName(t.name); }}>
            <strong>{t.name}</strong><span className="muted small">{t.description}</span>
          </button>
        ))}
      </div>
      {chosen && (
        <form className="row gap" onSubmit={async (e) => {
          e.preventDefault(); setError(null);
          try { onCreated(await engineApi.createProfileFromTemplate(name, chosen.id)); setChosen(null); }
          catch (err) { setError(errorMessage(err)); }
        }}>
          <input className="text-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="New profile name" />
          <button className="btn-primary" disabled={!name.trim()}>Create “{chosen.name}” profile</button>
          <button type="button" className="btn-ghost" onClick={() => setChosen(null)}>Cancel</button>
        </form>
      )}
      {error && <p className="small err-text">{error}</p>}
    </div>
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
  };

  return (
    <section className="card panel">
      <h2>Backup and transfer</h2>
      <p className="muted small">Files are saved in your Documents\NEXUS folder. Importing adds to your setup and never overwrites anything; restoring a backup replaces everything (after NEXUS saves a safety copy).</p>
      <div className="row gap wrap">
        <button className="btn-secondary" onClick={async () => { try { setExported(await engineApi.exportConfig([], true)); } catch (e) { setError(errorMessage(e)); } }}>Export all profiles</button>
        <button className="btn-secondary" onClick={async () => { try { setExported(await engineApi.exportMacros()); } catch (e) { setError(errorMessage(e)); } }}>Export macros</button>
        <button className="btn-secondary" onClick={() => pick("add")}>Import file…</button>
        <span className="divider" />
        <button className="btn-secondary" onClick={async () => { try { setExported(await engineApi.createBackup()); } catch (e) { setError(errorMessage(e)); } }}>Create backup</button>
        <button className="btn-ghost danger" onClick={() => pick("replace")}>Restore backup…</button>
      </div>
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
