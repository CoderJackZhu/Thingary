import { hasLegacyPlan } from './planning-basic-view';
// Development-only in-memory stand-in for the wealth commands used by
// visual-preview. It mirrors the Rust rules loosely for demo purposes and
// proves nothing about native storage or calculation.
import type { Account, AccountSave, Compare, CompareCell, CompareEnd, CompareRow, Draft, Entry, HistoryRow, Point, Share, Snapshot, SnapshotSave, StructurePair, Summary } from './wealth';
import { assetKinds, kindLabel } from './wealth';
import { expenseCategories } from './expenses';
import { recurringCategories } from './recurring';
import { virtualKindText } from './virtual';
import type { Expense, ExpenseSave, ExpenseView, Line } from './expenses';
import type { Due, Overview, Payment, PaymentSave, Plan, PlanSave, PaymentRangeSave } from './recurring';
import type { BalanceRecord, BalanceSave, TopupFields, TopupSave, VirtualAsset, VirtualFields, VirtualKind, VirtualOverview, VirtualSave, VirtualStatus, ReminderState, ReminderSave } from './virtual';
import type { WishlistItem, WishlistPage, WishlistQuery } from './wishlist';
import type { SourceTarget, TimelineSelection } from './source';
import { coverageFor, scheduleDates, shiftDays } from './recurring-model';
import { computeReview, defaultRetire } from './plan';
import { emptyCore, eventSource, normalizeFunds } from './plan-core';
import { hasPensionProfile } from './plan';
import type { BasicCapabilities, BasicFields, CapabilityName, FundsFields, MissingCode, PensionFields, PlanningMissing, PlanningSources, ProfileUpdate } from './plan';
import { basicInputFixtures, predictionCapabilityFixture, unknownCapabilityFixture } from './plan-basic-fixtures';
import { outcome, project } from './plan-ledger';
import { allModules } from './modules';
import { retirementSources } from './planning-basic-forms';
import { bindCapabilityProvider } from './planning-basic-port';
import type { CapabilityOptions } from './planning-basic-port';
import type { Income, IncomeSave, Mark, ProfileSave, ProfileState, Reasons, StoredProfile } from './plan';
import demoAssets from './demo-assets.json';
import demoFinance from './demo-finance.json';

const generation = 'visual-fixture-only';
const params = new URLSearchParams(location.search);
const now = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shifted = (months: number, offset = 0) => {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const target = new Date(base.getFullYear(), base.getMonth() - months, 1);
  return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(base.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate())));
};
let accounts: Account[] = demoFinance.accounts.map((a, position) => ({ id: 'w-' + a.key,
  fields: { name: a.name, institution: a.institution, side: a.side as 'asset' | 'liability', kind: a.kind, counted: a.counted, opened_on: shifted(6), closed_on: null, notes: '虚构样例' }, position, revision: 1, latest: null }));
type Stored = { id: string; date: string; notes: string; revision: number; entries: Entry[] };
const entry = (a: Account, yuan: number | null): Entry => ({ account_id: a.id, state: yuan === null ? 'missing' : 'entered', amount_cents: yuan === null ? null : String(yuan * 100), side: a.fields.side, kind: a.fields.kind, counted: a.fields.counted });
let snapshots: Stored[] = demoFinance.snapshots.map((s, i) => ({ id: `w-snap-${i}`, date: shifted(s.months_ago), notes: '虚构盘点', revision: 1, entries: accounts.map((a, n) => entry(a, s.amounts_yuan[n])) }));
if (params.get('wealth') === 'empty' || params.get('state') === 'empty') { accounts = []; snapshots = []; }
if (params.get('wealth') === 'first') snapshots = [];
if (params.get('wealth') === 'one' && snapshots.length > 1) snapshots = snapshots.slice(-1);
if (params.get('wealth') === 'missing' && snapshots.length) {
  // 把最近一次盘点的第一个已知金额改为未知，概览与比较共用同一份缺口（仅浏览器预览）。
  const last = snapshots[snapshots.length - 1];
  const i = last.entries.findIndex(e => e.amount_cents !== null);
  snapshots = snapshots.map(s => s === last ? { ...s, entries: s.entries.map((e, n) => n === i ? { ...e, state: 'missing' as const, amount_cents: null } : e) } : s);
}
// U20 预览夹具：区间中段新开一个基金账户（W-AC04「新增账户」），房贷只在中间那次
// 不完整盘点改为计入（W-AC05「计入范围变化」）。只改内存虚构数据，刷新即重置。
if (params.get('wealth-fixture') === 'compare' && snapshots.length > 2 && params.get('wealth') !== 'empty') {
  const opened = snapshots[snapshots.length - 2].date, latestDay = snapshots[snapshots.length - 1].date;
  const fund: Account = { id: 'w-fund-demo', fields: { name: '虚构基金账户', institution: '虚构基金', side: 'asset', kind: 'fund', counted: true, opened_on: opened, closed_on: null, notes: '虚构样例' }, position: accounts.length, revision: 1, latest: null };
  accounts = [...accounts, fund];
  snapshots = snapshots.map(s => s.date >= opened ? { ...s, entries: [...s.entries, entry(fund, s.date === latestDay ? 10000 : 9000)] } : s);
  const mid = snapshots[snapshots.length - 2];
  snapshots = snapshots.map(s => s === mid ? { ...s, entries: s.entries.map(e => e.account_id === 'w-loan' ? { ...e, counted: true } : e) } : s);
}
// 总览预览夹具：最近一次完整盘点把房贷的“计入”改掉，与上一次完整盘点的计入范围不同（总览结构变化应显示“不可比”）。
if (params.get('wealth-fixture') === 'scope' && snapshots.length > 1 && params.get('wealth') !== 'empty') {
  const last = snapshots[snapshots.length - 1];
  snapshots = snapshots.map(s => s === last ? { ...s, entries: s.entries.map(e => e.account_id === 'w-loan' ? { ...e, counted: !e.counted } : e) } : s);
}
const receipts = new Map<string, string>();

const due = (a: Account, d: string) => a.fields.opened_on <= d && (!a.fields.closed_on || d < a.fields.closed_on);
const known = (e: Entry) => e.amount_cents !== null;
function latestBefore(id: string, before?: string) {
  const hit = snapshots.filter(s => !before || s.date < before).sort((a, b) => b.date.localeCompare(a.date)).flatMap(s => s.entries.filter(e => e.account_id === id && known(e)).map(e => ({ amount_cents: e.amount_cents!, date: s.date })))[0];
  return hit ?? null;
}
const withLatest = (a: Account): Account => ({ ...a, latest: latestBefore(a.id) });
function view(s: Stored): Snapshot {
  const have = new Set(s.entries.filter(known).map(e => e.account_id));
  return { ...s, missing: accounts.filter(a => due(a, s.date) && !have.has(a.id)).map(a => a.id) };
}
const hundredths = (a: bigint, b: bigint) => Number((a * 20000n / b + (a >= 0n ? 1n : -1n)) / 2n);
function summary(): Summary {
  const points: Point[] = []; let last: { s: Snapshot; net: bigint } | null = null;
  for (const stored of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    const s = view(stored);
    const sum = (side: string) => s.entries.filter(e => e.counted && e.side === side && known(e)).reduce((t, e) => t + BigInt(e.amount_cents!), 0n);
    const assets = sum('asset'), liabilities = sum('liability'), net = assets - liabilities, complete = !s.missing.length;
    const p: Point = { snapshot_id: s.id, date: s.date, notes: s.notes, assets_cents: String(assets), liabilities_cents: String(liabilities), net_cents: String(net), complete, missing: s.missing.length, compared_to: null, scope_changed: false, change_cents: null, hpf_change_cents: null, change_rate_hundredths: null };
    if (complete) {
      if (last) {
        p.compared_to = last.s.date;
        const before = new Map(last.s.entries.map(e => [e.account_id, e.counted]));
        p.scope_changed = s.entries.some(e => before.has(e.account_id) && before.get(e.account_id) !== e.counted);
        if (!p.scope_changed) {
          const change = net - last.net; p.change_cents = String(change); if (last.net > 0n) p.change_rate_hundredths = hundredths(change, last.net);
          const hpf = (x: Snapshot) => { const e = x.entries.filter(k => k.counted && k.side === 'asset' && k.kind === 'housing_fund'); return e.length ? e.reduce((t, k) => t + (known(k) ? BigInt(k.amount_cents!) : 0n), 0n) : null; };
          const a = hpf(last.s), b = hpf(s); p.hpf_change_cents = a === null && b === null ? null : String((b ?? 0n) - (a ?? 0n));
          const market = (x: Snapshot) => { const e = x.entries.filter(k => k.counted && k.side === 'asset' && ['investment', 'mixed', 'fund', 'bond'].includes(k.kind)); return e.length ? e.reduce((t, k) => t + (known(k) ? BigInt(k.amount_cents!) : 0n), 0n) : null; };
          const ma = market(last.s), mb = market(s); p.market_change_cents = ma === null && mb === null ? null : String((mb ?? 0n) - (ma ?? 0n));
        }
      }
      last = { s, net };
    }
    points.push(p);
  }
  const shares = (side: string): Share[] => {
    if (!last) return [];
    const by = new Map<string, bigint>();
    for (const e of last.s.entries) if (e.counted && e.side === side && known(e)) by.set(e.kind, (by.get(e.kind) ?? 0n) + BigInt(e.amount_cents!));
    const total = [...by.values()].reduce((a, b) => a + b, 0n);
    return [...by].map(([kind, v]) => ({ kind, amount_cents: String(v), share_hundredths: total > 0n ? hundredths(v, total) : null }));
  };
  return { generation, points, structure_date: last?.s.date ?? null, structure: shares('asset'), liabilities: shares('liability') };
}

