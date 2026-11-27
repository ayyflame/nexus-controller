// Linking games to profiles. Pure, tested.

/** Recently used programs that aren't linked to this profile yet. */
export function pickable(recent: string[], linked: string[]): string[] {
  const have = new Set(linked.map((g) => g.toLowerCase()));
  return recent.filter((p) => !have.has(p.toLowerCase()));
}
