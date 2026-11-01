/** Delete errors land in a notice at the bottom of a scrolling dialog; bring the one showing `message` into view. */
export function revealNotice(message: string, root: ParentNode = document) {
  const dialogs = root.querySelectorAll('dialog[open]');
  const scope = dialogs.length ? dialogs[dialogs.length - 1] : root;
  Array.from(scope.querySelectorAll('.notice')).find(n => n.textContent?.includes(message))?.scrollIntoView({ block: 'nearest' });
}
