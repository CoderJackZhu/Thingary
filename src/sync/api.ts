// Typed wrappers for the sync commands (see DESIGN §6 and T1's
// src-tauri/src/sync/commands.rs). The Rust serde shapes win where the design
// document differs: config and pull inspection use snake_case, config input and
// the remote status use camelCase. No WebDAV details ever reach this layer.
import { invoke } from '@tauri-apps/api/core';

export type SyncState =
  | 'unconfigured'
  | 'up_to_date'
  | 'local_ahead'
  | 'remote_ahead'
  | 'conflict'
  | 'empty_remote';

/** `sync_config_get` — never includes the password. */
export type SyncPublicConfig = {
  enabled: boolean;
  base_url: string;
  username: string;
  base_path: string;
  device_id: string;
  device_name: string;
  has_password: boolean;
  last_synced_remote_version: number | null;
  last_synced_at: string | null;
  has_pending_push: boolean;
  has_remembered_passphrase: boolean;
  auto_check: boolean;
};

/** `sync_config_set` input; camelCase per `#[serde(rename_all = "camelCase")]`. */
export type SyncConfigInput = {
  baseUrl: string;
  username: string;
  /** Omit to keep the saved application password. */
  password?: string;
  basePath: string;
  deviceName: string;
};

export type SyncConnectionTest = {
  ok: boolean;
  supports_etag: boolean;
  free_space: number | null;
};

/** Local status is serialized without a rename: snake_case fields. */
export type SyncLocalStatus = {
  changed: boolean;
  schema: number;
  empty: boolean;
  table_counts: Record<string, number>;
};

/** Remote status uses `#[serde(rename_all = "camelCase")]`. */
export type SyncRemoteStatus = {
  version: number;
  deviceName: string;
  createdAt: string;
  schemaVersion: number;
  snapshotBytes: number;
  slowSyncWarning: boolean;
};

export type SyncStatusInput = { passphrase?: string };

export type SyncStatusResult = {
  state: SyncState;
  local: SyncLocalStatus;
  remote: SyncRemoteStatus | null;
};

export type SyncPushResult = { version: number };

/** The restore summary returned by the existing backup/restore pipeline. */
export type SyncBackupSummary = {
  hash: string;
  created_at: string;
  schema: number;
  assets: number;
  deleted_assets: number;
  wishes: number;
  maintenances: number;
  warranties: number;
  accounts: number;
  savings_goals: number;
  snapshots: number;
  expenses: number;
  plans: number;
  payments: number;
  virtual_assets: number;
  virtual_topups: number;
  link_groups: number;
  cash_movements: number;
  investment_reviews: number;
  assumption_checks: number;
  import_mappings: number;
  import_receipts: number;
  files: number;
  planning_conditions_reset: boolean;
};

/** `sync_pull_inspect` — the session token is later consumed by `restore_backup_session`. */
export type SyncPullInspection = {
  token: string;
  summary: SyncBackupSummary | null;
  version: number;
  device_name: string;
  created_at: string;
};

/** `sync_resolve_conflict` is untagged: a push result, or a pull inspection. */
export type SyncConflictResult = SyncPushResult | SyncPullInspection;

export type SyncReconcileOutcome = 'nothing_pending' | 'landed' | 'not_landed' | 'remote_changed';
/** `sync_reconcile`: read-only look at the cloud after an unconfirmed push. */
export type SyncReconcileResult = { outcome: SyncReconcileOutcome; version: number | null };

export type SyncConflictChoice = 'keep_local' | 'use_remote';

export const syncConfigGet = (): Promise<SyncPublicConfig> => invoke('sync_config_get');

export const syncConfigSet = (input: SyncConfigInput): Promise<void> =>
  invoke('sync_config_set', { input });

export const syncTestConnection = (): Promise<SyncConnectionTest> =>
  invoke('sync_test_connection');

export const syncDisable = (forgetCredentials: boolean): Promise<void> =>
  invoke('sync_disable', { input: { forgetCredentials } });

export const syncStatus = (input: SyncStatusInput = {}): Promise<SyncStatusResult> =>
  invoke('sync_status', input.passphrase ? { input } : {});

/** Establishes the 10-minute in-memory passphrase session. */
export const syncUnlock = (passphrase: string, remember = false): Promise<void> =>
  invoke('sync_unlock', { input: { passphrase, remember } });
export const syncPassphraseReveal = (): Promise<string> => invoke('sync_passphrase_reveal');
export const syncForgetPassphrase = (): Promise<void> => invoke('sync_forget_passphrase');
export const syncSetAutoCheck = (enabled: boolean): Promise<void> => invoke('sync_set_auto_check', { enabled });

/** Read-only: settles this device's unconfirmed push (landed / not landed / remote changed). */
export const syncReconcile = (): Promise<SyncReconcileResult> => invoke('sync_reconcile');

export const syncPush = (): Promise<SyncPushResult> => invoke('sync_push');

export const syncPullInspect = (): Promise<SyncPullInspection> =>
  invoke('sync_pull_inspect');

export const syncResolveConflict = (
  choice: SyncConflictChoice,
): Promise<SyncConflictResult> =>
  invoke('sync_resolve_conflict', { input: { choice } });
