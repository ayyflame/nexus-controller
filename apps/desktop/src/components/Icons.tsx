// Minimal stroke icon set (24px grid, currentColor).
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
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
