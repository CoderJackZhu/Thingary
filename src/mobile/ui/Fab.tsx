import type { ReactNode } from 'react';
import { useCovered } from '../nav-context';
import { Icon } from './Icon';
import type { IconName } from './Icon';

/**
 * Floating action button for a tab's main "new" action: bottom right, above the floating tab bar and the safe area.
 * `label` is its accessible name. Pass `hidden` while the page is busy with something else (selecting rows);
 * it also steps aside by itself while a modal or sheet is open. Give the page about 76px of bottom padding so the last rows stay reachable.
 */
export function Fab({ label, onClick, icon = 'plus', hidden, disabled, children }: { label: string; onClick: () => void; icon?: IconName; hidden?: boolean; disabled?: boolean; children?: ReactNode }) {
  const covered = useCovered();
  if (hidden || covered) return null;
  return <button type="button" className="m-fab" aria-label={label} disabled={disabled} onClick={onClick}>{children ?? <Icon name={icon} size={24} strokeWidth={2.4}/>}</button>;
}
