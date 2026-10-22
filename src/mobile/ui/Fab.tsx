import type { ReactNode } from 'react';
import { useCovered } from '../nav-context';
import { Icon } from './Icon';
import type { IconName } from './Icon';

/**
 * Floating action button for a tab's main "new" action: bottom right, above the floating tab bar and the safe area.
 * `label` is its accessible name. Pass `hidden` while the page is busy with something else (selecting rows);
 * it also steps aside by itself while a modal or sheet is open. Give the page about 76px of bottom padding so the last rows stay reachable.
 */
export function Fab({ label, onClick, icon = 'plus', hidden, disabled, children, text }: { label: string; onClick: () => void; icon?: IconName; hidden?: boolean; disabled?: boolean; children?: ReactNode; /** Visible words next to the icon (a pill instead of a circle), for actions that are not obvious from a bare + such as 盘点 or 新增账户. */ text?: string }) {
  const covered = useCovered();
  if (hidden || covered) return null;
  return <button type="button" className={`m-fab${text ? ' m-fab-text' : ''}`} aria-label={label} disabled={disabled} onClick={onClick}>{children ?? (text ? <><Icon name={icon} size={20} strokeWidth={2.4}/><span>{text}</span></> : <Icon name={icon} size={24} strokeWidth={2.4}/>)}</button>;
}
