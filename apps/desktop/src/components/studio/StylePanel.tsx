import { useRef, useState } from "react";
import {
  COMPONENTS, FINISHES, FINISH_IDS, PATTERNS, PATTERN_IDS, componentInfo, styleOf, type ComponentId, type ComponentStyle,
  type Decal, type Skin,
} from "../../lib/skin";
import { ColorPicker } from "./ColorPicker";
import { decalFromFile } from "./decalUpload";

type Edit = (next: Skin, merge?: string) => void;

/** Right sidebar: everything about how the selected component looks. */
export function StylePanel({ skin, id, edit, clipboard, setClipboard }: {
  skin: Skin; id: ComponentId; edit: Edit; clipboard: ComponentStyle | null; setClipboard: (s: ComponentStyle) => void;
}) {
  const info = componentInfo(id);
  const s = styleOf(skin, id);
  const set = (patch: Partial<ComponentStyle>, merge?: string) =>
    edit({ ...skin, components: { ...skin.components, [id]: { ...s, ...patch } } }, merge);
  const clean = (next: Skin) => {
    // Plain styles are not stored.
    const st = next.components[id];
    if (st && st.color === null && st.finish === "original" && !st.gradient && !st.pattern) {
      const c = { ...next.components };
      delete c[id];
      return { ...next, components: c };
    }
    return next;
  };
  const setClean = (patch: Partial<ComponentStyle>, merge?: string) =>
    edit(clean({ ...skin, components: { ...skin.components, [id]: { ...s, ...patch } } }), merge);

  if (info.lightOnly) {
    return (
      <div className="st-panel">
        <h3>{info.label}</h3>
        <p className="muted small">The light bar glows in this colour while a controller is connected. It is shown in NEXUS only; the controller's own light bar is set under Controller › Lighting.</p>
        <ColorPicker label="Light bar colour" value={skin.lightBar} mergeKey="lightBar" onChange={(c, m) => edit({ ...skin, lightBar: c }, m)} />
      </div>
    );
  }

  return (
    <div className="st-panel">
      <h3>{info.label}</h3>

      <section>
        <div className="st-row-head">
          <h4>Colour</h4>
          <div className="segmented small">
            <button type="button" className={s.color === null ? "selected" : ""} onClick={() => setClean({ color: null, gradient: null })}>As modelled</button>
            <button type="button" className={s.color !== null ? "selected" : ""} onClick={() => set({ color: s.color ?? "#d4a94f" })}>Custom</button>
          </div>
        </div>
        {s.color !== null && <ColorPicker label={`${info.label} colour`} value={s.color} mergeKey={`color:${id}`} onChange={(c, m) => set({ color: c }, m)} />}
        {s.color === null && <p className="muted small">Uses the controller's {skin.base === "black" ? "Midnight Black" : "white"} look. Choose Custom to pick any colour.</p>}
      </section>

      <section>
        <h4>Material</h4>
        <div className="st-finishes" role="radiogroup" aria-label="Material finish">
          {FINISH_IDS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={s.finish === f} className={`st-finish f-${f}${s.finish === f ? " on" : ""}`}
              onClick={() => setClean({ finish: f })}>
              <i /><span>{FINISHES[f].label}</span>
            </button>
          ))}
        </div>
      </section>

      {s.color !== null && (
        <section>
          <div className="st-row-head">
            <h4>Gradient</h4>
            <label className="st-toggle"><input type="checkbox" checked={Boolean(s.gradient)}
              onChange={(e) => set({ gradient: e.target.checked ? { to: "#1b1c21", angle: 90 } : null })} /> Blend to a second colour</label>
          </div>
          {s.gradient && (
            <>
              <ColorPicker label="Gradient end colour" value={s.gradient.to} mergeKey={`grad:${id}`} onChange={(c, m) => set({ gradient: { ...s.gradient!, to: c } }, m)} />
              <Slider label="Direction" unit="°" min={0} max={360} step={5} value={s.gradient.angle}
                onChange={(v) => set({ gradient: { ...s.gradient!, angle: v } }, `gangle:${id}`)} />
            </>
          )}
        </section>
      )}

      <section>
        <div className="st-row-head">
          <h4>Pattern</h4>
          <select className="select small" value={s.pattern?.id ?? ""} aria-label="Pattern"
            onChange={(e) => setClean({ pattern: e.target.value ? { id: e.target.value as never, color: s.pattern?.color ?? "#000000", scale: s.pattern?.scale ?? 1, opacity: s.pattern?.opacity ?? 0.6 } : null })}>
            <option value="">None</option>
            {PATTERN_IDS.map((p) => <option key={p} value={p}>{PATTERNS[p]}</option>)}
          </select>
        </div>
        {s.pattern && (
          <>
            <ColorPicker label="Pattern colour" value={s.pattern.color} mergeKey={`pcol:${id}`} onChange={(c, m) => set({ pattern: { ...s.pattern!, color: c } }, m)} />
            <Slider label="Size" min={0.25} max={4} step={0.05} value={s.pattern.scale} format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => set({ pattern: { ...s.pattern!, scale: v } }, `pscale:${id}`)} />
            <Slider label="Strength" min={0} max={1} step={0.01} value={s.pattern.opacity} format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => set({ pattern: { ...s.pattern!, opacity: v } }, `pop:${id}`)} />
          </>
        )}
      </section>

      {info.decals && <DecalSection skin={skin} id={id} edit={edit} />}

      <section className="st-actions">
        <button type="button" className="btn-ghost small" onClick={() => setClipboard(s)} title="Copy this part's style">Copy style</button>
        <button type="button" className="btn-ghost small" disabled={!clipboard} onClick={() => clipboard && edit(clean({ ...skin, components: { ...skin.components, [id]: { ...clipboard } } }))}>Paste style</button>
        <ApplyTo skin={skin} from={id} edit={edit} />
      </section>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, unit = "", format }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; unit?: string; format?: (v: number) => string;
}) {
  return (
    <label className="st-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <b>{format ? format(value) : `${Math.round(value)}${unit}`}</b>
    </label>
  );
}