// Standalone expenses for the preview; item purchases come from the demo assets.
let expenses: Expense[] = (params.get('expenses') === 'empty' || params.get('state') === 'empty') ? [] : demoFinance.expenses.filter(e => !e.deleted).map(e => ({
  id: 'x-' + e.key, fields: { title: e.title, date: shifted(0, -e.days_ago), amount_cents: e.amount_cents, category: e.category,
    notes: '虚构样例', refund_cents: e.refund_cents, refund_date: e.refund_days_ago === null ? null : shifted(0, -e.refund_days_ago), asset_id: e.asset_key },
  revision: 1, asset_name: demoAssets.find(a => a.key === e.asset_key)?.name ?? null, asset_deleted: false,
}));
function expenseView(year: number | null): ExpenseView {
  const items: Line[] = (params.get('expenses') === 'empty' || params.get('state') === 'empty') ? [] : demoAssets.flatMap(a => [
    { source: 'purchase' as const, id: a.key, asset_id: a.key, title: a.name, category: a.category, date: a.purchase_date, amount_cents: a.price_cents, notes: null },
    ...(a.maintenance ? [{ source: 'maintenance' as const, id: 'm-' + a.key, asset_id: a.key, title: `${a.name} · ${a.maintenance.title}`, category: a.category, date: a.maintenance.date, amount_cents: a.maintenance.cost_cents, notes: null }] : []),
    ...(a.sale ? [{ source: 'sale' as const, id: 's-' + a.key, asset_id: a.key, title: a.name, category: a.category, date: a.sale.date, amount_cents: a.sale.price_cents, notes: null }] : []),
  ]);
  const paidLines: Line[] = payments.filter(p => p.state === 'paid').map(p => ({ source: 'payment', id: p.id, asset_id: null, plan_id: p.plan_id, title: p.plan_name, category: plans.find(x => x.id === p.plan_id)?.fields.category ?? null, date: p.paid_date, amount_cents: p.amount_cents, notes: null }));
  const virtualLines: Line[] = virtuals.filter(v => !v.fields.plan_id && v.fields.price_cents !== null).map(v => ({ source: 'virtual', id: v.id, asset_id: null, title: v.fields.name, category: 'digital', date: v.fields.purchase_date, amount_cents: v.fields.price_cents, notes: null }));
  const all: Line[] = [...items, ...paidLines, ...virtualLines, ...expenses.flatMap(e => [
    { source: e.fields.asset_id ? 'linked' as const : 'expense' as const, id: e.id, asset_id: e.fields.asset_id, title: e.fields.title, category: e.fields.category, date: e.fields.date, amount_cents: e.fields.amount_cents, notes: e.fields.notes },
    ...(e.fields.refund_date ? [{ source: 'refund' as const, id: e.id, asset_id: e.fields.asset_id, title: e.fields.title, category: e.fields.category, date: e.fields.refund_date, amount_cents: e.fields.refund_cents, notes: e.fields.notes }] : []),
  ])];
  const inYear = (l: Line) => l.date !== null && (year === null || l.date.startsWith(`${year}-`));
  const lines = all.filter(inYear).sort((a, b) => b.date!.localeCompare(a.date!)), undated = all.filter(l => l.date === null);
  const sum = (ls: Line[]) => ls.reduce((t, l) => t + BigInt(l.amount_cents ?? '0'), 0n);
  const spendSource = (l: Line) => ['purchase', 'maintenance', 'expense', 'payment', 'virtual', 'topup'].includes(l.source);
  const spentLines = lines.filter(l => spendSource(l) && l.amount_cents !== null);
  const spent = sum(spentLines), refunds = sum(lines.filter(l => l.source === 'refund'));
  const yearKeys = [...new Set(all.flatMap(l => l.date ? [l.date.slice(0, 4)] : []))].sort();
  const bucket = (ls: Line[]) => { const spentB = sum(ls.filter(l => spendSource(l) && l.amount_cents !== null)); const count = ls.filter(l => spendSource(l)).length; const known = ls.filter(l => spendSource(l) && l.amount_cents !== null).length;
    return { spent: String(spentB), refund: String(sum(ls.filter(l => l.source === 'refund'))), sale: String(sum(ls.filter(l => l.source === 'sale'))), count, known_count: known, unknown_count: count - known }; };
  const annual_totals = year === null ? yearKeys.map(k => { const b = bucket(all.filter(l => l.date?.startsWith(k + '-'))); return { year: Number(k), spent_cents: b.spent, refund_cents: b.refund, net_cents: String(BigInt(b.spent) - BigInt(b.refund)), sale_cents: b.sale, count: b.count, known_count: b.known_count, unknown_count: b.unknown_count }; }) : [];
  const monthBucket = (m: string) => { const b = bucket(all.filter(l => l.date?.startsWith(m))); return { month: m, spent_cents: b.spent, refund_cents: b.refund, count: b.count, known_count: b.known_count, unknown_count: b.unknown_count }; };
  return { generation, year, years: yearKeys.map(Number).sort((a, b) => b - a), lines, undated,
    months: year === null ? [] : Array.from({ length: 12 }, (_, i) => monthBucket(`${year}-${String(i + 1).padStart(2, '0')}`)),
    annual_totals,
    spent_cents: String(spent), refund_cents: String(refunds), net_cents: String(spent - refunds), sale_cents: String(sum(lines.filter(l => l.source === 'sale'))),
    undated_cents: String(sum(undated)), unknown_amount_count: lines.filter(l => l.amount_cents === null).length };
}

// Recurring plans share the native fixture definitions.
const todayIso = iso(now);
/** k-th scheduled date counted from the anchor, clamped to month end (preview mirror of Rust). */
function nth(first: string, interval: number, k: number) {
  const [y, m, d] = first.split('-').map(Number), total = m - 1 + interval * k, yy = y + Math.floor(total / 12), mm = total % 12;
  return iso(new Date(yy, mm, Math.min(d, new Date(yy, mm + 1, 0).getDate())));
}
function schedule(p: Plan, from: string, to: string) { return scheduleDates(p.fields, from, to); }

const plan = (id: string, name: string, category: string, amount: string, interval: number, first: string, extra: Partial<Plan['fields']> = {}): Plan =>
  ({ id, fields: { name, category, amount_cents: amount, interval_months: interval, first_due: first, end_date: null, paused: false, notes: '', ...extra }, revision: 1, active_from: first, next_due: null });
let plans: Plan[] = (params.get('recurring') === 'empty' || params.get('state') === 'empty') ? [] : demoFinance.plans.map(p =>
  plan('r-' + p.key, p.name, p.category, p.amount_cents, p.interval_months, shifted(p.months_ago, p.day_offset), { paused: p.paused }));
let payments: Payment[] = (params.get('recurring') === 'empty' || params.get('state') === 'empty') ? [] : demoFinance.plans.flatMap(p => p.paid_periods.map(k => {
  const due = nth(shifted(p.months_ago, p.day_offset), p.interval_months, k);
  return { id: `p-${p.key}-${k}`, plan_id: 'r-' + p.key, plan_name: p.name, due_date: due, state: 'paid', paid_date: due, amount_cents: p.amount_cents, notes: '虚构付款', revision: 1, off_schedule: false };
}));
// Browser-only long status/cost fixture; all amounts and dates are fictional.
if (params.get('recurring-fixture') === 'layout') {
  const historical = plan('r-layout-gpt', 'GPT Plus · 虚构历史订阅', 'subscription', '14000', 1, '2024-01-20', { service_start: '2024-01-20', coverage_start: '2024-01-20', end_date: '2025-02-19', auto_renew: false });
  const longName = plan('r-layout-long', 'LongSubscriptionNameWithoutSpaces'.repeat(4), 'subscription', '999900', 1, todayIso, { service_start: todayIso, coverage_start: todayIso });
  const unknown = plan('r-layout-legacy', '旧计划 · 服务覆盖期未设置', 'membership', '2500', 12, todayIso, { paused: true });
  plans = [historical, longName, unknown];
  payments = [{ id: 'p-layout-gpt', plan_id: historical.id, plan_name: historical.fields.name, due_date: '2024-01-20', state: 'paid', paid_date: '2024-01-20', amount_cents: '14000', notes: '虚构历史付款', revision: 1, off_schedule: false }];
}
function recurringOverview(): Overview {
  const soon = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)), year = iso(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));
  const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const free = (p: Plan, d: string) => !payments.some(x => x.plan_id === p.id && x.due_date === d);
  const due: Due[] = [], upcoming: Due[] = []; let annual = 0n, next12 = 0n;
  const out = plans.map(p => {
    const item = (d: string): Due => ({ coverage_start: coverageFor(p.fields,d)?.[0], coverage_end: coverageFor(p.fields,d)?.[1], plan_id: p.id, plan_name: p.fields.name, category: p.fields.category, due_date: d, amount_cents: p.fields.amount_cents });
    const next = schedule(p, todayIso > p.active_from ? todayIso : p.active_from, iso(new Date(now.getFullYear() + 5, now.getMonth(), now.getDate()))).find(d => free(p, d)) ?? null;
    if (!p.fields.paused) {
      due.push(...schedule(p, p.active_from, todayIso).filter(d => free(p, d)).map(item));
      upcoming.push(...schedule(p, tomorrow, p.fields.interval_months >= 12 ? iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30)) : soon).filter(d => free(p, d)).map(item));
      next12 += BigInt(p.fields.amount_cents) * BigInt(schedule(p, tomorrow, year).filter(d => free(p, d)).length);
      if (!p.fields.end_date || p.fields.end_date >= todayIso) annual += BigInt(p.fields.amount_cents) * 12n / BigInt(p.fields.interval_months);
    }
    const amount=BigInt(p.fields.amount_cents), start=p.fields.service_start;
    const historyCount = start ? scheduleDates({...p.fields,first_due:p.fields.coverage_start!,coverage_start:p.fields.coverage_start},start,todayIso).length : 0;
    const contractCount = start && p.fields.end_date ? scheduleDates({...p.fields,first_due:p.fields.coverage_start!,coverage_start:p.fields.coverage_start},start,p.fields.end_date).length : 0;
    // 当前服务期（R3）：包含 today 的期，独立于下一付款候选。
    let currentCoverage: [string, string] | null = null;
    if (p.fields.coverage_start) {
      const all = scheduleDates(p.fields, p.fields.coverage_start, todayIso);
      for (const d of all) {
        const span = coverageFor(p.fields, d);
        if (span && span[0] <= todayIso && todayIso <= span[1]) { currentCoverage = span; break; }
      }
    }
    return { ...p, next_due: p.fields.paused ? null : next, current_coverage: currentCoverage, next_coverage: next ? coverageFor(p.fields, next) : null, monthly_cents: String((amount+BigInt(p.fields.interval_months)/2n)/BigInt(p.fields.interval_months)), paid_cents: String(payments.filter(x=>x.plan_id===p.id&&x.state==='paid').reduce((t,x)=>t+BigInt(x.amount_cents ?? '0'),0n)), estimated_cents: start ? String(amount*BigInt(historyCount)) : null, contract_cents: contractCount ? String(amount*BigInt(contractCount)) : null };
  });
  return { generation, today: todayIso, due: due.sort((a, b) => a.due_date.localeCompare(b.due_date)), upcoming: upcoming.sort((a, b) => a.due_date.localeCompare(b.due_date)),
    annual_cents: String(annual), monthly_cents: String((annual + 6n) / 12n), next12_cents: String(next12), plans: out,
    payments: [...payments].sort((a, b) => b.due_date.localeCompare(a.due_date)).map(x => ({ ...x, off_schedule: !schedule(plans.find(p => p.id === x.plan_id)!, x.due_date, x.due_date).length })) };
}

