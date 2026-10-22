import { supportsUpdateChecks } from './update-check.ts';

/** Update discovery (D5): shared display state derived from the backend's
 * machine-local preference/cache view, plus the small local markers that
 * coordinate the one-time ask. Pure logic only; the React controller lives in
 * UpdateDiscovery.tsx. */

export type UpdateConsent = 'unset' | 'enabled' | 'disabled';
export type UpdateCandidateDownload = { source: string; name: string; label: string; size: number | null };
export type UpdateCandidate = {
  version: string;
  published_at: string;
  notes: string;
  sources: string[];
  downloads: UpdateCandidateDownload[];
  confirmed_at: string;
};
export type UpdateDiscoveryState = {
  snapshot_revision?: number;
  current_version: string;
  platform_label: string;
  consent: UpdateConsent;
  preferences_status: 'ok' | 'damaged';
  preferences_problem: string | null;
  preferences_repairable?: boolean;
  preference_revision: number;
  highest_seen_version: string | null;
  ignored_version: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  candidate: UpdateCandidate | null;
  newer_unavailable: UpdateCandidate | null;
  last_unreachable: string[];
  cache_applicable: boolean;
  cache_unsaved: boolean;
  update_available: boolean;
  candidate_fresh: boolean;
  unread: boolean;
};
export type UpdateTaskResult = { origin: 'automatic' | 'manual'; applied: boolean; cancelled: boolean; error: string | null };
export type UpdateRequestResult = { decision: 'started' | 'joined' | 'skipped'; task: UpdateTaskResult | null; state: UpdateDiscoveryState };

/** Fixed display names for the two mirrors; anything else stays as-is. */
export function mirrorLabel(source: string): string {
  return source === 'gitee' ? 'Gitee' : source === 'github' ? 'GitHub' : source;
}

const parts = (stamp: string): [number, number, number, number, number] | null => {
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return [parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate(), parsed.getHours(), parsed.getMinutes()].map(pad).map(Number) as [number, number, number, number, number];
};

/** Local `YYYY-MM-DD HH:mm` for a stored UTC stamp; empty for unreadable. */
export function stampLabel(stamp: string | null): string {
  if (!stamp) return '';
  const p = parts(stamp);
  if (!p) return '';
  const [y, m, d, hh, mm] = p;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function dayLabel(stamp: string): string {
  return stamp.slice(0, 10);
}

/** Numeric X.Y.Z compare; unparseable values never count as newer. */
export function versionNewer(a: string, b: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const bits = v.split('.');
    if (bits.length !== 3) return null;
    const nums = bits.map(Number);
    if (nums.some(n => !Number.isInteger(n) || n < 0)) return null;
    return nums as [number, number, number];
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  return x[0] !== y[0] ? x[0] > y[0] : x[1] !== y[1] ? x[1] > y[1] : x[2] > y[2];
}

/** The 上次检查 line: success when known, otherwise the last attempt. */
export function lastCheckLine(state: UpdateDiscoveryState): string {
  const success = stampLabel(state.last_success_at);
  if (success) return `上次成功检查：${success}`;
  const attempt = stampLabel(state.last_attempt_at);
  return attempt ? `上次尝试检查：${attempt}（未成功）` : '';
}

export type ManualOutcome =
  | { kind: 'update'; version: string; current: string; date: string; unreachable: string[] }
  | { kind: 'latest'; current: string; unreachable: string[] }
  | { kind: 'unavailable'; version: string }
  | { kind: 'failed'; message: string };

/** What a finished manual round should say, from the shared state. */
export function manualOutcome(state: UpdateDiscoveryState, task: UpdateTaskResult | null, error: string | null): ManualOutcome {
  if (error) return { kind: 'failed', message: error };
  if (task?.cancelled) return { kind: 'failed', message: '自动检查已取消，可点击手动检查。' };
  if (task && !task.applied && task.error) return { kind: 'failed', message: task.error };
  if (state.last_unreachable.length === 2) return { kind: 'failed', message: '上次检查未能连接 Gitee 和 GitHub，请重新检查；已有发现仅供历史参考。' };
  if (state.update_available && state.candidate) {
    return {
      kind: 'update',
      version: state.candidate.version,
      current: state.current_version,
      date: dayLabel(state.candidate.published_at || state.candidate.confirmed_at),
      unreachable: state.last_unreachable,
    };
  }
  if (state.newer_unavailable) return { kind: 'unavailable', version: state.newer_unavailable.version };
  return { kind: 'latest', current: state.current_version, unreachable: state.last_unreachable };
}

export function outcomeLine(outcome: ManualOutcome): string {
  const mirrorNote = (unreachable: string[]) =>
    unreachable.length ? `（未能连接 ${unreachable.map(mirrorLabel).join('、')}，结果只来自其余来源，可能不是最新。）` : '';
  if (outcome.kind === 'update') {
    return `发现新版本 ${outcome.version}${outcome.date ? `（${outcome.date} 发布）` : ''}，当前版本 ${outcome.current}。${mirrorNote(outcome.unreachable)}`;
  }
  if (outcome.kind === 'unavailable') return `版本 ${outcome.version} 暂未提供适合当前设备的安装包。`;
  if (outcome.kind === 'latest') return `本次未发现适合当前设备的新版本（当前 ${outcome.current}）。${mirrorNote(outcome.unreachable)}`;
  return outcome.message;
}

export const autoCheckHint = '开启后，打开物谱时每天最多查询一次公开版本列表，不上传你的资料。下载和安装由你决定。';
export const inviteTitle = '自动发现新版本？';
export const inviteBody = '开启后，打开物谱时每天最多查询一次公开版本列表，不上传你的资料，下载和安装仍由你决定。';

// --- One-time ask, machine-local like the reminder ask ----------------------

export function updateInviteVisible(
  state: UpdateDiscoveryState | null,
  environment: { asked: boolean; hasRecords: boolean; demoActive: boolean; busy: boolean; idle?: boolean },
): boolean {
  if (!state || !supportsUpdateChecks(state.platform_label)) return false;
  return (
    !environment.asked &&
    !environment.demoActive &&
    environment.hasRecords &&
    !environment.busy &&
    environment.idle !== false &&
    state.consent === 'unset' &&
    state.preferences_status === 'ok'
  );
}

// --- Startup scheduling ------------------------------------------------------

/** The controller's gate before asking the backend (which re-checks consent,
 * the per-process budget and the 24-hour interval). */
export function autoCheckScheduled(
  state: UpdateDiscoveryState | null,
  environment: { idle: boolean; unlocked: boolean; checkedThisSession: boolean },
): boolean {
  return !!state && supportsUpdateChecks(state.platform_label) && !environment.checkedThisSession && environment.idle && environment.unlocked && state.consent === 'enabled';
}

/** Milliseconds of calm first-screen time before the automatic request. */
export const autoCheckDelayMs = 5_000;
