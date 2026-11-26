import { memo, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/macro/common";
import { MacroEditor } from "../components/macro/MacroEditor";
import { clearDraft, draftSavedAs, openEditor, openLibrary, peekDraft, takeFlash } from "../components/macro/studioNav";
import { useMacroLibrary } from "../components/macro/useMacroLibrary";
import { engineApi } from "../lib/engine";
import { discardMacroEditor, flushMacroEditor } from "../lib/macroSaves";
import { BUTTONS } from "../lib/macros";
import type { Macro } from "../types/engine";

export const MISSING_MACRO = "That macro doesn't exist any more (it may have been deleted), so the library is shown instead.";
export const LOST_DRAFT = "The new macro wasn't saved (it had no actions yet), so it is gone. Create it again with ＋ New macro.";

/**
 * One macro's editing page: the editor and its Test panel, full width, with a
 * way back to the library. Opened from the library, Mapping or the address
 * ("edit:<id>"); a new macro that isn't saved yet opens as "draft" and gets its
 * own address once saved. A macro that no longer exists returns to the library.
 */
export const MacroEditorPage = memo(function MacroEditorPage({ target, ready, profileId, blockedReason }: {
  /** The macro's id, or null for the new, unsaved macro. Read once: the page is reopened for another macro. */
  target: string | null;
  ready: boolean; profileId: number | null; blockedReason: string | null;
}) {
  const lib = useMacroLibrary(ready, profileId);
  const { macros, meta, setMeta, profiles, loaded, error, run, upsert } = lib;
  // Which macro this page edits: fixed when it opens (a draft gets its id on
  // first save). Chosen once the library has loaded, which waits for saves
  // still under way, so a draft saved after its editor closed isn't reopened.
  const [initial, setInitial] = useState<Macro | null>(null);
  const [flash] = useState(takeFlash);
  const [msg, setMsg] = useState<string | null>(flash);
  const [toDelete, setToDelete] = useState<Macro | null>(null);
  const [editedId, setEditedId] = useState(target ?? "");

  useEffect(() => {
    if (!loaded || initial) return;
    if (target === null) {
      const d = peekDraft();
      if (d) { setInitial(d); return; }
      const savedAs = draftSavedAs();
      if (savedAs) openEditor(savedAs, { replace: true });
      else openLibrary(LOST_DRAFT, { replace: true });
      return;
    }
    const m = macros.find((x) => x.id === target);
    if (m) setInitial(m);
    else openLibrary(MISSING_MACRO, { replace: true });
  }, [loaded]);

  const others = useMemo(() => macros.filter((x) => x.id !== editedId), [macros, editedId]);

  if (!ready) {
    return (
      <div className="page">
        <header className="page-header"><div><h1>Macro Studio</h1></div></header>
        <div className="card"><p className="muted">Macro Studio is available in the NEXUS desktop app.</p></div>
      </div>
    );
  }

  return (
    <div className="page macro-studio ms-editor-page">
      <div className="ms-editor-nav">
        <button type="button" className="ms-back" onClick={() => openLibrary()}>← Macro Library</button>
      </div>

      {blockedReason && (
        <div className="notice warn macro-banner"><strong>Macros don't reach games yet.</strong> {blockedReason}</div>
      )}
      {error && <div className="notice error" role="alert">{error}</div>}
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}

      {initial ? (
        <MacroEditor initial={initial} others={others} profiles={profiles} meta={meta} activeProfileId={profileId}
          onSaved={(m, wasNew, open) => {
            if (wasNew) clearDraft(m.id);
            // Saved after the editor closed: never navigate back into it.
            if (!open) return;
            upsert(m);
            if (m.id !== editedId) {
              // The new macro now exists: give this page its address, without reopening it.
              setEditedId(m.id);
              openEditor(m.id, { quiet: true });
            }
            void engineApi.getMacroMeta().then(setMeta).catch(() => undefined);
          }}
          onDuplicate={(m) => void run(async () => {
            const c = await engineApi.duplicateMacro(m.id);
            openEditor(c.id, {}, `Made “${c.name}” (no button assigned). You're editing the copy.`);
          })}
          onExport={(m) => void run(async () => { const r = await engineApi.exportMacro([m.id]); setMsg(r.path ? `Saved to ${r.path}` : "Couldn't write the file."); })}
          onDelete={(m) => setToDelete(m)}
          onPin={(m, on) => void run(async () => setMeta(await engineApi.setMacroPinned(m.id, on)))} />
      ) : (
        <p className="muted" role="status">Loading macro…</p>
      )}

      {toDelete && (
        <ConfirmDialog title={`Delete “${toDelete.name}”?`} confirmLabel="Delete macro" danger
          body={<p>It is removed from every profile{toDelete.trigger ? ` and from ${BUTTONS[toDelete.trigger].name}` : ""}. This can't be undone. To keep it but stop it, switch it off or remove its button instead.</p>}
          onCancel={() => setToDelete(null)}
          onConfirm={() => {
            const m = toDelete; setToDelete(null);
            void run(async () => {
              // Let any save under way finish first, so it can't land after the delete.
              await flushMacroEditor();
              await engineApi.deleteMacro(m.id);
              discardMacroEditor();
              // Replace this page's history entry: Back shouldn't lead to the deleted macro.
              openLibrary(`Deleted “${m.name}”.`, { replace: true });
            });
          }} />
      )}
    </div>
  );
});
