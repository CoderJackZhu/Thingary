// Pure projections for the 总览 page. All facts come from the desktop commands (review_overview, list_assets,
// list_wishlist); nothing here recomputes money, plans or statuses beyond the desktop rules it calls.
import { hiddenKinds } from '../../modules.ts';
import type { Modules } from '../../modules.ts';
import { paymentReminders } from '../../recurring.ts';
import { deriveStatus } from '../../warranty.ts';
import { compactYuan } from '../../plan-view.ts';
import { monthsLeftText } from '../../plan-fire.ts';
import { dayLabel, moneyText, signedMoneyText, unitMoneyText } from '../format.ts';
import type { Review } from '../../review.ts';
import { latestComplete, ready } from '../../review.ts';
import type { SummaryRetire } from '../../plan-summary.ts';
import type { Summary } from '../../wealth.ts';
import type { DailyCostSummary } from '../../DailyCostMetric.tsx';
import type { TimelineEvent } from '../../Timeline.tsx';
import type { Params, RouteName } from '../routes.ts';
import { dayText, daysBetween, eventTarget, mask } from '../me/shared.ts';

export type PlanProgress = { percent: number; have: string; need: string; gap: string | null };
/** `lead` 是一句话：before + 强调的时长 + after；没有时长时只有 before。 */
export type Hero = { state: 'ready' | 'setup' | 'blocked' | 'error'; eyebrow: string; title: string; subtitle: string | null; lead: { before: string; strong: string; after: string } | null; progress: PlanProgress | null; warn: string | null };

const plain = (state: Hero['state'], title: string, subtitle: string | null, eyebrow = '退休规划'): Hero => ({ state, eyebrow, title, subtitle, lead: null, progress: null, warn: null });

/**
 * 规划卡：用「还要上班约 N 年 M 个月」说时间，用金额进度条说差多少。FIRE 用 fi_month 距今月数，传统退休用目标退休月。
 * Same ready/blocked/error split as the desktop 规划 summary (plan-summary.summaryRetire). Amounts follow 隐藏金额.
 */
export function planView(retire: SummaryRetire, hidden = false): Hero {
  if (retire.kind === 'loading') return plain('blocked', '正在读取…', null);
  if (retire.kind === 'error') return plain('error', '退休估算暂时读不出来', retire.message);
  if (retire.kind === 'blocked') {
    if (retire.step === 'profile') return plain('setup', '设好规划，看看还要上几年班', null);
    return plain('blocked', retire.main, retire.note);
  }
  const calc = retire.calc, plan = calc.plan, fire = retire.mode === 'fire';
  const month = fire ? calc.proj.fi_month : plan.target_months;
  const left = month === null ? null : month - plan.now_months;
  let title: string, lead: Hero['lead'] = null;
  if (left === null) title = retire.headline.main;
  else if (left <= 0) title = fire ? '当前资产已够退休所需' : '已到目标退休时间';
  else { title = ''; lead = { before: fire ? '按现在的节奏，还要上班 约 ' : '距离计划退休，还要上班 约 ', strong: monthsLeftText(left), after: '' }; }
  const { assets, requiredNow, percent } = retire.coverage;
  const gap = requiredNow - assets;
  const progress: PlanProgress = {
    percent: Math.max(0, Math.min(100, percent / 100)),
    have: mask(`已有 ${compactYuan(assets)}`, hidden), need: mask(`现在退休约需 ${compactYuan(requiredNow)}`, hidden),
    gap: gap > 0 ? mask(`还差约 ${compactYuan(gap)}`, hidden) : null,
  };
  return { state: 'ready', eyebrow: '退休规划', title, subtitle: null, lead, progress, warn: retire.headline.warn };
}

export type NetWorthView =
  | { state: 'unknown' }
  | { state: 'known'; net: string; date: string; incomplete: string | null; change: string | null; changeTone: 'positive' | 'danger' | null; values: (number | null)[]; dates: string[]; summary: string };
