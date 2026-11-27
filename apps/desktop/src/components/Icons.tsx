// NEXUS icon set: one stroke style (24px grid, 1.7 stroke, round caps,
// currentColor), so every icon has the same weight next to text.
import type { ReactElement } from "react";

const paths: Record<string, ReactElement> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  stick: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2" /></>,
  mapping: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.5 6H14a4 4 0 0 1 4 4v5.5" /><path d="M15.5 13 18 15.5 20.5 13" /></>,
  trigger: <><path d="M7 20V9a5 5 0 0 1 10 0v11" /><path d="M7 14h10" /></>,
  macro: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15l3-3-3-3M12 15h5" /></>,
  controller: <><path d="M6.5 8h11a4 4 0 0 1 3.9 3.1l.9 4.3a2.2 2.2 0 0 1-3.8 1.9L16.6 15H7.4l-1.9 2.3a2.2 2.2 0 0 1-3.8-1.9l.9-4.3A4 4 0 0 1 6.5 8Z" /><path d="M8 10.5v3M6.5 12h3" /><circle cx="16" cy="11" r=".6" /><circle cx="17.5" cy="13" r=".6" /></>,
  profiles: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5a6.5 6.5 0 0 1 3 5.5" /></>,
  performance: <><path d="M3 12h4l2.5-6 5 12L17 12h4" /></>,
  output: <><path d="M6.5 9h11a3.5 3.5 0 0 1 3.4 2.7l.8 3.6a2 2 0 0 1-3.4 1.7L16.6 15H7.4l-1.7 2a2 2 0 0 1-3.4-1.7l.8-3.6A3.5 3.5 0 0 1 6.5 9Z" /><path d="M12 2.5v4M10 4.5l2 2 2-2" /></>,
  gyro: <><circle cx="12" cy="12" r="2.2" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /><ellipse cx="12" cy="12" rx="3.6" ry="9" /></>,
  touchpad: <><rect x="3" y="5" width="18" height="12" rx="2.5" /><path d="M12 5v12" /><circle cx="8" cy="11" r="1.2" /></>,
  light: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z" /></>,
  live: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  overlay: <><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8M12 17v4" /><circle cx="12" cy="10.5" r="2.5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  usb: <><path d="M12 3v15M9 6l3-3 3 3" /><path d="M12 14l-4-2.5V9M12 12l4-2V8" /><circle cx="12" cy="19.5" r="1.5" /></>,
  bluetooth: <><path d="m7 7 10 10-5 4V3l5 4L7 17" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.6L20 16M20 20v-4h-4" /></>,
  // Actions and states (same 24px grid and stroke as above)
  plus: <><path d="M12 5v14M5 12h14" /></>,
  play: <><path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5Z" /></>,
  stop: <><rect x="6" y="6" width="12" height="12" rx="2" /></>,
  record: <><circle cx="12" cy="12" r="6.5" /></>,
  star: <><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z" /></>,
  arrowLeft: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
  arrowRight: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  chevronRight: <><path d="m9 6 6 6-6 6" /></>,
  chevronLeft: <><path d="m15 6-6 6 6 6" /></>,
  chevronDown: <><path d="m6 9 6 6 6-6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.1" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.2 12.4 2.6 2.6 5-5.4" /></>,
  alert: <><path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9.5v4M12 16.8v.1" /></>,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  upload: <><path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9" /><path d="M5 19.5h14" /></>,
  trash: <><path d="M4.5 7h15M10 11v5.5M14 11v5.5" /><path d="M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" /></>,
  undo: <><path d="M9 14 4.5 9.5 9 5" /><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" /></>,
  redo: <><path d="M15 14l4.5-4.5L15 5" /><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3" /></>,
  repeat: <><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13M7 21.5 3.5 18 7 14.5" /><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13" /></>,
  power: <><path d="M12 3v8.5" /><path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0" /></>,
  link: <><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  shield: <><path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6Z" /></>,
  folder: <><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" /></>,
  wrench: <><path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3.5-3.5 6.8-6.8a4 4 0 0 1-1.8-4.2Z" /><path d="M9.5 9.5 4 4M4 4h3M4 4v3" /></>,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></>,
  bolt: <><path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12Z" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  bug: <><rect x="7.5" y="7.5" width="9" height="12" rx="4.5" /><path d="M12 7.5V5M9 5.5 7.5 4M15 5.5 16.5 4M3.5 13h4M16.5 13h4M4.5 9l3 1.5M19.5 9l-3 1.5M4.5 18.5l3-2M19.5 18.5l-3-2" /></>,
};

export type IconName = keyof typeof paths;

/** A stroke icon from the set above; decorative (aria-hidden) unless `label` is given. */
export function Icon({ name, size = 18, filled = false, label, className }: {
  name: IconName; size?: number;
  /** Fill the shape too (e.g. a pinned star, the record dot). */
  filled?: boolean;
  /** Accessible name, when the icon stands alone and means something. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className}
      aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}
    >
      {paths[name]}
    </svg>
  );
}
