import type { KeyboardEvent } from 'react';

export function moveAssetFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const rows = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.asset-row:not(:disabled)') ?? [])];
  if (!rows.length) return;
  const index = rows.indexOf(event.currentTarget);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
  event.preventDefault();
  rows[next].focus();
}
