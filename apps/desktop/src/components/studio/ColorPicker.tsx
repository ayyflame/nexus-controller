import { useEffect, useState } from "react";
import { QUICK_PALETTES, hexToRgb, normalizeHex, pushRecent, rgbToHex } from "../../lib/skin";
import { colorPrefs } from "../../lib/skinStore";

/**
 * Colour input: system picker, HEX and RGB fields, quick palettes, favourites
 * and recent colours. `onChange` fires while picking (merge key: one undo
 * step per drag); `onCommit` when a colour is settled (adds it to Recent).
 */
export function ColorPicker({ value, onChange, label, mergeKey }: {
  value: string; onChange: (hex: string, merge?: string) => void; label: string; mergeKey: string;
}) {
  const [hexText, setHexText] = useState(value);
  const [recent, setRecent] = useState(colorPrefs.recent);
  const [favorites, setFavorites] = useState(colorPrefs.favorites);
  useEffect(() => setHexText(value), [value]);
  const [r, g, b] = hexToRgb(value);

  const commit = (hex: string) => {
    const h = normalizeHex(hex);
    if (!h) return;
    const next = pushRecent(recent, h);
    setRecent(next);
    colorPrefs.setRecent(next);
  };
  const pick = (hex: string, merge?: string) => { const h = normalizeHex(hex); if (h) onChange(h, merge); };
  const isFav = favorites.includes(value);
  const toggleFav = () => {
    const next = isFav ? favorites.filter((c) => c !== value) : [value, ...favorites].slice(0, 24);
    setFavorites(next);
    colorPrefs.setFavorites(next);
  };
  const chip = (c: string, key: string) => (
    <button key={key} type="button" className={`st-chip${c === value ? " on" : ""}`} style={{ background: c }} title={c}
      aria-label={`Use ${c}`} onClick={() => { pick(c); commit(c); }} />
  );

  return (
    <div className="st-color" role="group" aria-label={label}>
      <div className="st-color-row">
        <label className="st-swatch" style={{ background: value }} title="Open the colour picker">
          <input type="color" value={value} aria-label={`${label}: colour picker`}
            onChange={(e) => pick(e.target.value, mergeKey)} onBlur={(e) => commit(e.target.value)} />
        </label>
        <label className="st-field hex">
          <span>HEX</span>
          <input value={hexText} spellCheck={false} maxLength={7} aria-label={`${label}: hex`}
            onChange={(e) => { setHexText(e.target.value); const h = normalizeHex(e.target.value); if (h) pick(h, mergeKey); }}
            onBlur={() => { const h = normalizeHex(hexText); if (h) commit(h); else setHexText(value); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </label>
        {(["R", "G", "B"] as const).map((ch, i) => (
          <label key={ch} className="st-field rgb">
            <span>{ch}</span>
            <input type="number" min={0} max={255} value={[r, g, b][i]} aria-label={`${label}: ${ch}`}
              onChange={(e) => {
                const v = [r, g, b];
                v[i] = Number(e.target.value);
                pick(rgbToHex(v[0]!, v[1]!, v[2]!), mergeKey);
              }} onBlur={() => commit(value)} />
          </label>
        ))}
        <button type="button" className={`st-fav${isFav ? " on" : ""}`} onClick={toggleFav}
          aria-pressed={isFav} title={isFav ? "Remove from favourites" : "Add to favourites"}>★</button>
      </div>
      {favorites.length > 0 && <div className="st-chips"><span>Favourites</span>{favorites.map((c) => chip(c, `f${c}`))}</div>}
      {recent.length > 0 && <div className="st-chips"><span>Recent</span>{recent.map((c) => chip(c, `r${c}`))}</div>}
      <details className="st-palettes">
        <summary>Palettes</summary>
        {QUICK_PALETTES.map((p) => <div key={p.name} className="st-chips"><span>{p.name}</span>{p.colors.map((c) => chip(c, `${p.name}${c}`))}</div>)}
      </details>
    </div>
  );
}
