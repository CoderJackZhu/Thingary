import type { ReactNode } from 'react';

/** Small line icons used only by the item form and item detail; the shared Icon set stays untouched. */
const paths = {
  swap: <path d="M4 8h14l-4-4M20 16H6l4 4"/>,
  pencil: <><path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14.5 6l3 3"/></>,
  imagePlus: <><path d="M13 4.5H6a2 2 0 0 0-2 2V17a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/><circle cx="9" cy="10" r="1.6"/><path d="M19 15l-4-4-7 7M19 3v6M16 6h6"/></>,
  wrench: <path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-2 2-1.5-1.5-8 8a2 2 0 0 1-3-3l8-8L13 9l-1.5-1.5 2-2z"/>,
  shieldPlus: <><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M12 9v6M9 12h6"/></>,
  archive: <><rect x="3.5" y="4" width="17" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></>,
  sell: <><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/></>,
  undo: <><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>,
} satisfies Record<string, ReactNode>;
export type GlyphName = keyof typeof paths;
export function Glyph({ name, size = 22, strokeWidth = 1.8 }: { name: GlyphName; size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
