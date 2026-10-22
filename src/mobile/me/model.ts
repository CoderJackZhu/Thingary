// Pure projections for the 我的 pages (summary, timeline grouping, restore summary, backup reminder).
// Business facts come from the desktop commands; this file only formats and groups them.
import { moduleList } from '../../modules.ts';
import type { Modules } from '../../modules.ts';
import { localDay } from '../../asset.ts';
import { dayLabel, moneyText, monthLabel } from '../format.ts';
import type { Mode, Style } from '../../appearance.ts';
import { styles } from '../../appearance.ts';
import type { AutoBackupStatus } from '../../auto-backup-format.ts';
import type { TimelineEvent } from '../../Timeline.tsx';
import { t } from '../../i18n.ts';
/** Settings sub-pages open as `me.settings` with `{ page }`; the title is also the back label of the next page. */
export type SettingsPage = 'modules' | 'appearance' | 'options' | 'materials' | 'checkin' | 'notifications' | 'privacy' | 'trash' | 'export' | 'demo' | 'about' | 'feedback' | 'license';
export const settingsTitles: Record<SettingsPage, string> = {
  modules: '功能模块', appearance: '外观', options: '选项管理', materials: '素材库', checkin: '盘点提醒', notifications: '通知', privacy: '隐私',
  trash: '最近删除', export: '导出表格', demo: '样例体验', about: '关于与帮助', feedback: '反馈问题', license: '开源许可',
};
export const isSettingsPage = (value: unknown): value is SettingsPage => typeof value === 'string' && Object.hasOwn(settingsTitles, value);

export const enabledModuleCount = (modules: Modules): number => moduleList.filter(([key]) => modules[key]).length;
export const appearanceSummary = (style: Style, mode: Mode): string => `${styles.find(item => item.value === style)?.label ?? '柔和卡片'} · ${mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}`;

/** 完整备份提醒：本机记录的上次完整备份（手动备份并分享成功时写入）；资料很久没有备份时提醒。 */
export const backupReminderDays = 30;
export const lastBackupKey = 'thingary.mobile-last-backup.v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function readLastBackup(storage: Store | null): string | null {
  try { const value = storage?.getItem(lastBackupKey) ?? null; return value && !Number.isNaN(Date.parse(value)) ? value : null; } catch { return null; }
}
export function writeLastBackup(storage: Store | null, at: Date): boolean {
  try { if (!storage) return false; storage.setItem(lastBackupKey, at.toISOString()); return true; } catch { return false; }
}
const dayMs = 86400000;
export type BackupReminder = { tone: 'positive' | 'warn'; text: string; daysAgo: number | null };
export function backupReminder(last: string | null, now: Date, hasRecords: boolean): BackupReminder {
  if (!last) return { tone: hasRecords ? 'warn' : 'positive', text: hasRecords ? t('还没有做过完整备份。手机丢失或损坏时，没有备份就找不回资料。') : t('开始记录后，别忘了做一次完整备份。'), daysAgo: null };
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(last)) / dayMs));
  const when = new Date(last);
  const date = dayLabel(localDay(when), localDay(now));
  if (days >= backupReminderDays) return { tone: 'warn', text: t('{date}做过完整备份，已过去 {days} 天，建议再备份一次。', { date, days }), daysAgo: days };
  const next = new Date(when.getTime() + backupReminderDays * dayMs);
  return { tone: 'positive', text: t('{date}已完整备份。下次提醒 {v2}。', { date, v2: dayLabel(localDay(next), localDay(now)) }), daysAgo: days };
}
export const daysAgoText = (days: number | null): string => days === null ? '未备份' : days === 0 ? '今天' : `${days} 天前`;

// --- 时间轴 ---------------------------------------------------------------------------------------
/** 月合计里的「支出」：购入、维护、重要支出、周期付款与虚拟资产价格计入，退款冲减；盘点、心愿预计价格、售出不计入。 */
const spendKinds = new Set(['purchase', 'maintenance', 'expense', 'payment', 'virtual']);
export type MonthGroup = { key: string; title: string; events: TimelineEvent[]; spendingCents: string; unknownCount: number };
export function monthTitle(key: string, today?: string): string { return monthLabel(key, today); }
export function groupByMonth(events: TimelineEvent[], today?: string): MonthGroup[] {
  const groups: MonthGroup[] = [], totals = new Map<string, bigint>();
  for (const event of events) {
    if (!event.date) continue;
    const key = event.date.slice(0, 7);
    let group = groups.find(item => item.key === key);
    if (!group) { group = { key, title: monthTitle(key, today), events: [], spendingCents: '0', unknownCount: 0 }; groups.push(group); totals.set(key, 0n); }
    group.events.push(event);
    const spends = spendKinds.has(event.kind) || event.kind === 'refund';
    if (!spends) continue;
    if (event.amount_cents === null) { group.unknownCount++; continue; }
    totals.set(key, totals.get(key)! + (event.kind === 'refund' ? -1n : 1n) * BigInt(event.amount_cents));
  }
  for (const group of groups) group.spendingCents = totals.get(group.key)!.toString();
  return groups;
}
export const monthSpendingText = (group: MonthGroup, current: string): string => {
  const unknown = group.unknownCount ? `（${group.unknownCount} 笔金额未知）` : '';
  return `${group.key === current ? '本月' : '当月'}支出 ${moneyText(group.spendingCents)}${unknown}`;
};
export const monthsPerStep = 3;

