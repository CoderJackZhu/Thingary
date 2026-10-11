// Shared primitives for the explicit-input pension policy chain.
// Domain ranges, missing-field ordering and issue messages belong to each stage.
export type PolicySource = { basis: 'verified' | 'assumption'; source: string };

export const validMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value);
export const monthIndex = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
export const money = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value));
export const validSource = (value: PolicySource | null | undefined) =>
  !!value && ['verified', 'assumption'].includes(value.basis) && typeof value.source === 'string' && !!value.source.trim();
export const sourceCopy = (value: PolicySource): PolicySource => ({ basis: value.basis, source: value.source });
