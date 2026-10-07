// Linked-subscription types and helpers (EXPENSE_OVERVIEW_SUBSCRIPTION_LINKS_DESIGN).
// The backend owns every transaction; the UI only reads previews and submits
// one command per operation.
import { invoke } from '@tauri-apps/api/core';
import type { PlanFields } from './recurring';
import type { VirtualFields, ReminderState } from './virtual';

export type LinkRelation =
  | 'linked'
  | 'asset_trashed'
  | 'plan_trashed'
  | 'both_trashed'
  | 'group_deleted'
  | 'plan_occupied'
  | 'unlinked';

export type LinkAssetRef = { id: string; name: string; revision: number; deleted: boolean; billing: string; stopped_on: string | null };
export type LinkPlanRef = { id: string; name: string; revision: number; deleted: boolean; category: string; end_date: string | null; auto_renew: boolean; paused: boolean; service_start: string | null };
export type LinkCandidate = { id: string; name: string; deleted_at: string; revision: number };
export type LinkGroupRef = { id: string; status: string };

export type LinkView = {
  generation: string;
  relation: LinkRelation;
  asset: LinkAssetRef | null;
  plan: LinkPlanRef | null;
  paid_count: number;
  skipped_count: number;
  paid_cents: string | null;
  paid_until: string | null;
  needs_review: boolean;
  occupied_by: { id: string; name: string } | null;
  candidates: LinkCandidate[];
  group: LinkGroupRef | null;
  reminder: ReminderState | null;
};

export type LinkPreview = {
  generation: string;
  preview: string;
  asset_id: string;
  plan_id: string;
  asset_name: string;
  plan_name: string;
  asset_revision: number;
  plan_revision: number;
  paid_count: number;
  skipped_count: number;
  paid_cents: string;
  blockers: string[];
  partner_deleted: boolean;
};

export type LinkPurgePreview = {
  generation: string;
  preview: string;
  group_id: string;
  asset_name: string;
  plan_name: string;
  payments_total: number;
  payments_live: number;
  payments_deleted: number;
  rate_segments: number;
  rule_segments: number;
  period_ends: number;
  reminders: number;
  external_refs: string[];
  blockers: string[];
};

export type LinkRestorePreview = {
  generation: string;
  preview: string;
  group_id: string;
  asset_name: string;
  plan_name: string;
  payments_hidden: number;
  payments_stay_deleted: number;
  blockers: string[];
};

export type LinkTrashInput = {
  request_id: string;
  generation: string;
  side: 'virtual' | 'plan';
  id: string;
  partner_id?: string | null;
  asset_expected_revision: number;
  plan_expected_revision: number;
  preview: string;
};

export type LinkRestoreInput = { request_id: string; generation: string; group_id: string; preview: string };

export type LinkSaveInput = {
  request_id: string;
  generation: string;
  asset_id: string;
  asset_expected_revision: number;
  plan_id: string;
  plan_expected_revision: number;
  fields: PlanFields;
  unify_name_to?: string | null;
  billing?: { renewal_price_cents: string | null; renewal_from: string | null; special_end: import('./virtual').VirtualSave['special_end'] };
};

export type LinkCreateInput = {
  request_id: string;
  generation: string;
  plan_id: string;
  plan_expected_revision: number;
  fields: VirtualFields;
};

export type ReconcileInput = {
  request_id: string;
  generation: string;
  action: 'confirm_ended' | 'withdraw_stop' | 'register_group' | 'restore_pair';
  asset_id: string;
  plan_id: string;
  asset_expected_revision: number;
  plan_expected_revision: number;
  last_used?: string | null;
  preview?: string | null;
};

export const linkView = (kind: 'virtual' | 'plan', id: string) => invoke<LinkView>('link_view', { kind, id });
export const linkDeletePreview = (side: 'virtual' | 'plan', id: string, partnerId?: string | null) =>
  invoke<LinkPreview>('link_delete_preview', { side, id, partnerId: partnerId ?? null });
export const linkRestorePreview = (groupId: string) => invoke<LinkRestorePreview>('link_restore_preview', { groupId });

export type LinkRepairPreview = LinkPreview & { asset_deleted: boolean; plan_deleted: boolean; payments_stay_deleted: number };
export const linkRepairPreview = (side: 'virtual' | 'plan', id: string, partnerId: string | null, action: 'restore_pair' | 'register_group') => invoke<LinkRepairPreview>('link_repair_preview', { side, id, partnerId, action });
export type PurgeAllPreview = { generation: string; preview: string; groups: LinkPurgePreview[]; other_count: number };
export type Purged = { removed: number; kept: number; kept_reasons: string[] };
