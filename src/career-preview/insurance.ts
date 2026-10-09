import type { CareerPension } from '../plan-career-contract.ts';

export type InsuranceSelection = {
  method: '' | 'pause' | 'self' | 'employer';
  base: 'floor' | 'original' | 'custom';
  custom: string;
  hpf: 'original' | 'none' | 'custom';
  hpfCustom: string;
};
export const blankInsuranceSelection = (): InsuranceSelection => ({ method: '', base: 'floor', custom: '', hpf: 'none', hpfCustom: '' });

/** Base selection never changes the independently chosen housing-fund arrangement.
 * Keep entered invalid values so the evaluator, including exploratory mode, rejects them. */
export function selectedPension(form: InsuranceSelection, floor: string, originalBase: string | null, originalHpf: string | null): CareerPension | null {
  if (!form.method) return null;
  if (form.method === 'pause') return 'pause';
  const base = form.base === 'floor' ? floor : form.base === 'original' ? originalBase : form.custom;
  if (base === null || base === '') return null;
  const hpf = form.hpf === 'none' ? '0' : form.hpf === 'original' ? originalHpf : form.hpfCustom;
  return { base_cents: base, hpf_monthly_cents: hpf ?? '' };
}
