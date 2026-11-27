import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEngine } from "../../hooks/useEngine";
import { engineApi, errorMessage } from "../../lib/engine";
import { withDefaults } from "../../lib/processing";
import { Icon } from "../Icons";
import type { ProcessingConfig } from "../../types/engine";
import { DeviceSelector } from "./advanced";

type Save = "saved" | "saving" | { error: string };

/** Editing state for the active profile's processing settings, auto-saved. */
export function useProcessingDraft() {
  const { profile, setProfile, connection } = useEngine();
  const [draft, setDraft] = useState<ProcessingConfig>(withDefaults(profile?.processing));
  const [save, setSave] = useState<Save>("saved");
  const lastSaved = useRef(JSON.stringify(withDefaults(profile?.processing)));
  const profileId = profile?.id;

  // Switching profile loads its settings.
  useEffect(() => {
    if (!profile) return;
    setDraft(withDefaults(profile.processing));
    lastSaved.current = JSON.stringify(withDefaults(profile.processing));
    setSave("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // The profile the draft belongs to (current at every render).
  const draftProfile = useRef(profileId);
  draftProfile.current = profileId;

  useEffect(() => {
    if (connection.kind !== "ready" || JSON.stringify(draft) === lastSaved.current) return;
    setSave("saving");
    const owner = profileId;
    const t = setTimeout(async () => {
      try {
        // Saved to the profile it was edited in, even if a game switched the
        // active profile meanwhile.
        const saved = await engineApi.setProcessing(draft, owner);
        if (draftProfile.current !== owner) return; // switched away: nothing to show
        lastSaved.current = JSON.stringify(draft);
        setProfile(saved);
        setSave("saved");
      } catch (e) {
        if (draftProfile.current === owner) setSave({ error: errorMessage(e) });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, connection.kind, setProfile]);

  return { draft, setDraft, save };
}

/**
 * A page that edits the active profile's controller settings (Mapping,
 * Sticks, Triggers, Motion, Touchpad, Lighting): title, save state, the
 * controller picker when several are connected, and the auto-saved draft.
 */
export function ProcessingPage({ title, description, className, needsEngine = true, children }: {
  title: string;
  description: ReactNode;
  className?: string;
  /** False for pages that still work without the desktop engine. */
  needsEngine?: boolean;
  children: (config: ProcessingConfig, onChange: (c: ProcessingConfig) => void) => ReactNode;
}) {
  const { connection } = useEngine();
  const { draft, setDraft, save } = useProcessingDraft();
  const ready = connection.kind === "ready";
  return (
    <div className={`page${className ? ` ${className}` : ""}`}>
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="muted">{description}</p>
        </div>
        {ready && <SaveState save={save} />}
      </header>
      <DeviceSelector />
      {!ready && needsEngine && <div className="notice dev">Controller settings are available in the desktop app.</div>}
      {children(draft, setDraft)}
    </div>
  );
}

function SaveState({ save }: { save: Save }) {
  return (
    <span className={`save-state ${save === "saved" ? "ok" : typeof save === "object" ? "err" : ""}`} role="status">
      {save === "saved" ? <><Icon name="check" size={14} /> Saved to profile</> : save === "saving" ? "Saving…" : `Not saved: ${save.error}`}
    </span>
  );
}
