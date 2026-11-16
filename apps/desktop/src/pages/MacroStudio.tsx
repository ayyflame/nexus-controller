import { useCallback, useEffect, useRef, useState } from "react";
import { ButtonChip } from "../components/macro/ButtonChip";
import { ConfirmDialog, Switch } from "../components/macro/common";
import { CreateWizard } from "../components/macro/CreateWizard";
import { LiveTest } from "../components/macro/LiveTest";
import { MacroEditor } from "../components/macro/MacroEditor";
import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { engineApi, errorMessage } from "../lib/engine";
import { MODES, formatMs, totalDuration } from "../lib/macros";
import type { Macro } from "../types/engine";

type View = { kind: "list" } | { kind: "create" } | { kind: "edit"; id: string };

/** Export the macro library / import macros from a file (adds, never overwrites). */
function MacroTransfer({ onImported }: { onImported: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<{ json: string; names: string[]; renamed: string[] } | null>(null);
  return (
    <>
      <button className="btn-ghost" data-tip="Save all macros to a file in Documents\\NEXUS"
        onClick={async () => { try { const r = await engineApi.exportMacros(); setMsg(r.path ? `Saved to ${r.path}` : "Couldn't write the file."); } catch (e) { setMsg(errorMessage(e)); } }}>Export</button>
      <button className="btn-ghost" data-tip="Add macros from a NEXUS file" onClick={() => file.current?.click()}>Import</button>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        try {
          const json = await f.text();
          const p = await engineApi.previewImport(json, "add");
          setPending({ json, names: p.macros, renamed: p.renamed });
        } catch (err) { setMsg(errorMessage(err)); }
      }} />
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
      {pending && (
        <ConfirmDialog title={`Import ${pending.names.length} macro(s)?`} confirmLabel="Import"
          body={<><p>{pending.names.join(", ") || "No macros in this file."}</p>{pending.renamed.length > 0 && <p>Renamed: {pending.renamed.join(", ")}</p>}<p>Imported macros start switched off. Nothing you have is changed.</p></>}
          onCancel={() => setPending(null)}
          onConfirm={async () => { const p = pending; setPending(null); try { await engineApi.importConfig(p.json, "add"); onImported(); setMsg("Imported."); } catch (e) { setMsg(errorMessage(e)); } }} />
      )}
    </>
  );
}

export function MacroStudio() {
  const { connection, status, profile } = useEngine();
  const ready = connection.kind === "ready";
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ready) return;
    try { setMacros(await engineApi.listMacros()); setLoaded(true); }
    catch (e) { setError(errorMessage(e)); }
  }, [ready]);
  // Which macros are on depends on the active profile.
  useEffect(() => { void reload(); }, [reload, profile?.id]);

  const upsert = (m: Macro) => setMacros((list) =>
    list.some((x) => x.id === m.id) ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m]);

  if (!ready) {
    return (
      <div className="page">
        <header className="page-header"><div><h1>Macro Studio</h1></div></header>
        <div className="card"><p className="muted">Macro Studio is available in the NEXUS desktop app.</p></div>
      </div>
    );
  }

  if (view.kind === "create") {
    return (
      <CreateWizard others={macros}
        onDone={(m) => { upsert(m); setView({ kind: "edit", id: m.id }); }}
        onCancel={() => setView({ kind: "list" })} />
    );
  }
  if (view.kind === "edit") {
    const m = macros.find((x) => x.id === view.id);
    if (m) {
      return (
        <MacroEditor key={m.id} initial={m} others={macros.filter((x) => x.id !== m.id)} allMacros={macros}
          onSaved={upsert} onBack={() => { setView({ kind: "list" }); void reload(); }} />
      );
    }
  }

  return (
    <MacroList macros={macros} loaded={loaded} error={error}
      gamesCanReceive={status?.macros.gamesCanReceive ?? false}
      blockedReason={status?.macros.blockedReason ?? null}
      onCreate={() => setView({ kind: "create" })}
      onEdit={(id) => setView({ kind: "edit", id })}
      onChanged={(m) => upsert(m)}
      onReload={reload}
      setError={setError} />
  );
}

