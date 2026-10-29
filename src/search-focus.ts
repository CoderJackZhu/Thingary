const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

type TabEvent = {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
};

/** Keep Tab inside a native dialog when macOS does not focus its mouse opener. */
export function keepTabInDialog(dialog: HTMLDialogElement | null, event: TabEvent) {
  if (!dialog?.open || event.key !== 'Tab') return false;
  const items = [...dialog.querySelectorAll<HTMLElement>(focusable)]
    .filter(element => !element.closest?.('[aria-hidden="true"]'));
  if (!items.length) {
    event.preventDefault();
    dialog.focus();
    return true;
  }
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index === -1) {
    event.preventDefault();
    items[event.shiftKey ? items.length - 1 : 0].focus();
  } else if (event.shiftKey && index === 0) {
    event.preventDefault();
    items[items.length - 1].focus();
  } else if (!event.shiftKey && index === items.length - 1) {
    event.preventDefault();
    items[0].focus();
  } else {
    return false;
  }
  return true;
}
