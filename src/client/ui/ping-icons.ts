import type { PingKind } from '../../shared/ping';

/** Simple line icons, one per ping, drawn on a 24 by 24 grid. Currentcolor so CSS tints them. */
export const PING_ICONS: Readonly<Record<PingKind, string>> = {
  go: '<path d="M4 12h14M12 5l7 7-7 7" />',
  wait: '<rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />',
  tow: '<circle cx="6.5" cy="12" r="3.2" /><circle cx="17.5" cy="12" r="3.2" /><path d="M9.7 12h4.6" />',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2" /><path d="M21 10.5v3" /><path d="M11.5 9l-2.2 3.2h3.4L10.5 15" />',
  look: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" />',
};

/** An inline SVG element's markup for a ping icon. */
export function pingIconSvg(kind: PingKind, size = 24): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PING_ICONS[kind]}</svg>`;
}
