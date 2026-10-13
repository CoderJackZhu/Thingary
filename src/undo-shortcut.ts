/**
 * Where ⌘Z goes. The native 撤销 menu item asks the page: a text field keeps
 * its own text undo; otherwise an offered deletion undo runs, unless a form
 * or dialog is open.
 */
export function undoTarget(active: unknown, formOpen: boolean, offered: boolean): 'text' | 'deletion' | null {
  const el = active as { closest?: (s: string) => unknown; isContentEditable?: boolean } | null;
  if (el?.isContentEditable || el?.closest?.('input,textarea,[contenteditable="true"]')) return 'text';
  return offered && !formOpen ? 'deletion' : null;
}


/** Platform details stay in the frontend; no library or IPC state is involved. */
export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
export function modKey(mac = isMac): string { return mac ? '⌘' : 'Ctrl+'; }
export function shiftModKey(mac = isMac): string { return mac ? '⌘⇧' : 'Ctrl+Shift+'; }
export function selectionModifier(event: { metaKey: boolean; ctrlKey: boolean }, mac = isMac): boolean {
  // On macOS Control-click belongs to the system context menu.
  return mac ? event.metaKey : event.ctrlKey;
}
export function composing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return !!event.isComposing || event.keyCode === 229;
}

export type ShortcutEvent = {
  key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
  isComposing?: boolean; keyCode?: number; repeat?: boolean; defaultPrevented?: boolean;
  target?: unknown; preventDefault: () => void;
};
/** Same action IDs as the native menu. Native text editing retains its own keys. */
export function desktopShortcutAction(event: ShortcutEvent, mac = isMac): string | null {
  if (event.defaultPrevented || event.repeat || composing(event) || event.altKey) return null;
  if (mac ? (!event.metaKey || event.ctrlKey) : (!event.ctrlKey || event.metaKey)) return null;
  if (undoTarget(event.target, false, false) === 'text') return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 'f' ? 'global-search' : key === 'd' ? 'toggle-appearance' : null;
  return ({ n: 'new-asset', f: 'find-asset', e: 'edit-asset', ',': 'open-settings', z: 'undo', a: 'select-all' } as Record<string, string>)[key] ?? null;
}

/** Windows sends the same asset-action intent as the macOS menu, using the
 * current page labels and the shared edit/dialog guard before dispatch. */
export function handleDesktopShortcut(event: ShortcutEvent, menu: { newLabel: string | null; findLabel: string | null; blocked: boolean; dialogOpen: boolean }, dispatch: (action: string) => void, mac = isMac): boolean {
  if (mac) return false; // Native accelerators own macOS, so a key cannot run twice.
  const action = desktopShortcutAction(event, mac);
  if (!action) return false;
  if (action !== 'toggle-appearance' && (menu.blocked || menu.dialogOpen)) return false;
  if ((action === 'new-asset' && menu.newLabel === null) || (action === 'find-asset' && menu.findLabel === null)) return false;
  event.preventDefault(); dispatch(action); return true;
}

/** Keep native cut/copy/paste menus for editable fields, including descendants. */
export function handleContextMenu(event: { target: unknown; preventDefault: () => void }): void {
  if (undoTarget(event.target, false, false) !== 'text') event.preventDefault();
}
