/** Brand, model and serial number are the only fields folded away in the item form. */
export function supplementalField(key: string) {
  return ['brand', 'model', 'serial_number'].includes(key);
}

/** The fold starts open as soon as any of its fields already has a value (editing, drafts, conversions). */
export function identityFoldOpen(fields: Partial<Record<string, string>>) {
  return ['brand', 'model', 'serial_number'].some(key => !!fields[key]?.trim());
}