// Virtual assets share the native fixture definitions; derivation mirrors virtual_assets.rs.
const dayOffset = (days: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
let topups: { id: string; asset_id: string; fields: TopupFields; revision: number }[] = [];
let balances: BalanceRecord[] = [];
const renewalReminders = new Map<string, ReminderState>();
let virtuals: { id: string; fields: VirtualFields; revision: number }[] = (params.get('virtual') === 'empty' || params.get('state') === 'empty') ? [] : demoFinance.virtuals.map(v => ({ id: 'v-' + v.key, revision: 1, fields: {
  name: v.name, kind: v.kind as VirtualKind, billing: v.plan_key ? 'subscription' : 'single', label_id: null, provider: v.provider, purchase_date: v.purchase_days_ago === null ? null : dayOffset(-v.purchase_days_ago),
  price_cents: v.plan_key ? null : v.price_cents, expires: v.expires_in_days === null ? null : dayOffset(v.expires_in_days), plan_id: v.plan_key ? 'r-' + v.plan_key : null,
  url: '', notes: '虚构样例', stopped_on: v.stopped_days_ago === null ? null : dayOffset(-v.stopped_days_ago) } }));
if (params.get('recurring-fixture') === 'layout' && virtuals.length) {
  const base = virtuals[0].fields;
  virtuals = [
    { id: 'v-layout-gpt', revision: 1, fields: { ...base, name: 'GPT Plus · 虚构历史订阅', kind: 'subscription', billing: 'subscription', price_cents: null, plan_id: 'r-layout-gpt', expires: '2025-02-19', stopped_on: null } },
    { id: 'v-layout-soon', revision: 1, fields: { ...base, name: '虚构即将到期授权', kind: 'license', billing: 'single', price_cents: '8800', plan_id: null, expires: dayOffset(3), stopped_on: null } },
  ];
}
function virtualOverview(): VirtualOverview {
  const items: VirtualAsset[] = virtuals.map(v => {
    const p = recurringOverview().plans.find(x => x.id === v.fields.plan_id), paid = payments.filter(x => x.plan_id === p?.id && x.state === 'paid');
    const last = paid.map(x => x.due_date).sort().at(-1);
    const paidUntil = paid.map(x => x.coverage_end).filter((x): x is string => !!x).sort().at(-1) ?? (p && last ? (() => { const [y, m, d] = nth(last, p.fields.interval_months, 1).split('-').map(Number); return iso(new Date(y, m - 1, d - 1)); })() : null);
    const renewal = !!p && (!!p.fields.service_start || v.fields.kind === 'subscription');
    const until = renewal && p!.fields.end_date ? p!.fields.end_date : p ? paidUntil : v.fields.expires;
    const spent = p ? String(paid.reduce((t, x) => t + BigInt(x.amount_cents ?? '0'), 0n)) : v.fields.price_cents;
    const soon = dayOffset(p ? 7 : 30);
    const status: VirtualStatus = v.fields.stopped_on ? 'stopped' : renewal && p!.fields.paused && (!p!.fields.end_date || p!.fields.end_date >= todayIso) ? 'paused' : renewal && !p!.fields.paused && !p!.fields.end_date ? 'ongoing' : !p && !v.fields.plan_id && v.fields.kind === 'subscription' && !v.fields.expires ? 'ongoing' : until === null ? (v.fields.kind === 'license' && !p ? 'perpetual' : 'unknown') : until < todayIso ? 'expired' : until <= soon ? 'expiring' : 'active';
    const candidateDate = p && p.fields.service_start && !p.fields.paused && !v.fields.stopped_on && (!p.fields.end_date || p.fields.end_date >= todayIso)
      ? schedule(p, p.fields.service_start < p.fields.first_due ? p.fields.service_start : p.fields.first_due, dayOffset(366)).find(d => {
          const coverage = coverageFor(p.fields, d);
          return coverage && coverage[1] >= todayIso && !payments.some(x => x.plan_id === p.id && x.due_date === d);
        }) : null;
    const storedLead = renewalReminders.get(v.id);
    const windowDays = Math.max(storedLead?.repeat_every_period ? storedLead.lead_days ?? 3 : 0, p && (p.fields.interval_days ? p.fields.interval_days >= 365 : p.fields.interval_months >= 12) ? 30 : 7);
    const payment_due: Due | null = candidateDate && p && candidateDate <= dayOffset(windowDays) ? { plan_id: p.id, plan_name: p.fields.name, category: p.fields.category, due_date: candidateDate, amount_cents: p.fields.amount_cents, coverage_start: coverageFor(p.fields, candidateDate)?.[0], coverage_end: coverageFor(p.fields, candidateDate)?.[1] } : null;
    const storedReminder = renewalReminders.get(v.id) ?? null;
    const reminder = storedReminder?.repeat_every_period && candidateDate ? { ...storedReminder, date: shiftDays(candidateDate, -(storedReminder.lead_days ?? 3)) } : storedReminder;
    const mine = topups.filter(t => t.asset_id === v.id);
    const known = mine.reduce((t, x) => t + BigInt(x.fields.paid_cents ?? '0'), 0n);
    const credit = mine.reduce((t, x) => t + BigInt(x.fields.credit_cents ?? '0'), 0n);
    const unknownPaid = mine.filter(x => x.fields.paid_cents == null).length;
    const balance = balances.filter(b => b.asset_id === v.id).sort((a, b) => b.recorded_on.localeCompare(a.recorded_on))[0] ?? null;
    return { ...v, paid_count: paid.length, paid_until: paidUntil, plan:p??null, plan_name: p?.fields.name ?? null, plan_deleted: false, valid_until: until, status, spent_cents: spent,
      label_name: null, reminder, payment_due, topup_count: mine.length, topups: mine.slice().sort((a, b) => (b.fields.topup_date ?? '').localeCompare(a.fields.topup_date ?? '')), topup_unknown_paid: unknownPaid, topup_known_cents: mine.length ? String(known) : null, topup_credit_cents: mine.length ? String(credit) : null, balance };
  }).sort((a, b) => a.fields.name.localeCompare(b.fields.name));
  return { generation, today: todayIso, items, in_use: items.filter(v => v.status !== 'stopped' && v.status !== 'expired').length, expiring: items.filter(v => v.status === 'expiring').length, expired: items.filter(v => v.status === 'expired').length,
    spent_cents: String(items.reduce((t, v) => t + BigInt(v.spent_cents ?? '0'), 0n)), unknown_price: items.filter(v => v.spent_cents === null).length,
    plans: plans.map(p => ({ id: p.id, name: p.fields.name, interval_months: p.fields.interval_months, linked_to: virtuals.find(v => v.fields.plan_id === p.id)?.fields.name ?? null })) };
}

/** 浏览器预览的全局搜索桩：仅用于界面检查，不能验证 Rust 的快照、排序或完整字段覆盖。 */

// 规划预览：虚构月度收入（每月 15 日到账）、一次性标记与已删除行；计算用 plan.ts 的预览实现。
const payday = (monthsAgo: number) => { const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 15); return iso(d); };
let planIncomes: Income[] = (params.get('plan') === 'empty' || params.get('state') === 'empty') ? [] : [6, 5, 4, 3, 2, 1, 0].map(m => ({ id: 'p-inc-' + m, revision: 1, fields: { date: payday(m), net_cents: '2000000', hpf_cents: '300000', notes: m === 3 ? '含虚构年终奖' : '' } })).filter(i => i.fields.date <= todayIso);
const planMarks = new Set<string>();
let planTrash: Income[] = [];
// 首页规划摘要的退休预算夹具：set 为虚构 5000 元，也可直接给元数（如 plan-budget=6500）。
const planBudgetParam = params.get('plan-budget');
const planBudgetCents = planBudgetParam === null ? null : planBudgetParam === 'set' ? '500000' : /^\d+(\.\d{1,2})?$/.test(planBudgetParam) ? String(Math.round(Number(planBudgetParam) * 100)) : null;
// 虚构个人资料（1990-06 出生的男职工，数字均为虚构）；?plan-profile=empty 为尚未填写。
let planProfile: ProfileState['saved'] = params.get('plan-profile') === 'empty' ? null : { revision: 1, updated_at: params.get('plan-stale') === '1' ? '2026-01-02T00:00:00Z' : new Date().toISOString(), profile: { birth_month: '1990-06', worker: 'male', region: 'beijing', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0, personal_pension_annual_cents: '1200000', marginal_tax_hundredths: 1000, assumptions: { inflation_hundredths: 200, wage_growth_hundredths: 200, pp_return_hundredths: 200 }, overrides: { avg_wage_cents: null, base_lower_cents: null, base_upper_cents: null, notional_rate_hundredths: null, hpf_rate_hundredths: null }, retire: { ...defaultRetire, spend_cents: planBudgetCents, ...(params.get('plan-mode') === 'traditional' ? { mode: 'traditional' as const, target_age: 60 } : {}), ...(params.get('plan-items') === '1' ? { spend_items: [{ id: 'fx-health', label: '医疗', monthly_cents: '100000', start_age: 65, end_age: null, inflation_hundredths: 400, essential: true }, { id: 'fx-travel', label: '旅行', monthly_cents: '150000', start_age: null, end_age: 75, inflation_hundredths: null, essential: false }], income_items: [{ id: 'fx-annuity', label: '企业年金', monthly_cents: '120000', start_age: 60, end_age: null, indexed: false }] } : {}), ...(params.get('plan-phases') === '1' ? { saving_phases: [{ id: 'fx-gap', label: '空窗期', from_age_months: 0, monthly_cents: -600000 }, { id: 'fx-work', label: '有收入', from_age_months: 440, monthly_cents: 1700000 }, { id: 'fx-calm', label: '清闲／稳定', from_age_months: 504, monthly_cents: 800000 }] } : {}), ...(params.get('plan-events') === '1' ? { life_events: [
    { id: 'fx-bj', label: '北京买房', kind: 'house' as const, date: `${now.getFullYear() + 7}-${String(now.getMonth() + 1).padStart(2, '0')}`, included: true, price_cents: '450000000', down_cents: '150000000', extra_cents: '10000000', loan_rate_hundredths: 350, loan_years: 30, holding_cents: '150000', rent_saved_cents: '270000', cycle_years: null, until_age: null, resale_cents: '0' },
    { id: 'fx-home', label: '老家全款买房', kind: 'house' as const, date: `${now.getFullYear() + 7}-${String(now.getMonth() + 1).padStart(2, '0')}`, included: false, price_cents: '40000000', down_cents: '40000000', extra_cents: '3000000', loan_rate_hundredths: 350, loan_years: 30, holding_cents: '30000', rent_saved_cents: '150000', cycle_years: null, until_age: null, resale_cents: '0' },
    { id: 'fx-car', label: '二手车', kind: 'car' as const, date: `${now.getFullYear() + 2}-${String(now.getMonth() + 1).padStart(2, '0')}`, included: true, price_cents: '7000000', down_cents: '7000000', extra_cents: '0', loan_rate_hundredths: 350, loan_years: 3, holding_cents: '120000', rent_saved_cents: '0', cycle_years: 5, until_age: 60, resale_cents: '2000000' },
  ] } : {}), ...(params.get('plan-route') ? { route_id: params.get('plan-route'), route_from_age: 35 } : {}), ...(params.get('plan-return') === '1' ? { real_return_before_hundredths: 150, real_return_after_hundredths: 100 } : {}) } } as StoredProfile };