/** 金融净资产：最近一次完整盘点；最新盘点不完整时沿用它并提示缺几个账户。没有完整盘点时净资产未知，不当作零。 */
export function netWorthView(summary: Summary, hidden: boolean): NetWorthView {
  const latest = latestComplete(summary.points), last = summary.points.at(-1);
  if (!latest) return { state: 'unknown' };
  const complete = summary.points.filter(point => point.complete).slice(-12);
  let change: string | null = null, tone: 'positive' | 'danger' | null = null;
  if (latest.scope_changed) change = '账户范围有变化，较上次不可比';
  else if (latest.change_cents !== null && latest.compared_to) {
    const cents = Number(latest.change_cents);
    change = cents === 0 ? '较上次持平' : `较上次 ${mask(signedMoneyText(cents), hidden)}`;
    tone = hidden || cents === 0 ? null : cents > 0 ? 'positive' : 'danger';
  }
  const net = Number(latest.net_cents);
  const text = hidden ? `金融净资产已隐藏，共 ${complete.length} 次完整盘点。` : `金融净资产 ${moneyText(net)}，截至 ${dayText(latest.date)}，共 ${complete.length} 次完整盘点${change ? '，' + change : ''}。`;
  return {
    state: 'known', net: mask(moneyText(net), hidden), date: latest.date,
    incomplete: last && !last.complete ? `${dayText(last.date)} 的盘点缺 ${last.missing} 个账户，当前显示 ${dayText(latest.date)} 的完整盘点` : null,
    change, changeTone: tone, values: complete.map(point => Number(point.net_cents)), dates: complete.map(point => point.date), summary: text,
  };
}

export type DailyView = { value: string; unknown: boolean; sub: string; note: string };
/** 物品日均成本：沿用 DailyCostMetric 的计入／资料不全／按次／排除说明。 */
export function dailyView(summary: DailyCostSummary): DailyView {
  const notes = [`${summary.included_count} 件计入`];
  if (summary.unknown_count) notes.push(`${summary.unknown_count} 件资料不全`);
  if (summary.per_use_count) notes.push(`${summary.per_use_count} 件按次计费`);
  if (summary.excluded_count) notes.push(`${summary.excluded_count} 件已排除`);
  if (summary.unknown_count > 0 && summary.included_count > 0) notes.push('仅已知部分');
  return { value: summary.known_cents === null ? '—' : unitMoneyText(summary.known_cents), unknown: summary.known_cents === null, sub: notes.join(' · '), note: '持有成本摊算，不是每天实际付款；账户、订阅和房租不参与。' };
}

/** Warranty facts for the 待处理 list: desktop `list_assets` with the 即将到期 filter, status per desktop deriveStatus. */
export type WarrantyAlert = { count: number; first: { id: string; name: string; end: string; days: number } | null };
export function warrantyAlert(page: { total: number; items: { asset: { id: string; name: string }; warranties?: { fields: { start_date: string | null; end_date: string | null } }[] }[] }, today: string): WarrantyAlert {
  let first: WarrantyAlert['first'] = null;
  for (const record of page.items) for (const warranty of record.warranties ?? []) {
    const { status, remaining_days } = deriveStatus(warranty.fields.start_date, warranty.fields.end_date, today);
    if (status !== 'expiring' || remaining_days === null || !warranty.fields.end_date) continue;
    if (!first || warranty.fields.end_date < first.end) first = { id: record.asset.id, name: record.asset.name, end: warranty.fields.end_date, days: remaining_days };
  }
  return { count: page.total, first };
}

export type WishDue = { id: string; name: string; target_date: string | null; decision_state: string };
/** 心愿计划日期已过：考虑中且填了计划日期、日期早于今天（规划不再计入这笔支出）。 */
export function overdueWishes(wishes: WishDue[], today: string): WishDue[] {
  return wishes.filter(wish => wish.decision_state === 'considering' && !!wish.target_date && wish.target_date < today).sort((a, b) => a.target_date!.localeCompare(b.target_date!));
}

export type PendingEntry = { id: string; icon: 'shield' | 'calendar' | 'doc' | 'heart' | 'warning'; tone: 'warn' | 'accent' | 'danger' | 'positive'; title: string; subtitle: string; route: RouteName; params?: Params; action?: string };
export type PendingSources = { today: string; modules: Modules; review: Review | null; warranty: WarrantyAlert | null; wishes: WishDue[] | null };

const relative = (today: string, date: string) => { const n = daysBetween(today, date); return n === 0 ? '今天' : n > 0 ? `${n} 天后` : `已过 ${-n} 天`; };

