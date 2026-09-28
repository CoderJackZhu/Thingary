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
