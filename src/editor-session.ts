// Unsubmitted input lives only in React state. Keep durable receipts solely for
// submissions whose result may need reconciliation after a crash or lost reply.
export function persistSubmission(key: string, value: {pending?: unknown; planPending?: unknown}, storage: Pick<Storage,'setItem'|'removeItem'> = localStorage) {
  if (value.pending || value.planPending) storage.setItem(key, JSON.stringify(value));
  else storage.removeItem(key);
}
export function clearUnsubmittedEditors(storage: Pick<Storage,'getItem'|'removeItem'>) {
  for (const kind of ['asset','wishlist','maintenance','warranty','sale','lifecycle']) {
    const key = `possio.${kind}-draft.v1`;
    try { const value = JSON.parse(storage.getItem(key) || 'null'); if (value && !value.pending && !value.planPending) storage.removeItem(key); } catch { storage.removeItem(key); }
  }
}
