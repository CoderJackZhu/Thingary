export type UpdateSource = 'gitee' | 'github';
export type UpdateRelease = { version: string; published_at: string; notes: string; sources: UpdateSource[] };
export type UpdateOutcome = { current: string; latest: UpdateRelease | null; update_available: boolean; unreachable: UpdateSource[] };

export const sourceLabel: Record<UpdateSource, string> = { gitee: 'Gitee', github: 'GitHub' };
const day = (stamp: string) => stamp.slice(0, 10);

/** One line for the result; the card adds notes and actions around it. */
export function updateSummary(o: UpdateOutcome): string {
  let line: string;
  if (!o.latest) line = `没有找到已发布的版本。当前版本 ${o.current}。`;
  else if (o.update_available) line = `发现新版本 ${o.latest.version}${o.latest.published_at ? `（${day(o.latest.published_at)} 发布）` : ''}，当前版本 ${o.current}。`;
  else line = o.latest.version === o.current
    ? `已是最新版本（${o.current}）。`
    : `当前版本 ${o.current} 高于已发布的最新版本 ${o.latest.version}，可能是开发版本。`;
  // A mirror that could not be read may hold something newer, so say so.
  return o.unreachable.length ? `${line}（未能连接 ${o.unreachable.map(s => sourceLabel[s]).join('、')}，结果只来自其余来源，可能不是最新。）` : line;
}