/** Copy this part's style to other parts: quick groups or a hand-picked list. */
function ApplyTo({ skin, from, edit }: { skin: Skin; from: ComponentId; edit: Edit }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<ComponentId>>(new Set());
  const targets = COMPONENTS.filter((c) => c.id !== from && !c.lightOnly);
  const groups = [...new Set(targets.map((c) => c.group))];
  const apply = () => {
    const s = styleOf(skin, from);
    const components = { ...skin.components };
    for (const id of chosen) components[id] = { ...s };
    edit({ ...skin, components });
    setOpen(false);
    setChosen(new Set());
  };
  if (!open) return <button type="button" className="btn-ghost small" onClick={() => setOpen(true)}>Apply to…</button>;
  return (
    <div className="st-apply">
      <div className="st-apply-groups">
        {groups.map((g) => (
          <button key={g} type="button" className="btn-ghost small" onClick={() => setChosen(new Set([...chosen, ...targets.filter((t) => t.group === g).map((t) => t.id)]))}>+ {g}</button>
        ))}
      </div>
      <div className="st-apply-list">
        {targets.map((t) => (
          <label key={t.id}><input type="checkbox" checked={chosen.has(t.id)}
            onChange={(e) => { const n = new Set(chosen); if (e.target.checked) n.add(t.id); else n.delete(t.id); setChosen(n); }} /> {t.label}</label>
        ))}
      </div>
      <div className="row gap">
        <button type="button" className="btn-primary small" disabled={!chosen.size} onClick={apply}>Apply to {chosen.size || ""}</button>
        <button type="button" className="btn-ghost small" onClick={() => { setOpen(false); setChosen(new Set()); }}>Cancel</button>
      </div>
    </div>
  );
}

/** Uploading and placing a graphic on this part (one per part). */
function DecalSection({ skin, id, edit }: { skin: Skin; id: ComponentId; edit: Edit }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decal = skin.decals.find((d) => d.component === id);
  const update = (patch: Partial<Decal>, merge?: string) =>
    edit({ ...skin, decals: skin.decals.map((d) => (d.component === id ? { ...d, ...patch } : d)) }, merge);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const r = await decalFromFile(file);
    setBusy(false);
    if (!r.ok) { setMessage(r.error); return; }
    const d: Decal = { id: `decal-${Date.now().toString(36)}`, component: id, image: r.image, x: 0.5, y: 0.5, scale: 0.4, rotation: 0, opacity: 1 };
    edit({ ...skin, decals: [...skin.decals.filter((x) => x.component !== id), d] });
  };
  return (
    <section>
      <div className="st-row-head">
        <h4>Graphic</h4>
        <div className="row gap">
          <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className="btn-ghost small" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Reading…" : decal ? "Replace…" : "Upload…"}</button>
          {decal && <button type="button" className="btn-ghost small danger" onClick={() => edit({ ...skin, decals: skin.decals.filter((d) => d.component !== id) })}>Remove</button>}
        </div>
      </div>
      {message && <p className="warn-text small" role="alert">{message}</p>}
      {!decal && !message && <p className="muted small">PNG, JPEG or WebP, up to 4 MB. It's checked, resized and stored with the skin.</p>}
      {decal && (
        <div className="st-decal">
          <img src={decal.image} alt="" />
          <div>
            <Slider label="Across" min={0} max={1} step={0.01} value={decal.x} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ x: v }, `dx:${id}`)} />
            <Slider label="Down" min={0} max={1} step={0.01} value={decal.y} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ y: v }, `dy:${id}`)} />
            <Slider label="Size" min={0.05} max={1.5} step={0.01} value={decal.scale} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ scale: v }, `ds:${id}`)} />
            <Slider label="Rotation" unit="°" min={-180} max={180} step={1} value={decal.rotation} onChange={(v) => update({ rotation: v }, `dr:${id}`)} />
            <Slider label="Opacity" min={0} max={1} step={0.01} value={decal.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ opacity: v }, `do:${id}`)} />
          </div>
        </div>
      )}
    </section>
  );
}