// Confirmed planning / continuation acceptance fixtures, all balances fictional.
const coreScenario = params.get('plan-core');
if (coreScenario && planProfile && snapshots.length) {
  const s = snapshots[snapshots.length - 1], cash = accounts.find(a => a.fields.kind === 'cash')!, debt = accounts.find(a => a.fields.kind === 'loan')!;
  s.entries = s.entries.map(e => e.account_id === cash.id ? { ...e, amount_cents: '70000000' } : e.side === 'liability' ? { ...e, counted: true, amount_cents: e.account_id === debt.id && ['occurred','partial'].includes(coreScenario) ? '10000000' : '0' } : e);
  const r = planProfile.profile.retire;
  r.saving_phases = [{ id: 'fx-confirmed', label: '明确净投入', from_age_months: 0, monthly_cents: 500000 }];
  r.core = { ...emptyCore(s.date), hpf_monthly_cents: '300000', fund_rules: s.entries.filter(e => e.counted && e.side === 'asset').map(e => ({ account_id: e.account_id, availability: e.kind === 'cash' ? 'available' : 'restricted', share_hundredths: 10000 })) };
  r.core.personal_pension_balance_confirmed = true;
  r.core.costs = [{ phase_id: 'fx-confirmed', source_id: 'personal_pension', included: false, reference_cents: '0' }];
  if (['occurred','partial','overdue'].includes(coreScenario)) {
    const date = shifted(1).slice(0, 7);
    r.life_events = [{ id: 'fx-occurred', label: '虚构已购住宅', kind: 'house', date, included: false, price_cents: '40000000', down_cents: '30000000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 30, holding_cents: '10000', rent_saved_cents: '0', cycle_years: null, until_age: null, resale_cents: '0' }];
    if (coreScenario === 'overdue') r.life_events[0].included = true;
    else {
      r.core.occurrences = [{ id: 'fx-occurrence', event_id: 'fx-occurred', status: 'occurred', actual_date: date + '-01', payments_complete: coreScenario === 'occurred', payments: [{ id: 'fx-payment', date: date + '-01', amount_cents: '30000000', account_id: cash.id, absorbed_snapshot_id: s.id, absorbed_revision: s.revision, source_kind: null, source_id: null }], loan: { account_id: debt.id, as_of: s.date, principal_cents: '10000000', remaining_months: 50 } }];
      r.core.costs.push({ phase_id: 'fx-confirmed', source_id: eventSource('fx-occurred','loan'), included: true, reference_cents: '200000' }, { phase_id: 'fx-confirmed', source_id: eventSource('fx-occurred','holding'), included: false, reference_cents: '0' });
    }
  }
}
// 首页规划摘要的局部读取失败夹具：只让指定来源失败，验证独立降级与局部重试。
const planFail = (source: string) => params.get('plan-fail') === source;

// ---- 通用规划基础：专用虚构预览（不代表原生保存或计算）----
// ?plan-basic=unknown|zero|negative|saved|terminal-zero|missing-costs|excluded|manual|beijing|beijing-complete|blank
// 其余开关：plan-start=live、plan-wealth=off、plan-req=zero|not-found|payment|bounds、state=save-error|unknown-result。
// 能力结果只在预览里按已保存输入挑选严格夹具；它不是计算器，原生联调以 Codex 的真实服务为准。
const basicScenario = params.get('plan-basic');
const basicDefaults = (): StoredProfile => {
  const f = basicInputFixtures.unknown;
  const retire = { ...defaultRetire, spend_cents: f.spend_cents, target_age: f.target_age, horizon_age: f.horizon_age, mode: f.mode, emergency_months: 0, setup_completed: true, basic: structuredClone(f.basic), core: { ...emptyCore(todayIso), monetary_basis_date: todayIso } };
  return { birth_month: f.birth_month, worker: null, region: null, paid_months: null, account_balance_cents: null, base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null, assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 200, pp_return_hundredths: 200 }, overrides: { avg_wage_cents: null, base_lower_cents: null, base_upper_cents: null, notional_rate_hundredths: null, hpf_rate_hundredths: null }, retire };
};
function basicScenarioProfile(kind: string): ProfileState['saved'] {
  if (kind === 'blank') return null;
  const p = basicDefaults(), r = p.retire, b = r.basic!;
  const contribution = { unknown: null, zero: '0', negative: '-200000', saved: '500000', 'terminal-zero': '500000' }[kind as 'unknown'] ?? null;
  b.contribution.monthly_cents = contribution;
  r.income_items = [{ id: 'fx-annuity', label: '企业年金', monthly_cents: '120000', start_age: 60, end_age: null, indexed: false }];
  if (kind === 'manual') b.retirement_income = { mode: 'manual', selected: [{ id: 'fx-annuity', source_id: 'fx-annuity', role: 'other' }] };
  if (kind === 'excluded') b.retirement_income = { mode: 'excluded', selected: [] };
  if (kind === 'beijing' || kind === 'beijing-complete') { b.retirement_income = { mode: 'beijing', selected: [] }; b.pension_contributions = { start_month: '2026-10', stop_month: '2050-06', base_cents: '2000000' }; }
  if (kind === 'beijing-complete') Object.assign(p, { worker: 'male', region: 'beijing', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000 });
  if (kind === 'missing-costs') { r.rent_cents = '100000'; r.spend_items = [{ id: 'fx-health', label: '医疗', monthly_cents: '100000', start_age: 65, end_age: null, inflation_hundredths: 400, essential: true }]; }
  if (kind === 'unknown' || kind === 'zero' || kind === 'negative' || kind === 'saved' || kind === 'terminal-zero') b.retirement_income = { mode: 'excluded', selected: [] };
  if (params.get('plan-start') === 'live') b.start = { kind: 'live' };
  return { revision: 1, updated_at: new Date().toISOString(), profile: p };
}
if (basicScenario) planProfile = basicScenarioProfile(basicScenario);
let planWriteVersion = 1;
const updateResults = new Map<string, NonNullable<ProfileState['saved']>>();
let lostOnce = false;
const readError = (message: string, code = 'READ_FAILED') => ({ status: 'error' as const, value: { code, message } });
const planningSources = (args: Record<string, unknown>): PlanningSources => {
  const planning = args.planningEnabled !== false, wealth = args.wealthEnabled !== false;
  const disabled = readError('资产与盘点已关闭', 'MODULE_DISABLED');
  const point = [...summary().points].reverse().find(p => p.complete), found = point ? snapshots.find(x => x.id === point.snapshot_id) : null;
  return {
    generation, write_version: planWriteVersion, today: todayIso, modules: { planning, wealth },
    profile: planFail('profile') ? readError('虚构个人资料读取失败，用于验证局部降级。') : { status: 'ready', value: { generation, saved: planProfile } },
    snapshot: !wealth ? disabled : planFail('snapshot') ? readError('虚构盘点明细读取失败，用于验证局部降级。') : { status: 'ready', value: found ? view(found) : null },
    accounts: !wealth ? disabled : { status: 'ready', value: accounts.map(withLatest) },
    review: !wealth ? disabled : planFail('review') ? readError('虚构储蓄统计读取失败，用于验证局部降级。') : { status: 'ready', value: computeReview(summary().points, planIncomes, planMarks, generation) },
    incomes: planFail('income') ? readError('虚构收入列表读取失败，用于验证局部降级。') : { status: 'ready', value: [...planIncomes].sort((a, b) => b.fields.date.localeCompare(a.fields.date) || a.id.localeCompare(b.id)) },
  };
};
/** Mirrors the native section merge for preview only. Whole-profile writes never reach it. */
function mergeSection(old: StoredProfile | null, u: ProfileUpdate): StoredProfile {
  const p: StoredProfile = old ? structuredClone(old) : { ...basicDefaults(), birth_month: null, retire: { ...defaultRetire, target_age: null, core: undefined } };
  const core = (basis: string) => { if (p.retire.core && p.retire.core.monetary_basis_date !== basis) throw { code: 'PLANNING_BASIS', message: '已有金额基准固定' }; return (p.retire.core ??= { ...emptyCore(basis) }); };
  if (u.section === 'setup') {
    let next = mergeSection(old, { ...u, section: 'basic', fields: u.fields.basic });
    if (u.fields.budget) next = mergeSection(next, { ...u, section: 'budget', fields: u.fields.budget });
    if (u.fields.funds) next = mergeSection(next, { ...u, section: 'funds', fields: u.fields.funds });
    if (u.fields.pension) next = mergeSection(next, { ...u, section: 'pension', fields: u.fields.pension });
    return next;
  }
  if (u.section === 'basic') {
    const f = u.fields;
    if (old && !old.retire.basic && hasLegacyPlan(old.retire)) { if (!f.confirm_legacy_replacement) throw { code: 'PLANNING_BASIC', message: '重设原规划须明确确认差异' }; p.retire.legacy_definition = { contract_version: 1, recorded_at: todayIso, birth_month: old.birth_month, monetary_basis_date: old.retire.core?.monetary_basis_date ?? null, assumptions: old.assumptions, spend_cents: old.retire.spend_cents, target_age: old.retire.target_age, horizon_age: old.retire.horizon_age, mode: old.retire.mode, real_return_before_hundredths: old.retire.real_return_before_hundredths, real_return_after_hundredths: old.retire.real_return_after_hundredths, volatility_hundredths: old.retire.volatility_hundredths, emergency_months: old.retire.emergency_months, saving_phases: old.retire.saving_phases, route_id: old.retire.route_id, route_from_age: old.retire.route_from_age, gap_share_hundredths: old.retire.gap_share_hundredths, gap_keeps_paying: old.retire.gap_keeps_paying, spend_items: old.retire.spend_items, income_items: old.retire.income_items, event_ids: old.retire.life_events.map(e => e.id), costs: old.retire.core?.costs ?? [], keep_paying_until_age: old.retire.keep_paying_until_age, keep_paying_monthly_cents: old.retire.keep_paying_monthly_cents, keep_paying_base_cents: old.retire.keep_paying_base_cents, rent_cents: old.retire.rent_cents }; }
    else if (old?.retire.basic && old.retire.basic.contribution.id !== f.basic.contribution.id) throw { code: 'PLANNING_BASIC', message: '投入稳定ID不能替换' };
    core(f.monetary_basis_date); p.birth_month = f.birth_month; p.assumptions.inflation_hundredths = f.inflation_hundredths;
    Object.assign(p.retire, { basic: f.basic, spend_cents: f.spend_cents, target_age: f.target_age, horizon_age: f.horizon_age, mode: f.mode, real_return_before_hundredths: f.real_return_before_hundredths, real_return_after_hundredths: f.real_return_after_hundredths, volatility_hundredths: f.volatility_hundredths, emergency_months: f.emergency_months, setup_completed: true });
  } else if (u.section === 'pension') {
    const f = u.fields;
    Object.assign(p, { birth_month: f.birth_month, worker: f.worker, region: f.region, paid_months: f.paid_months, account_balance_cents: f.account_balance_cents, base_cents: f.base_cents, past_index_hundredths: f.past_index_hundredths, flex_months: f.flex_months, personal_pension_annual_cents: f.personal_pension_annual_cents, marginal_tax_hundredths: f.marginal_tax_hundredths, overrides: f.overrides });
    p.assumptions.wage_growth_hundredths = f.wage_growth_hundredths; p.assumptions.pp_return_hundredths = f.pp_return_hundredths;
  } else if (u.section === 'funds') {
    const f = u.fields;
    Object.assign(core(f.monetary_basis_date), { fund_rules: f.fund_rules, hpf_monthly_cents: f.hpf_monthly_cents, personal_pension_account_id: f.personal_pension_account_id, personal_pension_balance_confirmed: f.personal_pension_balance_confirmed });
  } else if (u.section === 'events') {
    const f = u.fields;
    if (!p.retire.core) throw { code: 'PLANNING_BASIC', message: '先确认金额基准' };
    p.retire.life_events = f.life_events; p.retire.core.occurrences = f.occurrences; p.retire.core.costs = f.costs;
  } else { const f = u.fields; Object.assign(p.retire, { spend_items: f.spend_items, income_items: f.income_items, rent_cents: f.rent_cents, keep_paying_until_age: f.keep_paying_until_age, keep_paying_monthly_cents: f.keep_paying_monthly_cents, keep_paying_base_cents: f.keep_paying_base_cents }); }
  return p;
}
const missingOf = (code: MissingCode, capability: CapabilityName, owner: PlanningMissing['owner'], field: string, message: string, kind: PlanningMissing['kind'] = 'fact'): PlanningMissing => ({ code, capability, owner, field, message, kind });
const retag = (m: PlanningMissing[], capability: CapabilityName) => m.map(x => ({ ...x, capability }));
function previewCapabilities(sources: PlanningSources, o: CapabilityOptions): BasicCapabilities {
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  const bd = o.drafts.find(x => x.section === 'basic')?.fields as BasicFields | undefined, fd = o.drafts.find(x => x.section === 'funds')?.fields as FundsFields | undefined, pd = o.drafts.find(x => x.section === 'pension')?.fields as PensionFields | undefined;
  const r = saved?.profile.retire, basic = bd?.basic ?? r?.basic, target = bd ? bd.target_age : r?.target_age ?? null, spend = bd ? bd.spend_cents : r?.spend_cents ?? null;
  const core = r?.core, rules = fd?.fund_rules ?? core?.fund_rules ?? [];
  const sim = basic?.start.kind === 'simulation' ? basic.start : null;
  const snap = sources.snapshot.status === 'ready' ? sources.snapshot.value : null;
  const start = basic?.start ?? null;
  const funds: BasicCapabilities['funds'] = !basic ? { status: 'blocked', missing: [missingOf('START_UNKNOWN', 'funds', 'basic', 'basic.start', '还没有选择资金起点。')] }
    : sim ? (sim.available_cents === null ? { status: 'blocked', missing: [missingOf('START_UNKNOWN', 'funds', 'basic', 'basic.start.available_cents', '模拟起点的金额还没有填写。')] } : { status: 'ready', value: { available_cents: sim.available_cents, restricted_cents: '0', debt_cents: '0', date: sim.date ?? todayIso, kind: 'simulation' } })
    : !sources.modules.wealth ? { status: 'blocked', missing: [missingOf('WEALTH_DISABLED', 'funds', 'basic', 'basic.start', '资产与盘点已关闭，请改用模拟起点。', 'constraint')] }
    : !snap ? { status: 'blocked', missing: [missingOf(sources.snapshot.status === 'error' ? 'SOURCE_ERROR' : 'START_UNKNOWN', 'funds', 'service', 'snapshot', sources.snapshot.status === 'error' ? '盘点读取失败，请重新读取。' : '还没有完整盘点。', sources.snapshot.status === 'error' ? 'read_error' : 'fact')] }
    : snap.entries.some(e => e.counted && e.side === 'asset' && !rules.some(x => x.account_id === e.account_id)) ? { status: 'blocked', missing: [missingOf('FUNDS_UNCONFIRMED', 'funds', 'funds', 'core.fund_rules', '有账户的规划用途还没有确认。', 'assumption')] }
    : (() => { const n = normalizeFunds(snap, { ...(core ?? emptyCore(todayIso)), fund_rules: rules }); return { status: 'ready' as const, value: { available_cents: String(n.available ?? 0), restricted_cents: String(n.restricted), debt_cents: String(n.debt), date: snap.date, kind: 'live' as const } }; })();
  void start;
  const factsComplete = pd ? [pd.worker, pd.paid_months, pd.account_balance_cents, pd.base_cents, pd.flex_months, pd.personal_pension_annual_cents, pd.marginal_tax_hundredths].every(v => v !== null) : !!saved && hasPensionProfile(saved.profile);
  const mode = basic?.retirement_income.mode ?? null;
  const pension: BasicCapabilities['pension'] = mode === 'beijing' ? (factsComplete ? { status: 'ready', value: { included: true, start_month: '2050-06', monthly_cents: '200000' } } : { status: 'blocked', missing: [missingOf('PENSION_FACTS_UNKNOWN', 'pension', 'pension', 'profile', '政策估算需要的养老金事实还没有填完整；留空的项目保持未知。')] }) : mode === null ? { status: 'blocked', missing: [missingOf('INCOME_MODE_UNKNOWN', 'pension', 'basic', 'basic.retirement_income.mode', '还没有选择退休收入怎么计入。', 'assumption')] } : { status: 'ready', value: { included: false, start_month: null, monthly_cents: null } };
  const scopes = new Set(basic?.retirement_costs.map(c => c.source_id));
  const unscoped = r ? retirementSources(r).filter(x => !scopes.has(x.id)) : [];
  const miss: PlanningMissing[] = [
    ...(target === null ? [missingOf('TARGET_UNKNOWN', 'requirement', 'basic', 'target_age', '目标年龄还没有设定。')] : []),
    ...(spend === null ? [missingOf('BUDGET_UNKNOWN', 'requirement', 'basic', 'spend_cents', '退休后每月预算还没有填写。')] : []),
    ...(funds.status === 'blocked' ? retag(funds.missing, 'requirement') : []),
    ...(pension.status === 'blocked' ? retag(pension.missing, 'requirement') : []),
    ...(unscoped.length ? [missingOf('COST_SCOPE_UNKNOWN', 'requirement', 'budget', 'basic.retirement_costs', `${unscoped.map(x => x.label).join('、')}是否已含在总预算里，还没有确认。`, 'assumption')] : []),
  ];
  const req = params.get('plan-req');
  const found = unknownCapabilityFixture.requirement.status === 'ready' ? unknownCapabilityFixture.requirement.value : null!;
  const reqValue = { ...found, set: req === 'zero' ? { status: 'no_positive_contribution' as const, monthly_cents: '0' as const, before_hundredths: 0, after_hundredths: 0 } : req === 'not-found' ? { status: 'search_not_found' as const, search_limit_cents: '100000000', before_hundredths: 0, after_hundredths: 0 } : req === 'payment' ? { status: 'payment_constraint' as const, message: '月初付款在月底投入前就不够。', before_hundredths: 0, after_hundredths: 0 } : req === 'bounds' ? { status: 'out_of_bounds' as const, message: '偏低收益低于可计算范围。', before_hundredths: 0, after_hundredths: 0 } : found.set, lower: req === 'bounds' ? { status: 'out_of_bounds' as const, message: '偏低收益低于可计算范围。', before_hundredths: -200, after_hundredths: -200 } : found.lower };
  const requirement: BasicCapabilities['requirement'] = miss.length ? { status: 'blocked', missing: miss } : { status: 'ready', value: reqValue };
  const c = o.contribution ?? (bd ? bd.basic.contribution.monthly_cents : basic?.contribution.monthly_cents ?? null);
  const baseValue = predictionCapabilityFixture.prediction.status === 'ready' ? predictionCapabilityFixture.prediction.value : null!;
  const prediction: BasicCapabilities['prediction'] = c === null ? { status: 'blocked', missing: [missingOf('CONTRIBUTION_UNKNOWN', 'prediction', 'basic', 'basic.contribution.monthly_cents', '预计投入未填写，所以不推算达成时间与路径。', 'assumption')] }
    : miss.length ? { status: 'blocked', missing: retag(miss, 'prediction') }
    : (() => { const plan = { ...baseValue.plan, saving_cents: Number(c), assets_cents: funds.status === 'ready' ? Number(funds.value.available_cents) : baseValue.plan.assets_cents }, proj = project(plan, Number(todayIso.slice(0, 4))), out = outcome(plan, proj); return { status: 'ready' as const, value: { source: o.contribution !== null ? 'temporary' as const : 'saved' as const, contribution_cents: c, plan, plan0: plan, projection: proj, outcome: out, terminal: params.get('plan-terminal') === 'zero' || basicScenario === 'terminal-zero' ? 'no_margin' as const : out.shortfall_month !== null ? 'gap' as const : 'surplus' as const } }; })();
  return { context: { generation: sources.generation, revision: saved?.revision ?? null, today: sources.today, model_version: 'basic-1', modules: sources.modules, start: sim ? { kind: 'simulation', id: sim.id, date: sim.date } : { kind: 'live', snapshot_id: snap?.id ?? null, revision: snap?.revision ?? null, date: snap?.date ?? null }, monetary_basis_date: core?.monetary_basis_date ?? null, source: o.contribution !== null ? 'temporary' : 'saved', write_version: sources.write_version }, funds, requirement, prediction, pension };
}
if (new URLSearchParams(location.search).get('capabilities') !== 'real') bindCapabilityProvider(previewCapabilities);
let searchPreviewAttempts = 0;
export function searchPreview(command: string, args: Record<string, unknown>): { value: unknown } | null {
  if (command !== 'search_all') return null;
  const input = args.input as { keyword: string; type_filter: string; offset: number; limit: number; generation: string };
  if (params.get('search') === 'error-once' && searchPreviewAttempts++ === 0) throw { message: '虚构读取失败，请重新搜索。' };
  const fold = (value: string) => value.replace(/[A-Z]/g, c => c.toLowerCase());
  const keyword = fold(input.keyword.trim());
  if ([...input.keyword.trim()].length > 200 || input.keyword.includes('\0')) throw { message: '关键词最多 200 个字符且不能包含空字符。' };
  if (!keyword) throw { code: 'QUERY', message: '空关键词不查询' };
  if (input.generation !== generation) throw { code: 'STALE_DATASET', message: '资料库已变化，请返回后重新读取。' };
  type Row = { kind: string; id: string; title: string; date: string | null; status: string; matched_field: string; context: string; target: unknown; at: string; primary: boolean };
  const rows: Row[] = [];
  const push = (row: Omit<Row, 'context' | 'matched_field'>, fields: [string, string | null | undefined, boolean][]) => {
    for (const [label, value, primary] of fields) {
      if (value && fold(value).includes(keyword)) {
        rows.push({ ...row, matched_field: label, context: (() => { const at = value.slice(0, fold(value).indexOf(keyword)).length; const before = [...value.slice(0, at)].length; const chars = [...value]; const start = Math.max(0, before - 40), end = Math.min(chars.length, before + [...keyword].length + 40); return (start ? '…' : '') + chars.slice(start, end).join('') + (end < chars.length ? '…' : ''); })(), primary });
        return;
      }
    }
  };
  for (const w of wishes) push({ kind: 'wish', id: w.id, title: w.fields.name, date: w.created_at.slice(0, 10), status: w.decision_state === 'purchased' ? '已购入' : w.decision_state === 'dropped' ? '不再考虑' : w.decision_state === 'legacy_achieved' ? '历史待核实' : '考虑中', target: { kind: 'wish', id: w.id }, at: w.created_at, primary: false }, [['名称', w.fields.name, true], ['考虑理由', w.fields.notes, false], ['决定备注', w.decision_note, false], ['相关链接', w.fields.external_link, false]]);
  for (const a of accounts) push({ kind: 'account', id: a.id, title: a.fields.name, date: a.fields.opened_on, status: a.fields.closed_on ? '已停用' : '在用', target: { kind: 'account', id: a.id }, at: '', primary: false }, [['名称', a.fields.name, true], ['类型', kindLabel(a.fields.kind), false], ['平台', a.fields.institution, false], ['备注', a.fields.notes, false]]);
  for (const s of snapshots) push({ kind: 'snapshot', id: s.id, title: s.date, date: s.date, status: '', target: { kind: 'snapshot', id: s.id }, at: s.date, primary: false }, [['日期', s.date, true], ['备注', s.notes, false]]);
  for (const e of expenses) if (!e.fields.asset_id) push({ kind: 'expense', id: e.id, title: e.fields.title, date: e.fields.date, status: '', target: { kind: 'expense', id: e.id }, at: e.fields.date, primary: false }, [['名称', e.fields.title, true], ['分类', expenseCategories.find(([key]) => key === e.fields.category)?.[1], false], ['备注', e.fields.notes, false], ['日期', e.fields.date, false]]);
  for (const p of plans) push({ kind: 'plan', id: p.id, title: p.fields.name, date: p.fields.first_due, status: p.fields.paused ? '已暂停' : '进行中', target: { kind: 'plan', id: p.id }, at: p.fields.first_due, primary: false }, [['名称', p.fields.name, true], ['类别', recurringCategories.find(([key]) => key === p.fields.category)?.[1], false], ['备注', p.fields.notes, false]]);
  for (const pay of payments) push({ kind: 'payment', id: pay.id, title: `${pay.plan_name} · ${pay.due_date}`, date: pay.paid_date ?? pay.due_date, status: pay.state === 'paid' ? '已付' : '已跳过', target: { kind: 'payment', id: pay.id, plan_id: pay.plan_id }, at: pay.due_date, primary: false }, [['所属计划', pay.plan_name, true], ['应付日期', pay.due_date, true], ['实付日期', pay.paid_date, false], ['付款备注', pay.notes, false]]);
  for (const v of virtuals) push({ kind: 'virtual', id: v.id, title: v.fields.name, date: v.fields.purchase_date, status: v.fields.stopped_on ? '已停用' : '使用中', target: { kind: 'virtual', id: v.id }, at: (v.fields.purchase_date ?? ''), primary: false }, [['名称', v.fields.name, true], ['类型', virtualKindText(v.fields.kind), false], ['标签', null, false], ['备注', v.fields.notes, false]]);
  for (const t of topups) {
    const parent = virtuals.find(v => v.id === t.asset_id);
    if (!parent) continue;
    push({kind: 'topup', id: t.id, title: parent.fields.name, date: t.fields.topup_date, status: '', target: {kind: 'topup', id: t.id, asset_id: t.asset_id}, at: t.fields.topup_date ?? '', primary: false}, [['档案名称', parent.fields.name, true], ['充值日期', t.fields.topup_date, true], ['充值备注', t.fields.notes, false]]);
  }
  // Demo assets join by their fixture names.
  for (const a of demoAssets) push({ kind: 'asset', id: a.key, title: a.name, date: a.purchase_date ?? null, status: '使用中', target: { kind: 'asset', id: a.key }, at: a.purchase_date ?? '', primary: false }, [['名称', a.name, true], ['备注', a.notes, false]]);
  const order = ['asset', 'wish', 'account', 'snapshot', 'expense', 'plan', 'payment', 'virtual', 'topup'];
  rows.sort((a, b) => Number(b.primary) - Number(a.primary) || b.at.localeCompare(a.at) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.id.localeCompare(b.id));
  const type_counts = order.map(kind => [kind, rows.filter(r => r.kind === kind).length] as [string, number]);
  const filtered = input.type_filter === 'all' ? rows : rows.filter(r => r.kind === input.type_filter);
  return { value: { generation, revision: 'preview-layout-only', keyword: input.keyword.trim(), type_filter: input.type_filter, offset: input.offset, limit: input.limit, total: filtered.length, type_counts, items: filtered.slice(input.offset, input.offset + input.limit) } };
}
const previewGroups = new Map<string, { assetId: string; planId: string; assetName: string; planName: string }>();
/** 预览最近删除中的关联订阅组（内存桩）。 */
export function previewLinkGroups() { return [...previewGroups.values()]; }
export function wealthPreview(command: string, args: Record<string, unknown>): { value: unknown } | null {
  if (command === 'notification_permission') return { value: null };
  // ---- 关联订阅命令的内存桩（EXPENSE_OVERVIEW_SUBSCRIPTION_LINKS_DESIGN）----
  if (command === 'link_view') {
    const kind = args.kind as 'virtual' | 'plan', id = args.id as string;
    if (params.get('link') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' };
    const asset = virtuals.find(v => (kind === 'virtual' ? v.id === id : v.fields.plan_id === id));
    const plan = plans.find(p => (kind === 'plan' ? p.id === id : p.id === asset?.fields.plan_id));
    const paid = payments.filter(p => p.plan_id === plan?.id && p.state === 'paid');
    const relation = asset && plan ? 'linked' : plan ? 'asset_trashed' : 'unlinked';
    return { value: { generation, relation, asset: asset ? { id: asset.id, name: asset.fields.name, revision: asset.revision, deleted: false, billing: 'subscription', stopped_on: asset.fields.stopped_on ?? null } : null, plan: plan ? { id: plan.id, name: plan.fields.name, revision: plan.revision, deleted: false, category: plan.fields.category, end_date: plan.fields.end_date ?? null, auto_renew: plan.fields.auto_renew ?? true, paused: plan.fields.paused, service_start: plan.fields.service_start ?? null } : null, paid_count: paid.length, skipped_count: 0, paid_cents: String(paid.reduce((t, p) => t + BigInt(p.amount_cents ?? '0'), 0n)), paid_until: paid.at(-1)?.due_date ?? null, needs_review: !!asset?.fields.stopped_on && (plan?.fields.end_date ?? null) === null, occupied_by: null, candidates: [], group: null, reminder: null } };
  }
  if (command === 'link_delete_preview' || command === 'link_restore_preview') {
    if (params.get('link') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' };
    if (command === 'link_delete_preview') {
      const side = args.side as 'virtual' | 'plan', id = args.id as string;
      const asset = virtuals.find(v => (side === 'virtual' ? v.id === id : v.fields.plan_id === id));
      const plan = plans.find(p => (side === 'plan' ? p.id === id : p.id === asset?.fields.plan_id));
      const paid = payments.filter(p => p.plan_id === plan?.id && p.state === 'paid');
      return { value: { generation, preview: 'preview-fixture', asset_id: asset?.id ?? '', plan_id: plan?.id ?? '', asset_name: asset?.fields.name ?? '', plan_name: plan?.fields.name ?? '', asset_revision: asset?.revision ?? 1, plan_revision: plan?.revision ?? 1, paid_count: paid.length, skipped_count: 0, paid_cents: String(paid.reduce((t, p) => t + BigInt(p.amount_cents ?? '0'), 0n)), blockers: [], partner_deleted: false } };
    }
    const groupId = args.groupId as string;
    const [assetId, planId] = groupId.split('|');
    const asset = virtuals.find(v => v.id === assetId), plan = plans.find(p => p.id === planId);
    return { value: { generation, preview: 'preview-fixture', group_id: groupId, asset_name: asset?.fields.name ?? '', plan_name: plan?.fields.name ?? '', payments_hidden: payments.filter(p => p.plan_id === planId).length, payments_stay_deleted: 0, blockers: [] } };
  }
  if (command === 'link_trash') {
    const input = args.input as { request_id: string; side: 'virtual' | 'plan'; id: string; asset_expected_revision: number; plan_expected_revision: number };
    const asset = virtuals.find(v => (input.side === 'virtual' ? v.id === input.id : v.fields.plan_id === input.id));
    const plan = plans.find(p => (input.side === 'plan' ? p.id === input.id : p.id === asset?.fields.plan_id));
    if (!asset || !plan) throw { message: '找不到这组关联订阅' };
    virtuals = virtuals.filter(v => v.id !== asset.id);
    plans = plans.filter(p => p.id !== plan.id);
    payments = payments.filter(p => p.plan_id !== plan.id);
    const groupId = `${asset.id}|${plan.id}`;
    receipts.set(input.request_id ?? crypto.randomUUID(), groupId);
    previewGroups.set(groupId, { assetId: asset.id, planId: plan.id, assetName: asset.fields.name, planName: plan.fields.name });
    return { value: groupId };
  }
  if (command === 'link_restore') {
    const input = args.input as { group_id: string };
    const g = previewGroups.get(input.group_id);
    if (!g) throw { message: '这组记录已恢复或已清除，请重新读取最近删除' };
    previewGroups.delete(input.group_id);
    const plan = g ? recurringOverview().plans.find(() => false) : null;
    void plan;
    return { value: input.group_id };
  }
  if (command === 'link_save' || command === 'link_create' || command === 'link_reconcile') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as { request_id: string; fields?: { name?: string; amount_cents?: string } };
    if (input.fields?.name && input.fields.amount_cents) {
      plans = plans.map(p => p.fields.name === input.fields!.name || p.id === (args.input as { plan_id?: string }).plan_id ? { ...p, fields: { ...p.fields, name: input.fields!.name!, amount_cents: input.fields!.amount_cents! }, revision: p.revision + 1 } : p);
    }
    receipts.set(input.request_id, 'link');
    return { value: 'link' };
  }
  if (command === 'virtual_reminder_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as ReminderSave;
    if (input.reminder) renewalReminders.set(input.asset_id, { ...input.reminder, repeat_every_period: input.repeat_every_period ?? false, lead_days: input.lead_days ?? 3 });
    else renewalReminders.delete(input.asset_id);
    virtuals = virtuals.map(v => v.id === input.asset_id ? { ...v, revision: v.revision + 1 } : v);
    receipts.set(input.request_id, input.asset_id);
    return { value: virtualOverview().items.find(v => v.id === input.asset_id) };
  }
  if (command === 'recurring_overview') { if (params.get('recurring') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' }; return { value: recurringOverview() }; }  if (command === 'recurring_plan_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as PlanSave, id = input.id ?? crypto.randomUUID(), old = plans.find(p => p.id === id);
    const next: Plan = { id, fields: input.fields, revision: (old?.revision ?? 0) + 1, active_from: old ? (old.fields.paused && !input.fields.paused ? todayIso : old.active_from) : input.fields.service_start ? (todayIso > input.fields.first_due ? todayIso : input.fields.first_due) : input.fields.first_due, next_due: null };
    plans = old ? plans.map(p => p.id === id ? next : p) : [...plans, next];
    receipts.set(input.request_id, id);
    return { value: next };
  }
  if (command === 'recurring_payment_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as PaymentSave, p = plans.find(x => x.id === input.plan_id)!;
    if (!input.id && payments.some(x => x.plan_id === input.plan_id && x.due_date === input.due_date)) throw { code: 'PAYMENT_EXISTS', message: '这一期已经记录过，请打开原记录更正' };
    const id = input.id ?? crypto.randomUUID(), old = payments.find(x => x.id === id);
    const next: Payment = { coverage_start: old?.coverage_start ?? coverageFor(p.fields,input.due_date)?.[0], coverage_end: old?.coverage_end ?? coverageFor(p.fields,input.due_date)?.[1], id, plan_id: p.id, plan_name: p.fields.name, due_date: input.due_date, state: input.state, paid_date: input.paid_date, amount_cents: input.amount_cents, notes: input.notes, revision: (old?.revision ?? 0) + 1, off_schedule: false };
    payments = old ? payments.map(x => x.id === id ? next : x) : [...payments, next];
    receipts.set(input.request_id, id);
    return { value: next };
  }
  if (command === 'recurring_payment_range_save') {
    if (params.get('state') === 'save-error') throw {message:'模拟保存失败，输入应保留。'};
    const input=args.input as PaymentRangeSave, p=plans.find(x=>x.id===input.plan_id)!;
    if (!input.confirmed) throw {message:'请明确确认实际已付'};
    for (const d of schedule(p,input.from_due,input.to_due)) {
      if (payments.some(x=>x.plan_id===p.id&&x.due_date===d)) continue;
      payments.push({id:crypto.randomUUID(),plan_id:p.id,plan_name:p.fields.name,due_date:d,state:'paid',paid_date:d,amount_cents:input.amount_cents,notes:'虚构范围补记',revision:1,off_schedule:false,coverage_start:coverageFor(p.fields,d)?.[0],coverage_end:coverageFor(p.fields,d)?.[1]});
    }
    receipts.set(input.request_id,p.id);return {value:p.id};
  }
  if (command === 'virtual_overview') { if (params.get('virtual') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' }; return { value: virtualOverview() }; }
  if (command === 'wealth_trash') {
    const input = args.input as { kind: string; id: string; deleted: boolean };
    if (input.kind === 'topup') {
      topups = input.deleted ? topups.filter(t => t.id !== input.id) : topups;
      return { value: null };
    }
    if (input.kind === 'balance') {
      balances = input.deleted ? balances.filter(b => b.id !== input.id) : balances;
      return { value: null };
    }
    if (input.kind === 'income') {
      if (input.deleted) { const row = planIncomes.find(i => i.id === input.id); if (row) { planTrash = [...planTrash, { ...row, revision: row.revision + 1 }]; planIncomes = planIncomes.filter(i => i.id !== input.id); } }
      else { const row = planTrash.find(i => i.id === input.id); if (row) { planIncomes = [...planIncomes, { ...row, revision: row.revision + 1 }]; planTrash = planTrash.filter(i => i.id !== input.id); } }
      return { value: null };
    }
    return { value: null };
  }
  if (command === 'virtual_topup_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as TopupSave;
    topups = [...topups, { id: input.id ?? crypto.randomUUID(), asset_id: input.asset_id, fields: input.fields, revision: 1 }];
    receipts.set(input.request_id, input.asset_id);
    return { value: { id: input.id ?? '', asset_id: input.asset_id, fields: input.fields, revision: 1 } };
  }
  if (command === 'virtual_balance_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as BalanceSave;
    balances = [...balances, { id: input.id ?? crypto.randomUUID(), asset_id: input.asset_id, balance_cents: input.balance_cents, recorded_on: input.recorded_on, notes: input.notes, revision: 1 }];
    receipts.set(input.request_id, input.asset_id);
    return { value: { id: input.id ?? '', asset_id: input.asset_id, balance_cents: input.balance_cents, recorded_on: input.recorded_on, notes: input.notes, revision: 1 } };
  }
  if (command === 'virtual_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as VirtualSave, id = input.id ?? crypto.randomUUID(), old = virtuals.find(v => v.id === id);
    const taken = input.fields.plan_id && virtuals.find(v => v.fields.plan_id === input.fields.plan_id && v.id !== id);
    if (taken) throw { code: 'VIRTUAL_PLAN_TAKEN', message: `这项计划已关联「${taken.fields.name}」` };
    if(input.plan) {
      const pid=input.plan.id??crypto.randomUUID(), oldPlan=plans.find(x=>x.id===pid);
      const pf=input.plan.fields;
      const nextPlan: Plan={id:pid,fields:pf,revision:(oldPlan?.revision??0)+1,active_from:oldPlan?.active_from??(todayIso>pf.first_due?todayIso:pf.first_due),next_due:null,renewal_cents:input.renewal_price_cents||null,renewal_from:input.renewal_price_cents?input.renewal_from??null:null,special_start:null,special_end:null};
      plans=oldPlan?plans.map(x=>x.id===pid?nextPlan:x):[...plans,nextPlan];
      input.fields={...input.fields,plan_id:pid,price_cents:null,expires:null};
    }
    // R6：空串取消未生效价格段；null 不触碰（预览内存模型）。
    if(input.renewal_price_cents===''){const pid=input.fields.plan_id;const p=plans.find(x=>x.id===pid);if(p){p.renewal_cents=null;p.renewal_from=null;}}
    // R13：首次充值随档案保存进入事实列表（到账默认实付＋赠送）。
    if(input.first_topup&&input.first_topup.paid_cents!=null){
      const credit=input.first_topup.credit_cents??String(BigInt(input.first_topup.paid_cents||'0')+BigInt(input.first_topup.gift_cents||'0'));
      topups=[...topups,{id:crypto.randomUUID(),asset_id:id,fields:{...input.first_topup,credit_cents:credit},revision:1}];
    }
    const next = { id, fields: input.fields, revision: (old?.revision ?? 0) + 1 };
    virtuals = old ? virtuals.map(v => v.id === id ? next : v) : [...virtuals, next];
    receipts.set(input.request_id, id);
    return { value: virtualOverview().items.find(v => v.id === id) };
  }
  if (command === 'expense_view') { if (params.get('expenses') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' }; return { value: expenseView((args.year as number | null) ?? null) }; }
  if (command === 'expense') return { value: expenses.find(e => e.id === args.id) ?? null };
  if (command === 'expense_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as ExpenseSave, id = input.id ?? crypto.randomUUID(), old = expenses.find(e => e.id === id);
    const next: Expense = { id, fields: input.fields, revision: (old?.revision ?? 0) + 1, asset_name: input.fields.asset_id ? demoAssets.find(a => a.key === input.fields.asset_id)?.name ?? '虚构物品' : null, asset_deleted: false };
    expenses = old ? expenses.map(e => e.id === id ? next : e) : [...expenses, next];
    receipts.set(input.request_id, id);
    return { value: next };
  }
  if (command === 'modules_get') return { value: { ...allModules, wealth: params.get('plan-wealth') !== 'off' } };
  if (command === 'planning_sources') { if (params.get('plan') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' }; return { value: planningSources(args) }; }
  if (command === 'plan_profile_update') {
    const input = args.input as ProfileUpdate;
    if (updateResults.has(input.request_id)) return { value: updateResults.get(input.request_id) };
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    if (input.generation !== generation) throw { code: 'STALE_DATASET', message: '虚构资料库已变化。' };
    if (input.expected_revision !== (planProfile?.revision ?? null)) throw { code: 'REVISION_CONFLICT', message: '虚构个人资料已变化，请重新读取。' };
    planProfile = { profile: mergeSection(planProfile?.profile ?? null, input), revision: (planProfile?.revision ?? 0) + 1, updated_at: new Date().toISOString() };
    planWriteVersion += 1; updateResults.set(input.request_id, planProfile); receipts.set(input.request_id, 'profile');
    if (params.get('state') === 'unknown-result' && !lostOnce) { lostOnce = true; throw { message: '连接中断，保存结果未知。' }; }
    if (params.get('state') === 'unresolved') throw { message: '连接中断，保存结果未知。' };
    return { value: planProfile };
  }
  if (command.startsWith('plan_')) {
    if (params.get('plan') === 'error' && command !== 'plan_income_save' && command !== 'plan_baseline_mark') throw { message: '虚构读取失败，用于验证错误状态。' };
    if (planFail('profile') && command === 'plan_profile') throw { message: '虚构个人资料读取失败，用于验证首页摘要的局部降级。' };
    if (planFail('review') && command === 'plan_review') throw { message: '虚构储蓄统计读取失败，用于验证首页摘要的局部降级。' };
    if (planFail('income') && command === 'plan_income_list') throw { message: '虚构收入列表读取失败，用于验证首页摘要的局部降级。' };
    if (command === 'plan_profile') return { value: { generation, saved: planProfile } satisfies ProfileState };
    if (command === 'plan_profile_save') {
      if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
      const input = args.input as ProfileSave;
      if (input.generation !== generation) throw { code: 'STALE_DATASET', message: '虚构资料库已变化。' };
      if (input.expected_revision !== (planProfile?.revision ?? null)) throw { code: 'REVISION_CONFLICT', message: '虚构个人资料已变化，请重新读取。' };
      planProfile = { profile: input.profile, revision: (planProfile?.revision ?? 0) + 1, updated_at: new Date().toISOString() };
      receipts.set(input.request_id, 'profile');
      return { value: planProfile };
    }
    if (command === 'plan_income_list') return { value: { generation, rows: [...planIncomes].sort((a, b) => b.fields.date.localeCompare(a.fields.date) || a.id.localeCompare(b.id)) } };
    if (command === 'plan_income_save') {
      if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
      const input = args.input as IncomeSave, id = input.id ?? crypto.randomUUID(), old = planIncomes.find(i => i.id === id);
      const next: Income = { id, fields: input.fields, revision: (old?.revision ?? 0) + 1 };
      planIncomes = old ? planIncomes.map(i => i.id === id ? next : i) : [...planIncomes, next];
      receipts.set(input.request_id, id);
      return { value: next };
    }
    if (command === 'plan_review') return { value: computeReview(summary().points, planIncomes, planMarks, generation) };
    if (command === 'plan_baseline_mark') {
      const input = args.input as Mark;
      if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
      if (input.excluded) planMarks.add(input.snapshot_id); else planMarks.delete(input.snapshot_id);
      receipts.set(input.request_id, input.snapshot_id);
      return { value: null };
    }
    if (command === 'plan_interval_reasons') {
      if (params.get('plan') === 'reasons-error') throw { message: '虚构读取失败，用于验证原因区的局部错误。' };
      const point = summary().points.find(p => p.snapshot_id === String(args.snapshotId) && p.complete && p.compared_to);
      if (!point) throw { code: 'NOT_FOUND', message: '找不到这次盘点' };
      const from = point.compared_to!;
      const lines = [...expenseView(null).lines].filter(l => l.date !== null && l.date > from && l.date <= point.date && l.amount_cents !== null && l.source !== 'linked')
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
      const reasons: Reasons = { generation, snapshot_id: point.snapshot_id, from, to: point.date, notes: point.notes, lines };
      return { value: reasons };
    }
    return null;
  }
  if (!command.startsWith('wealth_')) return null;
  if (params.get('wealth') === 'error' && command !== 'wealth_request_result') throw { message: '虚构读取失败，用于验证错误状态。' };
  if (command === 'wealth_summary') { if (params.get('wealth') === 'error') throw { message: '虚构盘点读取失败。' }; return { value: summary() }; }
  if (command === 'wealth_accounts') return { value: accounts.map(withLatest) };
  if (command === 'wealth_request_result') { if (params.get('state') === 'unresolved') throw { message: '暂时无法核对。' }; return { value: receipts.get(String(args.request)) ?? null }; }
  // 只读详情：按稳定 ID 读取一次盘点（§5.2），浏览不写资料。
  if (command === 'wealth_snapshot') { if (planFail('snapshot')) throw { message: '虚构盘点明细读取失败，用于验证首页摘要的局部降级。' }; const found = snapshots.find(s => s.id === String(args.id)); return { value: found ? view(found) : null }; }
  if (command === 'wealth_snapshot_draft') {
    const date = String(args.date), existing = snapshots.find(s => s.date === date);
    const draft: Draft = { generation, date, existing: existing ? view(existing) : null, rows: accounts.filter(a => due(a, date)).map(a => ({ account: withLatest(a), previous: latestBefore(a.id, date) })) };
    return { value: draft };
  }
  // U20 账户变化：预览模拟，规则与 Rust wealth_compare 一致（产品设计 17.14.4）。
  if (command === 'wealth_compare') {
    if (params.get('wealth') === 'compare-error') throw { message: '虚构账户变化读取失败，用于验证局部错误。' };
    const from = snapshots.find(s => s.id === String(args.from)), to = snapshots.find(s => s.id === String(args.to));
    if (!from || !to) throw { code: 'NOT_FOUND', message: '找不到起点或终点盘点' };
    if (from.date >= to.date) throw { code: 'WEALTH_COMPARE_RANGE', message: '起点盘点须早于终点' };
    const fv = view(from), tv = view(to);
    const cellOf = (a: Account, s: Stored): CompareCell => {
      const e = s.entries.find(x => x.account_id === a.id);
      if (e) return { state: e.amount_cents === null ? 'missing' : e.state, amount_cents: e.amount_cents, counted: e.counted };
      const state = a.fields.opened_on > s.date ? 'not_open' : a.fields.closed_on !== null && s.date >= a.fields.closed_on ? 'closed' : 'missing';
      return { state, amount_cents: null, counted: null };
    };
    const rows: CompareRow[] = [];
    for (const a of accounts) {
      const fc = cellOf(a, fv), tc = cellOf(a, tv);
      const outside = (c: CompareCell) => c.state === 'not_open' || c.state === 'closed';
      if (outside(fc) && outside(tc)) continue;
      const fe = fv.entries.find(x => x.account_id === a.id), te = tv.entries.find(x => x.account_id === a.id);
      const side = (te ?? fe ?? { side: a.fields.side } as Entry).side as 'asset' | 'liability', kind = (te ?? fe ?? { kind: a.fields.kind } as Entry).kind;
      const group: CompareRow['group'] = fc.counted !== null && tc.counted !== null && fc.counted !== tc.counted ? 'scope_changed'
        : (tc.counted ?? fc.counted ?? a.fields.counted) ? 'counted' : 'uncounted';
      const val = (c: CompareCell) => outside(c) ? 0n : c.amount_cents === null ? null : BigInt(c.amount_cents);
      const f = val(fc), t = val(tc);
      const change = f === null || t === null ? null : (t - f).toString();
      const effect = change === null ? null : (side === 'liability' ? -BigInt(change) : BigInt(change)).toString();
      const rate = side !== 'asset' || f === null || f <= 0n || change === null ? null : hundredths(BigInt(change), f);
      const tag: CompareRow['tag'] = fc.state === 'not_open' ? 'new' : tc.state === 'closed' ? 'closed' : null;
      rows.push({ account_id: a.id, name: a.fields.name, institution: a.fields.institution, side, kind, from: fc, to: tc, change_cents: change, effect_cents: effect, rate_hundredths: rate, group, tag });
    }
    const reconciled = !fv.missing.length && !tv.missing.length && !rows.some(r => r.group === 'scope_changed');
    const knownEffect = rows.filter(r => r.group === 'counted' && r.effect_cents !== null).reduce((t, r) => t + BigInt(r.effect_cents!), 0n);
    const netOf = (s: Stored) => (side: string) => s.entries.filter(e => e.counted && e.side === side && e.amount_cents !== null).reduce((t, e) => t + BigInt(e.amount_cents!), 0n);
    let netChange: string | null = null, assetsChange: string | null = null, liabChange: string | null = null, netRate: number | null = null;
    if (reconciled) {
      const fromNet = netOf(fv)('asset') - netOf(fv)('liability'), toNet = netOf(tv)('asset') - netOf(tv)('liability'), diff = toNet - fromNet;
      if (diff !== knownEffect) throw { code: 'WEALTH_COMPARE_MISMATCH', message: '账户变化与净资产变化对不上，请反馈' };
      netChange = diff.toString();
      assetsChange = (netOf(tv)('asset') - netOf(fv)('asset')).toString();
      liabChange = (netOf(tv)('liability') - netOf(fv)('liability')).toString();
      if (fromNet > 0n) netRate = hundredths(diff, fromNet);
    }
    const sharesOf = (s: Stored, side: string): Share[] => {
      const by = new Map<string, bigint>();
      for (const e of s.entries) if (e.counted && e.side === side && e.amount_cents !== null) by.set(e.kind, (by.get(e.kind) ?? 0n) + BigInt(e.amount_cents));
      const total = [...by.values()].reduce((x, y) => x + y, 0n);
      return [...by].map(([kind, v]) => ({ kind, amount_cents: String(v), share_hundredths: total > 0n ? hundredths(v, total) : null }));
    };
    const fShares = sharesOf(fv, 'asset'), tShares = sharesOf(tv, 'asset');
    const structure: StructurePair[] = assetKinds.flatMap(([kind]) => {
      const f = fShares.find(s => s.kind === kind), t = tShares.find(s => s.kind === kind);
      return f || t ? [{ kind, from_cents: f?.amount_cents ?? null, from_share: f?.share_hundredths ?? null, to_cents: t?.amount_cents ?? null, to_share: t?.share_hundredths ?? null }] : [];
    });
    const end = (s: Snapshot): CompareEnd => ({ snapshot_id: s.id, date: s.date, notes: s.notes, complete: !s.missing.length, missing: s.missing.length });
    return { value: {
      generation, from: end(fv), to: end(tv), reconciled, net_change_cents: netChange,
      assets_change_cents: assetsChange, liabilities_change_cents: liabChange, net_rate_hundredths: netRate,
      known_effect_cents: knownEffect.toString(),
      missing_names: rows.filter(r => r.group === 'counted' && (r.from.state === 'missing' || r.to.state === 'missing')).map(r => r.name),
      rows, structure,
    } };
  }
  if (command === 'wealth_account_history') {
    const a = accounts.find(x => x.id === String(args.account));
    if (!a) throw { code: 'NOT_FOUND', message: '找不到账户' };
    const rows: HistoryRow[] = [...snapshots].filter(s => s.entries.some(e => e.account_id === a.id)).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id)).map(s => {
      const e = s.entries.find(x => x.account_id === a.id)!;
      return { snapshot_id: s.id, date: s.date, state: e.state, amount_cents: e.amount_cents, counted: e.counted, change_cents: null };
    });
    // 与前次＝紧邻的前一行，两行都已知才有值，不跨过未知去找更早的值。
    for (let i = 1; i < rows.length; i++) { const p = rows[i - 1], c = rows[i]; if (p.amount_cents !== null && c.amount_cents !== null) c.change_cents = (BigInt(c.amount_cents) - BigInt(p.amount_cents)).toString(); }
    return { value: { generation, account: withLatest(a), rows } };
  }
  if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
  if (command === 'wealth_account_save') {
    const input = args.input as AccountSave;
    if (receipts.has(input.request_id)) return { value: withLatest(accounts.find(a => a.id === receipts.get(input.request_id))!) };
    const id = input.id ?? crypto.randomUUID(), old = accounts.find(a => a.id === id);
    const next: Account = { id, fields: input.fields, position: old?.position ?? accounts.length, revision: (old?.revision ?? 0) + 1, latest: null };
    accounts = old ? accounts.map(a => a.id === id ? next : a) : [...accounts, next];
    receipts.set(input.request_id, id);
    return { value: withLatest(next) };
  }
  if (command === 'wealth_snapshot_save') {
    const input = args.input as SnapshotSave;
    if (receipts.has(input.request_id)) return { value: view(snapshots.find(s => s.id === receipts.get(input.request_id))!) };
    if (snapshots.some(s => s.date === input.date && s.id !== input.id)) throw { code: 'SNAPSHOT_DATE_TAKEN', message: '这一天已有盘点，请打开原盘点更正' };
    const id = input.id ?? crypto.randomUUID(), old = snapshots.find(s => s.id === id);
    const entries = input.entries.map(e => {
      const a = accounts.find(x => x.id === e.account_id)!, kept = old?.entries.find(x => x.account_id === e.account_id);
      const cents = e.state === 'missing' ? null : e.state === 'unchanged' ? latestBefore(a.id, input.date)?.amount_cents ?? null : e.amount_cents;
      return { account_id: a.id, state: e.state, amount_cents: cents, side: kept?.side ?? a.fields.side, kind: kept?.kind ?? a.fields.kind, counted: kept?.counted ?? a.fields.counted };
    });
    const stored = { id, date: input.date, notes: input.notes, revision: (old?.revision ?? 0) + 1, entries };
    snapshots = old ? snapshots.map(s => s.id === id ? stored : s) : [...snapshots, stored];
    receipts.set(input.request_id, id);
    return { value: view(stored) };
  }
  throw { message: '此操作需在原生 App 验证：' + command };
}

// ---- Q03 preview additions -------------------------------------------------
// Fictional wishes with stable IDs: two share a name so same-name source
// resolution stays demonstrable in the browser preview.
type PreviewWish = WishlistItem;
const wishFixture = (id: string, name: string, yuan: string | null, created: string): PreviewWish => ({
  id, fields: { name, category_id: null, estimated_price_cents: yuan, priority: null, target_date: '', external_link: '', notes: '虚构心愿样例：为什么想买、还有什么顾虑。' },
  status: 'ongoing', decision_state: 'considering', decision_note: '', purchase_source: null, revision: 1, created_at: created, updated_at: created, abandoned_at: null, achieved_at: null,
  converted_asset: null, legacy_generated_asset: null, legacy_generated_at: null, cover: null, photos: [],
});
let wishes: PreviewWish[] = params.get('state') === 'empty' ? [] : [
  wishFixture('wish-lens', '虚构心愿 · 相机镜头', '880000', '2026-08-05T09:00:00.000Z'),
  wishFixture('wish-lens-2', '虚构心愿 · 相机镜头', '120000', '2026-09-12T09:00:00.000Z'),
  wishFixture('wish-desk', '虚构心愿 · 实木书桌', '450000', '2026-09-20T09:00:00.000Z'),
];

// 规划预览：?plan-wishes=dates 给前三个心愿设日期（一个未来、一个已过、一个未设）并让最后一个没有价格。
if (params.get('plan-wishes') === 'dates') {
  const future = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const open = wishes.filter(w => w.decision_state === 'considering');
  if (open[0]) open[0].fields.target_date = iso(future);
  if (open[1]) open[1].fields.target_date = '2026-01-15';
  if (open[2]) open[2].fields.estimated_price_cents = null;
}

// U18 布局夹具：心愿按设计 §6.1 覆盖金额/状态组合（价格 2,850、已攒 850、
// 还差 2,000；大金额、未知/零、长名称、已实现/已放弃）；周期按 0/1/30 条
// 付款与长名称/备注构造。仅浏览器预览，刷新即重置。
const layoutWish = (id: string, name: string, price: string | null, prefs: Partial<PreviewWish['preferences']> & { mode: 'countdown' | 'savings' | null }, decision: PreviewWish['decision_state'] = 'considering', created = '2026-09-01T09:00:00.000Z'): PreviewWish => ({
  ...wishFixture(id, name, price, created),
  status: decision === 'purchased' || decision === 'legacy_achieved' ? 'achieved' : decision === 'dropped' ? 'abandoned' : 'ongoing',
  decision_state: decision,
  preferences: { added_date: '2026-09-01', channel_id: null, saved_cents: '0', achievement_source: null, pinned: false, reminder: false, ...prefs },
});
if (params.get('wish-fixture') === 'layout') {
  const [lensTarget] = demoAssets.filter(a => a.key === 'camera');
  wishes = [
    { ...layoutWish('wish-2850', '虚构长名称心愿 · 等待很久的木框全画幅镜头与整套滤镜系统', '285000', { mode: 'savings', saved_cents: '85000' }), replacement_asset: lensTarget ? { id: lensTarget.key, name: lensTarget.name, deleted: false } : null, replacement_asset_name: '' },
    layoutWish('wish-big', '大金额心愿 · 工作室整套设备', '1234567890', { mode: null }),
    layoutWish('wish-unknown', '价格未知心愿 · 待定型号耳机', null, { mode: null }),
    layoutWish('wish-zero', '零价格心愿 · 朋友转让的旧书架', '0', { mode: null }),
    layoutWish('wish-no-date', '无计划日期心愿 · 年度旅行相机包', '99000', { mode: null }),
    layoutWish('wish-done', '已购入心愿 · 键盘', '29900', { mode: null }, 'purchased'),
    layoutWish('wish-given-up', '不再考虑心愿 · 跑步机', '399900', { mode: 'countdown' }, 'dropped'),
    layoutWish('wish-legacy', '历史待核实心愿 · 旧攒钱达标的显示器', '300000', { mode: 'savings', saved_cents: '300000', achievement_source: 'savings' }, 'legacy_achieved'),
  ];
}
if (params.get('recurring-fixture') === '30') {
  const longPlan = plan('r-u18-long', '虚构超长名称周期计划 · 全屋智能安防监控与云存储订阅服务（含设备租赁与上门维护）', 'insurance', '16800', 1, shifted(40), { notes: '虚构长备注：含摄像机三台、门磁两枚的租赁费，每期账单在 3 日后出账，可延期一周缴纳。' });
  const singlePlan = plan('r-u18-one', '单期付款计划 · 域名续费', 'subscription', '8800', 12, shifted(13));
  const emptyPlan = plan('r-u18-none', '还没有付款的计划 · 视频会员', 'subscription', '2500', 1, shifted(0, 1));
  plans = [...plans, longPlan, singlePlan, emptyPlan];
  payments = [
    ...payments,
    ...Array.from({ length: 30 }, (_, i) => {
      const d = nth(longPlan.fields.first_due, 1, i);
      const skipped = i % 7 === 3;
      return { id: `p-u18-long-${i}`, plan_id: longPlan.id, plan_name: longPlan.fields.name, due_date: d, state: skipped ? ('skipped' as const) : ('paid' as const), paid_date: skipped ? null : d, amount_cents: skipped ? null : longPlan.fields.amount_cents, notes: skipped ? '本期不付：外出停用一个月' : '虚构付款备注，用于检查长文本折行。', revision: 1, off_schedule: false };
    }),
    { id: 'p-u18-one-0', plan_id: singlePlan.id, plan_name: singlePlan.fields.name, due_date: nth(singlePlan.fields.first_due, 12, 0), state: 'paid', paid_date: nth(singlePlan.fields.first_due, 12, 0), amount_cents: singlePlan.fields.amount_cents, notes: '', revision: 1, off_schedule: false },
  ];
}

export function previewWishPage(query: WishlistQuery): WishlistPage {
  const found = wishes.filter(w => (!query.search || w.fields.name.toLowerCase().includes(query.search.toLowerCase()))
    && (query.filter === 'all' || w.decision_state === query.filter || (query.filter === 'considering' && w.decision_state === 'legacy_achieved')));
  const value = (w: PreviewWish): string | number | null => query.sort === 'name' ? w.fields.name.toLowerCase() : query.sort === 'priority' ? w.fields.priority ?? null : query.sort === 'price' ? w.fields.estimated_price_cents === null ? null : Number(w.fields.estimated_price_cents) : query.sort === 'target' ? w.fields.target_date ?? null : w.preferences?.added_date ?? w.created_at.slice(0,10);
  found.sort((a, b) => { const pinned=Number(!!b.preferences?.pinned)-Number(!!a.preferences?.pinned); if(pinned)return pinned; const x=value(a),y=value(b); if(x===null && y!==null)return 1;if(y===null && x!==null)return -1;const order=x===null?0:typeof x==='number' && typeof y==='number'?x-y:String(x)<String(y)?-1:String(x)>String(y)?1:0;return order*(query.descending?-1:1)||b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id); });
  const considering = wishes.filter(w => w.decision_state === 'considering');
  return { generation, items: found.slice(query.offset, query.offset + 100).map(w => structuredClone(w)), total: found.length,
    considering_known_cents: String(considering.reduce((t, w) => t + BigInt(w.fields.estimated_price_cents ?? '0'), 0n)),
    considering_unknown_count: considering.filter(w => w.fields.estimated_price_cents === null).length,
    legacy_achieved_count: wishes.filter(w => w.decision_state === 'legacy_achieved').length };
}
export function previewReadWish(id: string): WishlistItem | null {
  const found = wishes.find(w => w.id === id);
  return found ? structuredClone(found) : null;
}

export type PreviewEvent = { id: string; kind: string; date: string | null; asset_id: string | null; wishlist_id: string | null; title: string; note: string; amount_cents: string | null; target: SourceTarget; domain: string; missing?: number };
/** Financial + wish events for the preview timeline; physical events come from
 * visual-preview's demo records. Mirrors the Rust projection loosely. */
export function financialTimelineEvents(): PreviewEvent[] {
  const events: PreviewEvent[] = summary().points.map(p => ({
    id: 'snapshot:' + p.snapshot_id, kind: 'snapshot', date: p.date, asset_id: null, wishlist_id: null,
    title: '财富盘点', note: '', amount_cents: p.complete ? p.net_cents : null,
    target: { kind: 'snapshot', id: p.snapshot_id }, domain: 'wealth', missing: p.missing,
  }));
  for (const e of expenses) {
    if (!e.fields.asset_id) events.push({ id: 'expense:' + e.id, kind: 'expense', date: e.fields.date, asset_id: null, wishlist_id: null, title: e.fields.title, note: e.fields.category, amount_cents: e.fields.amount_cents, target: { kind: 'expense', id: e.id }, domain: 'expense' });
    if (e.fields.refund_date) events.push({ id: 'refund:' + e.id, kind: 'refund', date: e.fields.refund_date, asset_id: e.fields.asset_id, wishlist_id: null, title: e.fields.title, note: e.fields.category, amount_cents: e.fields.refund_cents, target: { kind: 'expense', id: e.id }, domain: 'expense' });
  }
  for (const p of payments) if (p.state === 'paid') events.push({ id: 'payment:' + p.id, kind: 'payment', date: p.paid_date, asset_id: null, wishlist_id: null, title: p.plan_name, note: plans.find(x => x.id === p.plan_id)?.fields.category ?? '', amount_cents: p.amount_cents, target: { kind: 'payment', id: p.id, plan_id: p.plan_id }, domain: 'expense' });
  for (const v of virtuals) if (v.fields.purchase_date) events.push({ id: 'virtual:' + v.id, kind: 'virtual', date: v.fields.purchase_date, asset_id: null, wishlist_id: null, title: v.fields.name, note: v.fields.kind, amount_cents: v.fields.plan_id ? null : v.fields.price_cents, target: { kind: 'virtual', id: v.id }, domain: 'expense' });
  for (const w of wishes) events.push({ id: 'wish_added:' + w.id, kind: 'wish_added', date: w.created_at.slice(0, 10), asset_id: null, wishlist_id: w.id, title: w.fields.name, note: w.status, amount_cents: w.fields.estimated_price_cents, target: { kind: 'wish', id: w.id }, domain: 'wish' });
  return events;
}
export function validatePreviewSource(target: SourceTarget): void {
  const fail = () => { throw { code: 'NOT_FOUND', message: '这条来源记录已删除或失效，请返回后重新读取。' }; };
  if (target.kind === 'account') { if (!accounts.some(a => a.id === target.id)) fail(); return; }
  if (target.kind === 'topup') { if (!topups.some(t => t.id === target.id && t.asset_id === target.asset_id) || !virtuals.some(v => v.id === target.asset_id)) fail(); return; }
  if (target.kind === 'snapshot') { if (!snapshots.some(s => s.id === target.id)) fail(); return; }
  if (target.kind === 'expense') { const e = expenses.find(x => x.id === target.id); if (!e || e.asset_deleted) fail(); return; }
  if (target.kind === 'payment') { if (!payments.some(p => p.id === target.id && p.plan_id === target.plan_id) || !plans.some(p => p.id === target.plan_id)) fail(); return; }
  if (target.kind === 'plan') { if (!plans.some(p => p.id === target.id)) fail(); return; }
  if (target.kind === 'virtual') { if (!virtuals.some(v => v.id === target.id)) fail(); return; }
  if (target.kind === 'wish') { if (!wishes.some(w => w.id === target.id)) fail(); return; }
  fail();
}
export type { TimelineSelection };
