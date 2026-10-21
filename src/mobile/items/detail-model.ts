import { costs, type AssetRecord } from '../../asset.ts';
import { goalProgress, retiredOn } from '../../preferences.ts';
import { lifecycleError, revokeError, type LifecycleAction } from '../../lifecycle.ts';
import { maintenanceChange, validateMaintenance, type MaintenanceDraft } from '../../maintenance.ts';
import { saleAction, saleError, type SaleDraft } from '../../sales.ts';
import { validateWarranty, warrantyChange, type WarrantyDraft } from '../../warranty.ts';

/** Values for the mobile goal tile; all progress and holding rules stay in the shared domain modules. */
export function detailGoal(record: AssetRecord) {
  const p = record.preferences;
  if (!p || p.goal.mode === 'none') return null;
  const frozen = retiredOn(record.lifecycle);
  const held = frozen ? costs(record.asset, frozen).days : record.costs.held_days;
  const cost = record.sale ? record.costs.net_cost_cents : record.costs.total_investment_cents;
  return { frozen, progress: record.costs.unknown_maintenance_count ? null : goalProgress(p, cost, held, record.asset.purchase_date) };
}
/** CurrencyInput exposes integer minor units; legacy domain drafts expect decimal yuan text. */
export function decimalFromMinor(value: string): string {
  if (!value) return '';
  const n = BigInt(value);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`;
}
export function minorFromDecimal(value: string): string {
  if (!value) return '';
  const [whole, fraction = ''] = value.split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
export function detailWarrantyInput(record: AssetRecord, generation: string, fields: WarrantyDraft, id?: string) {
  const issue = validateWarranty(fields); if (issue) throw new Error(issue);
  return warrantyChange(record, generation, fields, id);
}
export function detailMaintenanceInput(record: AssetRecord, generation: string, fields: MaintenanceDraft, today: string, id?: string) {
  const issue = validateMaintenance(fields, record, today); if (issue) throw new Error(issue);
  return maintenanceChange(record, generation, fields, id);
}
export function detailSaleInput(draft: SaleDraft, today: string) {
  const issue = saleError(draft, today); if (issue) throw new Error(issue);
  return { request_id: crypto.randomUUID(), generation: draft.generation, asset_id: draft.record.asset.id, expected_revision: draft.record.asset.revision, action: saleAction(draft) };
}
export function detailLifecycleInput(record: AssetRecord, generation: string, action: LifecycleAction, today: string, revoke = false) {
  const issue = revoke && action.type === 'correct_date' ? revokeError(record, action.event_id) : lifecycleError(record, action, today);
  if (issue) throw new Error(issue);
  return { request_id: crypto.randomUUID(), generation, asset_id: record.asset.id, expected_revision: record.asset.revision, action: revoke && action.type === 'correct_date' ? { type: 'revoke' as const, event_id: action.event_id } : action };
}
