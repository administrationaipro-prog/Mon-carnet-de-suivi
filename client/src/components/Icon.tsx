// Icônes vectorielles (trait 1.8 px) — remplacent les émojis pour un rendu net et homogène sur tous les appareils.
import type { CSSProperties } from 'react';

const P: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  scale: 'M7 4h10a4 4 0 014 4v8a4 4 0 01-4 4H7a4 4 0 01-4-4V8a4 4 0 014-4zM8 10a5 5 0 018 0M12 10l2-2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wheat: 'M12 22V8M12 8c-3 0-4-2-4-4 3 0 4 2 4 4zM12 8c3 0 4-2 4-4-3 0-4 2-4 4zM12 14c-3 0-4-2-4-4 3 0 4 2 4 4zM12 14c3 0 4-2 4-4-3 0-4 2-4 4z',
  health: 'M8 3h8a5 5 0 015 5v8a5 5 0 01-5 5H8a5 5 0 01-5-5V8a5 5 0 015-5zM12 8v8M8 12h8',
  repro: 'M12 21s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.6-7 10-7 10z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21c.8-3.5 3.5-5.5 7-5.5s6.2 2 7 5.5M16 3.5a4 4 0 010 7.5M18.5 15.6c1.9.8 3.1 2.6 3.5 5.4',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z',
  check: 'M5 12l5 5 9-10',
  shield: 'M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z M9 12l2 2 4-4',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  bell: 'M6 17v-6a6 6 0 0112 0v6l2 2H4zM10 21h4',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1-4 4-6 8-6s7 2 8 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 6l-6 6 6 6',
  chev: 'M9 6l6 6-6 6',
  logout: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  wifi: 'M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0M12 19h.01',
  wifioff: 'M3 3l18 18M8.5 16a5 5 0 017 0M5 12.5a10 10 0 014.5-2.5M14.5 10a10 10 0 014.5 2.5M2 9a15 15 0 014.2-2.8M11 5a15 15 0 0111 4M12 19h.01',
  del: 'M21 5H9l-6 7 6 7h12zM13 9l4 6M17 9l-4 6',
  calendar: 'M7 3v3M17 3v3M4 8h16M6 5h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5h.01',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  x: 'M6 6l12 12M18 6L6 18',
  dna: 'M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9M9.5 6.5h5M9.5 17.5h5',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 22, stroke = 1.8, style, className }: { name: IconName; size?: number; stroke?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      <path d={P[name]} />
    </svg>
  );
}

/** Pictogramme du mouton (laine, tête noire type Black Belly, quatre pattes). */
export function Sheep({ size = 40, wool = 'currentColor', dark = '#1d1d1b' }: { size?: number; wool?: string; dark?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g fill={dark}><rect x="20" y="42" width="4" height="14" rx="2" /><rect x="28" y="43" width="4" height="13" rx="2" /><rect x="38" y="43" width="4" height="13" rx="2" /><rect x="46" y="42" width="4" height="14" rx="2" /></g>
      <g fill={wool}><circle cx="22" cy="30" r="9" /><circle cx="31" cy="24" r="10" /><circle cx="42" cy="25" r="10" /><circle cx="50" cy="33" r="8" /><circle cx="26" cy="38" r="9" /><circle cx="38" cy="39" r="10" /><circle cx="46" cy="39" r="7" /></g>
      <g fill={dark}><ellipse cx="11" cy="35" rx="8" ry="9" /><ellipse cx="17" cy="26" rx="3" ry="5" transform="rotate(-30 17 26)" /></g>
      <circle cx="9.5" cy="32.5" r="1.8" fill="#fff" />
    </svg>
  );
}