// --- 搜索 -----------------------------------------------------------------------------------------
/** 关键词校验沿用桌面搜索面板：最多 200 个字符，不能含空字符。 */
export function keywordError(keyword: string): string | null {
  const value = keyword.trim();
  if ([...value].length > 200) return '关键词最多 200 个字符，请缩短后重新搜索。';
  if (value.includes('\0')) return '关键词不能包含空字符。';
  return null;
}

// --- 从备份恢复 ------------------------------------------------------------------------------------
export type BackupSummary = { savings_goals?: number; planning_conditions_reset?: boolean; hash: string; created_at: string; schema: number; assets: number; deleted_assets: number; wishes: number; maintenances: number; warranties: number; accounts: number; snapshots: number; expenses: number; plans: number; payments: number; virtual_assets: number; import_mappings?: number; import_receipts?: number; files: number };
/** 检查摘要：与桌面「用…替换当前全部资料？」确认里的同一组计数。 */
export function restoreLines(summary: BackupSummary): string[] {
  return [
    `物品 ${summary.assets} 件（其中最近删除 ${summary.deleted_assets}）`, `心愿 ${summary.wishes} 条`, `维护 ${summary.maintenances} 条`, `保障 ${summary.warranties} 份`,
    `账户 ${summary.accounts} 个`, `存钱目标 ${summary.savings_goals ?? 0} 个`, `盘点 ${summary.snapshots} 次`, `支出 ${summary.expenses} 笔`, `周期计划 ${summary.plans} 项`,
    `周期付款 ${summary.payments} 条`, `虚拟资产 ${summary.virtual_assets} 件`, `导入映射 ${summary.import_mappings ?? 0} 条`, `导入回执 ${summary.import_receipts ?? 0} 份`, `原图 ${summary.files} 个`,
  ];
}
export const restoreTime = (summary: BackupSummary): string => new Date(summary.created_at).toLocaleString('zh-CN');

/** 自动备份列表：今天／昨天／日期 + 时间。 */
export function autoBackupLabel(item: AutoBackupStatus['items'][number], today: string): { title: string; sub: string } {
  const encrypted = item.name.endsWith('.thingary.age');
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - dayMs).toISOString().slice(0, 10);
  const when = item.date === today ? '今天' : item.date === yesterday ? '昨天' : dayLabel(item.date, today);
  const time = item.name.match(/-(\d{2})(\d{2})-[0-9a-f]{6}\.thingary/);
  return { title: time ? `${when} ${time[1]}:${time[2]}` : when, sub: encrypted ? '已加密' : '' };
}

// --- 恢复后清理本机暂存 -----------------------------------------------------------------------------
/** UI preferences that belong to the phone, not to the library: they survive a restore. */
const restoreKeepKeys = new Set(['thingary.theme', 'thingary.style', 'thingary.privacy-cover.v1', 'thingary.privacy-lock.v1', lastBackupKey, 'thingary.hide-financial-amounts.v1', 'thingary.item-import-pending.v1']);
/** Local work belongs to one library generation, so a restore clears drafts and requests; preferences stay. */
export function restoreClearKeys(keys: string[]): string[] {
  return keys.filter(key => key.startsWith('thingary.') && !restoreKeepKeys.has(key));
}
/** How many left-over drafts or unchecked requests a restore will invalidate. */
export const countLocalWork = (keys: string[]): number => keys.filter(key => /draft|request|abandon|upload/.test(key)).length;

/**
 * 时间轴一行的说明文字：电脑端 eventDetail 把金额写进了文字，手机行右侧已经显示金额，
 * 所以已知金额只留「实付」「退回」这样的标签；「待补充」按手机约定写成「未知」。
 */
export function timelineDetail(detail: string, event: Pick<TimelineEvent, 'kind' | 'amount_cents'>): string {
  const text = detail.replace(/待补充/g, '未知');
  if (event.kind === 'snapshot' || event.amount_cents === null) return text;
  return text.split(' · ').map(part => part.replace(/\s*[−-]?\u2060?¥[\d,]+(?:\.\d+)?$/, '')).filter(Boolean).join(' · ');
}