function MacroList({ macros, loaded, error, gamesCanReceive, blockedReason, onCreate, onEdit, onChanged, onReload, setError }: {
  macros: Macro[]; loaded: boolean; error: string | null; gamesCanReceive: boolean; blockedReason: string | null;
  onCreate: () => void; onEdit: (id: string) => void; onChanged: (m: Macro) => void;
  onReload: () => Promise<void>; setError: (e: string | null) => void;
}) {
  const device = usePrimaryDevice();
  const playing = device?.playingMacros ?? [];
  const [toDelete, setToDelete] = useState<Macro | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); }
    await onReload();
  };

  return (
    <div className="page macro-studio">
      <header className="page-header">
        <div>
          <h1>Macro Studio</h1>
          <p className="muted">Record or build button sequences and start them with a single button.</p>
        </div>
        <div className="row gap">
          {playing.length > 0 && (
            <button className="btn-danger" onClick={() => void engineApi.stopAllMacros()} data-tip="Stop every macro immediately">
              ■ Stop all macros
            </button>
          )}
          <MacroTransfer onImported={() => void onReload()} />
          <button className="btn-primary btn-create" onClick={onCreate}>
            <span aria-hidden="true">＋</span> Create Macro
          </button>
        </div>
      </header>

      {!gamesCanReceive && blockedReason && (
        <div className="notice warn macro-banner">
          <strong>Macros don't reach games yet.</strong> {blockedReason}
        </div>
      )}
      {!device && <div className="notice dev">Connect your controller by USB or Bluetooth to record and test macros.</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="studio-grid">
        <div className="macro-list">
          {loaded && macros.length === 0 && (
            <div className="card empty-state">
              <div className="empty-icon" aria-hidden="true">⌁</div>
              <h2>Create your first macro</h2>
              <p className="muted">A macro presses a sequence of buttons for you when you press one button.
                Record it from your controller in a few seconds.</p>
              <button className="btn-primary" onClick={onCreate}>＋ Create Macro</button>
            </div>
          )}
          {macros.map((m) => {
            const isPlaying = playing.includes(m.id);
            const warning = !m.enabled ? null
              : !m.trigger ? "Choose a button to start this macro"
                : m.steps.length === 0 ? "Add actions to the sequence" : null;
            return (
              <article key={m.id} className={`card macro-card${m.enabled ? "" : " disabled"}${isPlaying ? " playing" : ""}`}>
                <div className="macro-card-main" onClick={() => onEdit(m.id)} role="button" tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && onEdit(m.id)} aria-label={`Edit ${m.name}`}>
                  <div className="macro-trigger" data-tip={m.trigger ? "Button that starts this macro" : "No button assigned"}>
                    {m.trigger ? <ButtonChip button={m.trigger} size="lg" active={m.enabled} /> : <span className="chip chip-lg unassigned">?</span>}
                  </div>
                  <div className="macro-info">
                    <div className="row gap-sm">
                      <h3>{m.name}</h3>
                      {isPlaying && <span className="badge"><span className="play-dot" aria-hidden="true" /> Playing</span>}
                    </div>
                    {m.description && <p className="muted small">{m.description}</p>}
                    <p className="macro-meta small">
                      {MODES[m.mode].title} · {m.steps.length} action{m.steps.length === 1 ? "" : "s"} · {formatMs(totalDuration(m.steps))}
                    </p>
                    {warning && <p className="small warn-text">⚠ {warning}</p>}
                  </div>
                </div>
                <div className="macro-actions">
                  <Switch checked={m.enabled} label={m.enabled ? "On" : "Off"} tip={m.enabled ? "Turn off" : "Turn on"}
                    onChange={(enabled) => void act(async () => onChanged(await engineApi.setMacroEnabled(m.id, enabled)))} />
                  <div className="row gap-sm">
                    <button className="btn-ghost" onClick={() => onEdit(m.id)} data-tip="Edit this macro">Edit</button>
                    <button className="btn-ghost" onClick={() => void act(() => engineApi.duplicateMacro(m.id))}
                      data-tip="Make a copy (without a button assigned)">Duplicate</button>
                    <button className="btn-ghost danger" onClick={() => setToDelete(m)} data-tip="Delete this macro">Delete</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <LiveTest macros={macros} />
      </div>

      {toDelete && (
        <ConfirmDialog
          title={`Delete “${toDelete.name}”?`}
          body="This macro will be removed from all profiles. This can't be undone."
          confirmLabel="Delete macro" danger
          onCancel={() => setToDelete(null)}
          onConfirm={() => { const id = toDelete.id; setToDelete(null); void act(() => engineApi.deleteMacro(id)); }}
        />
      )}
    </div>
  );
}
