// Only the development-only preview-ipc entry registers a provider. The normal
// desktop entry leaves this null; reading it never invokes IPC or networking.
import type { SyncStatusResult } from './api';
import type { SyncErrorLike } from './state';

export type SyncSettingsPreview = { status: SyncStatusResult | null; error: SyncErrorLike | null };

let provider: (() => SyncSettingsPreview | null) | null = null;

export function registerSyncSettingsPreview(value: () => SyncSettingsPreview | null) { provider = value; }
export function getSyncSettingsPreview(): SyncSettingsPreview | null { return provider?.() ?? null; }