/** 保修快到期、周期付款到期、本月未盘点、心愿计划日期已过（再加桌面「待关注」里的盘点不完整与虚拟资产到期）。关闭的模块不出现。 */
export function pendingEntries({ today, modules, review, warranty, wishes }: PendingSources): PendingEntry[] {
  const out: PendingEntry[] = [];
  if (warranty && warranty.count > 0) {
    const first = warranty.first;
    out.push({
      id: 'warranty', icon: 'shield', tone: 'warn', title: `保修 30 天内到期 ${warranty.count} 件`,
      subtitle: first ? `${first.name} · ${dayText(first.end)}到期${warranty.count > 1 ? ` 等` : ''}` : '查看即将到期的物品',
      route: warranty.count === 1 && first ? 'items.detail' : 'items.list', params: warranty.count === 1 && first ? { id: first.id } : undefined,
    });
  }
  const recurring = modules.recurring && review ? ready(review.recurring) : undefined;
  if (recurring) {
    const reminders = paymentReminders(recurring);
    const rows = [...reminders.due.map(due => ({ due, late: true })), ...reminders.upcoming.map(due => ({ due, late: false }))].slice(0, 3);
    for (const { due, late } of rows) out.push({
      id: 'payment:' + due.plan_id + due.due_date, icon: 'calendar', tone: late ? 'danger' : 'accent', title: `${late ? '周期付款待确认' : '周期付款'} ${dayText(due.due_date)}`,
      subtitle: `${due.plan_name} ${moneyText(due.amount_cents)} · ${relative(today, due.due_date)}`, route: 'spending.recurring', params: { id: due.plan_id },
    });
  }
  const wealth = modules.wealth && review ? ready(review.wealth) : undefined;
  if (wealth) {
    const last = wealth.points.at(-1), latest = latestComplete(wealth.points);
    if (last && !last.complete) out.push({ id: 'snapshot-incomplete', icon: 'warning', tone: 'warn', title: '最新盘点尚未完整', subtitle: `${dayText(last.date)} · 缺 ${last.missing} 个账户`, route: 'wealth.snapshots', params: { id: last.snapshot_id } });
    if (!latest || latest.date.slice(0, 7) < today.slice(0, 7)) out.push({ id: 'checkin', icon: 'doc', tone: 'warn', title: '本月还没盘点', subtitle: latest ? `上次完整盘点 ${dayText(latest.date)}` : '还没有完整盘点', route: 'wealth.checkin', action: '去盘点' });
  }
  const overdue = modules.wishlist && wishes ? overdueWishes(wishes, today) : [];
  if (overdue.length) out.push({
    id: 'wish', icon: 'heart', tone: 'danger', title: `心愿计划日期已过 ${overdue.length} 条`, subtitle: `${overdue[0].name} · 计划 ${dayText(overdue[0].target_date!)}`,
    route: overdue.length === 1 ? 'wishes.detail' : 'wishes.list', params: overdue.length === 1 ? { id: overdue[0].id } : undefined,
  });
  const virtual = modules.virtual && review ? ready(review.virtual_assets) : undefined;
  if (virtual) {
    const items = virtual.items.filter(item => (item.status === 'expired' || item.status === 'expiring') && !(item.status === 'expired' && (item.fields.kind === 'subscription' || item.fields.billing === 'subscription' || item.plan?.fields.category === 'subscription')) && item.valid_until);
    if (items.length) {
      const soonest = [...items].sort((a, b) => a.valid_until!.localeCompare(b.valid_until!))[0];
      out.push({ id: 'virtual', icon: 'warning', tone: 'warn', title: `虚拟资产 ${items.length} 项权益到期或即将到期`, subtitle: `${soonest.fields.name} · ${dayText(soonest.valid_until!)}`, route: 'spending.virtual', params: items.length === 1 ? { id: soonest.id } : undefined });
    }
  }
  return out;
}

/** True when a pending source failed to read; the page then says the list may be incomplete. */
export function pendingSourcesFailed(modules: Modules, review: Review | null, warrantyFailed: boolean, wishesFailed: boolean): boolean {
  if (warrantyFailed || (modules.wishlist && wishesFailed)) return true;
  if (!review) return false;
  return (modules.wealth && review.wealth.status === 'error') || (modules.recurring && review.recurring.status === 'error') || (modules.virtual && review.virtual_assets.status === 'error');
}

export type Describe = (event: TimelineEvent) => { label: string; detail: string };
export type RecentRow = { id: string; date: string; title: string; detail: string; amount: string | null; target: { route: RouteName; params: Params } | null; kind: string; label: string };
/** 近期记录：与时间轴同一投影，关闭模块的事件隐藏；快照的金融金额跟随「隐藏金额」。 */
export function recentRows(events: TimelineEvent[], modules: Modules, describe: Describe, hiddenAmounts: boolean, limit = 5): RecentRow[] {
  const hide = hiddenKinds(modules);
  return events.filter(event => event.date && !hide.has(event.kind)).slice(0, limit).map(event => {
    const { label, detail } = describe(event);
    const snapshot = event.kind === 'snapshot';
    return {
      id: event.id, date: dayLabel(event.date!), kind: event.kind, label,
      title: snapshot ? label : `${label} · ${event.title}`,
      detail: snapshot && hiddenAmounts ? '金融金额已隐藏' : detail,
      amount: !snapshot && event.amount_cents !== null ? moneyText(event.amount_cents) : null,
      target: eventTarget(event),
    };
  });
}

