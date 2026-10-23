import { t } from './i18n.ts';
export type UpdateSource = 'gitee' | 'github';
export type UpdateDownload = { source: UpdateSource; name: string; label: string; size: number | null };
export type UpdateRelease = { version: string; published_at: string; notes: string; sources: UpdateSource[]; downloads: UpdateDownload[] };
export type UpdateOutcome = { current: string; latest: UpdateRelease | null; update_available: boolean; unreachable: UpdateSource[]; platform: string; newer_unavailable: UpdateRelease | null };

export const sourceLabel: Record<UpdateSource, string> = { gitee: 'Gitee', github: 'GitHub' };
const day = (stamp: string) => stamp.slice(0, 10);

/** One line for the result; the card adds notes and actions around it. */
export function updateSummary(o: UpdateOutcome): string {
  let line: string;
  if (!o.latest) line = t('暂未找到适合当前设备的安装包。当前版本 {current}。', { current: o.current });
  else if (o.update_available) line = t('发现新版本 {version}{v2}，当前版本 {current}。', { version: o.latest.version, v2: o.latest.published_at ? `（${day(o.latest.published_at)} 发布）` : '', current: o.current });
  else line = o.latest.version === o.current
    ? t('当前设备已是最新可用版本（{current}）。', { current: o.current })
    : t('当前版本 {current} 高于当前设备已发布的最新版本 {version}，可能是开发版本。', { current: o.current, version: o.latest.version });
  // A mirror that could not be read may hold something newer, so say so.
  return o.unreachable.length ? `${line}（未能连接 ${o.unreachable.map(s => sourceLabel[s]).join('、')}，结果只来自其余来源，可能不是最新。）` : line;
}

/** Shared platform gate for every update entry. iOS updates belong to App Store. */
export function supportsUpdateChecks(platform: string): boolean {
  return platform.toLowerCase() !== 'ios';
}
