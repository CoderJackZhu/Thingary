/** Bring the matching message container into view, respecting the topmost open dialog. */
export function revealNotice(message: string, root: ParentNode = document, selector = '.notice') {
  const dialogs = root.querySelectorAll('dialog[open]');
  const scope = dialogs.length ? dialogs[dialogs.length - 1] : root;
  Array.from(scope.querySelectorAll(selector)).find(n => n.textContent?.includes(message))?.scrollIntoView({ block: 'nearest' });
}
