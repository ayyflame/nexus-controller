import { useRef, useState } from "react";
import { useShownModel } from "../../hooks/useShownModel";
import { isCalibratedPhoto, savePhoto, useControllerPhoto } from "../../lib/controllerPhoto";
import { saveViewMode, useViewMode } from "../../lib/controllerViewMode";

/**
 * Optional: show your own controller photo instead of the drawing. The file
 * stays on this PC (webview storage); NEXUS accepts only the image its
 * overlay was aligned to.
 */
export function PhotoPicker() {
  const photo = useControllerPhoto();
  const mode = useViewMode();
  // The photo option is a DualSense photograph; a DualShock 4 is always drawn.
  const ds4 = useShownModel() === "dualShock4";
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    const bytes = await file.arrayBuffer();
    if (!(await isCalibratedPhoto(bytes))) {
      setMessage({ tone: "error", text: "This isn't the picture the overlay positions were measured on, so buttons wouldn't line up. NEXUS keeps the drawn controller." });
      return;
    }
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    setMessage(savePhoto(url)
      ? { tone: "ok", text: "Photo set. It is kept on this PC only." }
      : { tone: "error", text: "Couldn't store the photo on this PC." });
  };
  return (
    <div className="photo-picker">
      <div className="segmented small" role="group" aria-label="Controller picture">
        <button type="button" className={mode === "3d" ? "selected" : ""} aria-pressed={mode === "3d"} onClick={() => saveViewMode("3d")}>3D</button>
        <button type="button" className={mode === "flat" ? "selected" : ""} aria-pressed={mode === "flat"} onClick={() => saveViewMode("flat")}>2D</button>
      </div>
      <span className="muted">{mode === "3d" ? "Interactive 3D model"
        : ds4 ? `2D picture: drawn DualShock 4${photo ? " (your photo is of a DualSense and shows with a DualSense)" : ""}`
        : `2D picture: ${photo ? "your photo" : "drawn"}`}</span>
      <input ref={input} type="file" accept="image/jpeg,image/png" hidden
        onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
      {mode === "flat" && !ds4 && <button className="btn-ghost small" onClick={() => input.current?.click()}>Use my photo…</button>}
      {mode === "flat" && !ds4 && photo && <button className="btn-ghost small" onClick={() => { savePhoto(null); setMessage(null); }}>Use drawing</button>}
      {message && <span className={message.tone === "ok" ? "ok-text" : "warn-text"}>{message.text}</span>}
    </div>
  );
}
