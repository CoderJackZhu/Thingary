export type UpdateRelease = { version: string; published_at: string; notes: string };
export type UpdateOutcome = { current: string; latest: UpdateRelease | null; update_available: boolean };

const day = (stamp: string) => stamp.slice(0, 10);

/** One line for the result; the card adds notes and actions around it. */
export function updateSummary(o: UpdateOutcome): string {
  if (!o.latest) return `没有找到已发布的版本。当前版本 ${o.current}。`;
  if (o.update_available) return `发现新版本 ${o.latest.version}${o.latest.published_at ? `（${day(o.latest.published_at)} 发布）` : ''}，当前版本 ${o.current}。`;
  return o.latest.version === o.current
    ? `已是最新版本（${o.current}）。`
    : `当前版本 ${o.current} 高于已发布的最新版本 ${o.latest.version}，可能是开发版本。`;
}
