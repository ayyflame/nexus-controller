import { useState } from "react";
import { useUpdates } from "../hooks/useUpdates";
import { formatBytes, progressPercent, RELEASES_PAGE, type UpdateStatus } from "../lib/updates";

/** Release notes, collapsed by default. Plain text only (never HTML). */
export function ReleaseNotes({ notes }: { notes: string }) {
  const [open, setOpen] = useState(false);
  if (!notes.trim()) return null;
  return (
    <div className="update-notes">
      <button className="btn-ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide what's new" : "What's new"}
      </button>
      {open && <pre className="update-notes-body">{notes}</pre>}
    </div>
  );
}

/** Buttons for the current update step, shared by the banner and Settings. */
export function UpdateActions({ status, actions }: {
  status: UpdateStatus;
  actions: Pick<ReturnType<typeof useUpdates>, "download" | "install" | "postpone">;
}) {
  const s = status.state;
  switch (s.kind) {
    case "available":
      return (
        <span className="row gap-sm">
          <button className="btn-primary" onClick={() => void actions.download()}>Update now</button>
          {status.postponed !== s.release.version && (
            <button className="btn-ghost" onClick={() => void actions.postpone()}>Later</button>
          )}
        </span>
      );
    case "downloading": {
      const pct = progressPercent(s);
      return (
        <span className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <span className="update-bar"><span className="bar-fill" style={{ width: `${pct ?? 0}%` }} /></span>
          <span className="small muted">
            {s.total ? `${formatBytes(s.downloaded)} / ${formatBytes(s.total)}` : formatBytes(s.downloaded)}
          </span>
        </span>
      );
    }
    case "readyToInstall":
      return (
        <span className="row gap-sm">
          <button className="btn-primary" onClick={() => void actions.install()}>Restart and install</button>
          <span className="small muted">{formatBytes(s.size)}, signature verified</span>
        </span>
      );
    case "installing":
      return <span className="small muted">Starting the installer…</span>;
    case "failed":
      if (s.error.kind === "unsupportedInstall") {
        return <a className="small gold" href={RELEASES_PAGE} target="_blank" rel="noreferrer">Open the Releases page</a>;
      }
      return s.release ? (
        <span className="row gap-sm">
          <button className="btn-secondary" onClick={() => void actions.download()}>Try again</button>
          <button className="btn-ghost" onClick={() => void actions.postpone()}>Later</button>
        </span>
      ) : null;
    default:
      return null;
  }
}

/** App-wide notice: "Update available" (never forced) and the result of the last update. */
export function UpdateBanner() {
  const u = useUpdates();
  const st = u.status;
  if (!st) return null;

  if (st.outcome) {
    const o = st.outcome;
    return (
      <div className={`update-banner ${o.kind === "updated" ? "ok" : "error"}`} role="status">
        <span>
          {o.kind === "updated"
            ? `NEXUS was updated to ${o.version}. Your profiles, macros and settings were kept.`
            : `The update to ${o.expected} didn't complete; you're still on ${o.running}. Nothing was lost. You can try again from Settings.`}
        </span>
        <button className="btn-ghost" onClick={() => void u.dismissOutcome()}>Dismiss</button>
      </div>
    );
  }

  const s = st.state;
  const showFailure = s.kind === "failed" && s.release !== null;
  if (!st.banner && !showFailure) return null;
  const release = "release" in s ? s.release : null;
  if (!release) return null;

  const title =
    s.kind === "failed" ? s.error.message
    : s.kind === "downloading" ? `Downloading NEXUS ${release.version}…`
    : s.kind === "readyToInstall" ? `NEXUS ${release.version} is ready. NEXUS will close, install it and reopen; your profiles and settings are kept.`
    : s.kind === "installing" ? `Installing NEXUS ${release.version}…`
    : `Update available: NEXUS ${release.version} (you have ${st.currentVersion}).`;

  return (
    <div className={`update-banner${s.kind === "failed" ? " error" : ""}`} role="status">
      <div className="update-banner-text">
        <strong>{title}</strong>
        {s.kind === "available" && <ReleaseNotes notes={release.notes} />}
      </div>
      <UpdateActions status={st} actions={u} />
    </div>
  );
}
