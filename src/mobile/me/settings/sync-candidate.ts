import type { SyncPullInspection } from '../../../sync/api.ts';
import type { Inspected } from '../files.ts';
import { t } from '../../../i18n.ts';

const counts = [
  'assets', 'deleted_assets', 'wishes', 'maintenances', 'warranties', 'accounts',
  'snapshots', 'expenses', 'plans', 'payments', 'virtual_assets', 'files',
] as const;
const optionalCounts = [
  'savings_goals', 'virtual_topups', 'link_groups', 'cash_movements',
  'investment_reviews', 'assumption_checks', 'import_mappings', 'import_receipts',
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Route params are primitive values. Only an inspected session's metadata crosses this boundary. */
export function syncRestoreCandidate(value: unknown): Inspected | null {
  if (typeof value !== 'string' || value.length > 32_768) return null;
  try {
    const data: unknown = JSON.parse(value);
    if (!record(data) || typeof data.token !== 'string' || !data.token.trim()
      || !count(data.version) || data.version === 0 || typeof data.device_name !== 'string'
      || !date(data.created_at) || !record(data.summary)) return null;
    const summary = data.summary;
    if (typeof summary.hash !== 'string' || !summary.hash.trim() || !date(summary.created_at)
      || !count(summary.schema) || summary.schema === 0
      || !counts.every(key => count(summary[key]))
      || !optionalCounts.every(key => summary[key] === undefined || count(summary[key]))
      || (summary.planning_conditions_reset !== undefined && typeof summary.planning_conditions_reset !== 'boolean')) return null;
    return {
      path: '',
      name: data.device_name ? t('云端快照（{device}）', { device: data.device_name }) : t('云端同步快照'),
      encrypted: false,
      token: data.token,
      summary: summary as Inspected['summary'],
    };
  } catch { return null; }
}

/** No storage, file paths or credentials: the existing Data page owns this token after navigation. */
export function syncCandidateParam(inspection: SyncPullInspection): string | null {
  const value = JSON.stringify({
    token: inspection.token, summary: inspection.summary, version: inspection.version,
    device_name: inspection.device_name, created_at: inspection.created_at,
  });
  return syncRestoreCandidate(value) ? value : null;
}
