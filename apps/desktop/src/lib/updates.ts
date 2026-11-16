// Update check against the project's public GitHub releases. A private
// repository (or no releases) simply reports that no information is
// available; nothing is downloaded or installed automatically.

export const RELEASES_API = "https://api.github.com/repos/ayyflame/nexus-controller/releases/latest";
export const RELEASES_PAGE = "https://github.com/ayyflame/nexus-controller/releases";

export type UpdateResult =
  | { kind: "current"; latest: string }
  | { kind: "available"; latest: string; url: string }
  | { kind: "unavailable"; reason: string };

/** Compares dotted versions like "0.2.0" and "v0.10.1". */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parse(latest), parse(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function checkForUpdates(current: string): Promise<UpdateResult> {
  try {
    const r = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (r.status === 404) return { kind: "unavailable", reason: "No public release information is available yet." };
    if (!r.ok) return { kind: "unavailable", reason: `GitHub answered ${r.status}.` };
    const data = (await r.json()) as { tag_name?: string; html_url?: string };
    const latest = data.tag_name ?? "";
    if (!latest) return { kind: "unavailable", reason: "The latest release has no version." };
    return isNewer(latest, current)
      ? { kind: "available", latest, url: data.html_url ?? RELEASES_PAGE }
      : { kind: "current", latest };
  } catch {
    return { kind: "unavailable", reason: "Couldn't reach GitHub. Check your internet connection." };
  }
}
