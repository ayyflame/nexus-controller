import { useState } from "react";

/** A link or path shown as text with a Copy button (NEXUS opens no browser itself). */
export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-text">
      <code className="mono break">{text}</code>
      <button className="btn-ghost small" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
      }}>{copied ? "Copied" : "Copy"}</button>
    </span>
  );
}
