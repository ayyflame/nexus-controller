// Automatic updates: types mirroring src-tauri/src/updates.rs and the
// `nexus-updates` crate, plus pure helpers for the UI. All network and
// install work happens in Rust; the webview has no updater or HTTP access.

export const RELEASES_PAGE = "https://github.com/ayyflame/nexus-controller/releases";

export interface ReleaseInfo { version: string; notes: string; pubDate: string | null }

export type UpdateErrorKind =
  | "notConfigured" | "offline" | "invalidManifest" | "invalidSignature"
  | "unsupportedInstall" | "download" | "install" | "busy";

export interface UpdateError { kind: UpdateErrorKind; message: string; detail: string }

export type UpdateState =
  | { kind: "notConfigured" }
  | { kind: "idle" }
  | { kind: "checking"; manual: boolean }
  | { kind: "upToDate" }
  | { kind: "available"; release: ReleaseInfo }
  | { kind: "downloading"; release: ReleaseInfo; downloaded: number; total: number | null }
  | { kind: "readyToInstall"; release: ReleaseInfo; size: number }
  | { kind: "installing"; release: ReleaseInfo }
  | { kind: "failed"; error: UpdateError; release: ReleaseInfo | null };

export type InstallOutcome =
  | { kind: "updated"; version: string }
  | { kind: "notApplied"; expected: string; running: string };

export interface UpdateStatus {
  configured: boolean;
  currentVersion: string;
  channel: string;
  autoCheck: boolean;
  lastSuccessMs: number | null;
  state: UpdateState;
  banner: boolean;
  postponed: string | null;
  outcome: InstallOutcome | null;
}

/** Compares dotted versions like "0.2.0" and "v0.10.1". */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 0–100, or null while the size is unknown. */
export function progressPercent(s: UpdateState): number | null {
  if (s.kind !== "downloading" || !s.total) return null;
  return Math.max(0, Math.min(100, Math.round((s.downloaded / s.total) * 100)));
}

/** The release the state refers to, if any. */
export function releaseOf(s: UpdateState): ReleaseInfo | null {
  return "release" in s ? s.release : null;
}

/** One operation at a time: true while checking, downloading or installing. */
export function isBusy(s: UpdateState): boolean {
  return s.kind === "checking" || s.kind === "downloading" || s.kind === "installing";
}

export type Tone = "ok" | "warn" | "error" | "neutral";

/** Short status line for Settings → Updates. */
export function describeUpdate(st: UpdateStatus): { tone: Tone; text: string } {
  const s = st.state;
  switch (s.kind) {
    case "notConfigured":
      return { tone: "neutral", text: "Automatic updates aren't set up in this build (development or test build)." };
    case "idle":
      return { tone: "neutral", text: st.autoCheck ? "NEXUS checks for updates automatically." : "Automatic checks are off." };
    case "checking":
      return { tone: "neutral", text: "Checking for updates…" };
    case "upToDate":
      return { tone: "ok", text: `You're up to date (version ${st.currentVersion}).` };
    case "available":
      return { tone: "warn", text: `Version ${s.release.version} is available.` };
    case "downloading": {
      const pct = progressPercent(s);
      const size = s.total ? `${formatBytes(s.downloaded)} of ${formatBytes(s.total)}` : formatBytes(s.downloaded);
      return { tone: "neutral", text: `Downloading ${s.release.version}… ${size}${pct === null ? "" : ` (${pct}%)`}` };
    }
    case "readyToInstall":
      return { tone: "warn", text: `Version ${s.release.version} is downloaded and verified. Restart NEXUS to install it.` };
    case "installing":
      return { tone: "neutral", text: `Installing ${s.release.version}… NEXUS will close and reopen.` };
    case "failed":
      return { tone: s.error.kind === "offline" ? "warn" : "error", text: s.error.message };
  }
}

/** "3 minutes ago" style text for the last successful check. */
export function formatLastCheck(ms: number | null, now: number = Date.now()): string {
  if (!ms) return "Never";
  const secs = Math.max(0, Math.round((now - ms) / 1000));
  if (secs < 60) return "Just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleString();
}
