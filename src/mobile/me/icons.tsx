import { Icon } from '../ui';
import type { IconName } from '../ui';

// Extra line icons for 我的 (the shared set has no lock, key or share). Same 24px grid and stroke as ui/Icon.
const extra = {
  contrast: <><circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></>,
  table: <><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M3.5 14.5h17M9 5v14"/></>,
  chat: <path d="M4 5h16v11H9l-5 4z"/>,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>,
  key: <><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></>,
  share: <><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/></>,
  download: <><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 20h14"/></>,
  sparkles: <><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></>,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6"/>,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6"/>,
  more: <><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></>,
  edit: <><path d="M4 20h4l11-11-4-4L4 16z"/></>,
} satisfies Record<string, React.ReactNode>;
export type MeIconName = IconName | keyof typeof extra;
const isExtra = (name: MeIconName): name is keyof typeof extra => Object.hasOwn(extra, name);

/** Shared icon or one of the extras above. */
export function MeIcon({ name, size = 20, strokeWidth = 1.8 }: { name: MeIconName; size?: number; strokeWidth?: number }) {
  if (!isExtra(name)) return <Icon name={name} size={size} strokeWidth={strokeWidth}/>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{extra[name]}</svg>;
}
