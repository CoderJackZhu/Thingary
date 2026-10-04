// Development-only in-memory stand-in for the wealth commands used by
// visual-preview. It mirrors the Rust rules loosely for demo purposes and
// proves nothing about native storage or calculation.
import type { Account, AccountSave, Compare, CompareCell, CompareEnd, CompareRow, Draft, Entry, HistoryRow, Point, Share, Snapshot, SnapshotSave, StructurePair, Summary } from './wealth';
import { assetKinds } from './wealth';
import type { Expense, ExpenseSave, ExpenseView, Line } from './expenses';
import type { Due, Overview, Payment, PaymentSave, Plan, PlanSave, PaymentRangeSave } from './recurring';
import type { VirtualAsset, VirtualFields, VirtualKind, VirtualOverview, VirtualSave, VirtualStatus } from './virtual';
import type { WishlistItem, WishlistPage, WishlistQuery } from './wishlist';
import type { SourceTarget, TimelineSelection } from './source';
import { coverageFor, scheduleDates } from './recurring-model';
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
    const p: Point = { snapshot_id: s.id, date: s.date, assets_cents: String(assets), liabilities_cents: String(liabilities), net_cents: String(net), complete, missing: s.missing.length, compared_to: null, scope_changed: false, change_cents: null, change_rate_hundredths: null };
    if (complete) {
      if (last) { p.compared_to = last.s.date; const change = net - last.net; p.change_cents = String(change); if (last.net > 0n) p.change_rate_hundredths = hundredths(change, last.net); }
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
  const paidLines: Line[] = payments.filter(p => p.state === 'paid').map(p => ({ source: 'payment', id: p.id, asset_id: null, title: p.plan_name, category: plans.find(x => x.id === p.plan_id)?.fields.category ?? null, date: p.paid_date, amount_cents: p.amount_cents, notes: null }));
  const virtualLines: Line[] = virtuals.filter(v => !v.fields.plan_id && v.fields.price_cents !== null).map(v => ({ source: 'virtual', id: v.id, asset_id: null, title: v.fields.name, category: 'digital', date: v.fields.purchase_date, amount_cents: v.fields.price_cents, notes: null }));
  const all: Line[] = [...items, ...paidLines, ...virtualLines, ...expenses.flatMap(e => [
    { source: e.fields.asset_id ? 'linked' as const : 'expense' as const, id: e.id, asset_id: e.fields.asset_id, title: e.fields.title, category: e.fields.category, date: e.fields.date, amount_cents: e.fields.amount_cents, notes: e.fields.notes },
    ...(e.fields.refund_date ? [{ source: 'refund' as const, id: e.id, asset_id: e.fields.asset_id, title: e.fields.title, category: e.fields.category, date: e.fields.refund_date, amount_cents: e.fields.refund_cents, notes: e.fields.notes }] : []),
  ])];
  const inYear = (l: Line) => l.date !== null && (year === null || l.date.startsWith(`${year}-`));
  const lines = all.filter(inYear).sort((a, b) => b.date!.localeCompare(a.date!)), undated = all.filter(l => l.date === null);
  const sum = (ls: Line[]) => ls.reduce((t, l) => t + BigInt(l.amount_cents ?? '0'), 0n);
  const spentLines = lines.filter(l => ['purchase', 'maintenance', 'expense', 'payment', 'virtual'].includes(l.source) && l.amount_cents !== null);
  const spent = sum(spentLines), refunds = sum(lines.filter(l => l.source === 'refund'));
  return { generation, year, years: [...new Set(all.flatMap(l => l.date ? [Number(l.date.slice(0, 4))] : []))].sort((a, b) => b - a), lines, undated,
    months: year === null ? [] : Array.from({ length: 12 }, (_, i) => { const m = `${year}-${String(i + 1).padStart(2, '0')}`; return { month: m, spent_cents: String(sum(spentLines.filter(l => l.date!.startsWith(m)))), refund_cents: String(sum(lines.filter(l => l.source === 'refund' && l.date!.startsWith(m)))) }; }),
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
function recurringOverview(): Overview {
  const soon = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)), year = iso(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));
  const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const free = (p: Plan, d: string) => !payments.some(x => x.plan_id === p.id && x.due_date === d);
  const due: Due[] = [], upcoming: Due[] = []; let annual = 0n, next12 = 0n;
  const out = plans.map(p => {
    const item = (d: string): Due => ({ coverage_start: coverageFor(p.fields,d)?.[0], coverage_end: coverageFor(p.fields,d)?.[1], plan_id: p.id, plan_name: p.fields.name, category: p.fields.category, due_date: d, amount_cents: p.fields.amount_cents });
    const next = schedule(p, todayIso > p.active_from ? todayIso : p.active_from, year).find(d => free(p, d)) ?? null;
    if (!p.fields.paused) {
      due.push(...schedule(p, p.active_from, todayIso).filter(d => free(p, d)).map(item));
      upcoming.push(...schedule(p, tomorrow, soon).filter(d => free(p, d)).map(item));
      next12 += BigInt(p.fields.amount_cents) * BigInt(schedule(p, tomorrow, year).filter(d => free(p, d)).length);
      if (!p.fields.end_date || p.fields.end_date >= todayIso) annual += BigInt(p.fields.amount_cents) * 12n / BigInt(p.fields.interval_months);
    }
    const amount=BigInt(p.fields.amount_cents), start=p.fields.service_start;
    const historyCount = start ? scheduleDates({...p.fields,first_due:p.fields.coverage_start!,coverage_start:p.fields.coverage_start},start,todayIso).length : 0;
    const contractCount = start && p.fields.end_date ? scheduleDates({...p.fields,first_due:p.fields.coverage_start!,coverage_start:p.fields.coverage_start},start,p.fields.end_date).length : 0;
    return { ...p, next_due: p.fields.paused ? null : next, next_coverage: next && !p.fields.paused ? coverageFor(p.fields,next) : null, monthly_cents: String((amount+BigInt(p.fields.interval_months)/2n)/BigInt(p.fields.interval_months)), paid_cents: String(payments.filter(x=>x.plan_id===p.id&&x.state==='paid').reduce((t,x)=>t+BigInt(x.amount_cents ?? '0'),0n)), estimated_cents: start ? String(amount*BigInt(historyCount)) : null, contract_cents: contractCount ? String(amount*BigInt(contractCount)) : null };
  });
  return { generation, today: todayIso, due: due.sort((a, b) => a.due_date.localeCompare(b.due_date)), upcoming: upcoming.sort((a, b) => a.due_date.localeCompare(b.due_date)),
    annual_cents: String(annual), monthly_cents: String((annual + 6n) / 12n), next12_cents: String(next12), plans: out,
    payments: [...payments].sort((a, b) => b.due_date.localeCompare(a.due_date)).map(x => ({ ...x, off_schedule: !schedule(plans.find(p => p.id === x.plan_id)!, x.due_date, x.due_date).length })) };
}

// Virtual assets share the native fixture definitions; derivation mirrors virtual_assets.rs.
const dayOffset = (days: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
let virtuals: { id: string; fields: VirtualFields; revision: number }[] = (params.get('virtual') === 'empty' || params.get('state') === 'empty') ? [] : demoFinance.virtuals.map(v => ({ id: 'v-' + v.key, revision: 1, fields: {
  name: v.name, kind: v.kind as VirtualKind, provider: v.provider, purchase_date: v.purchase_days_ago === null ? null : dayOffset(-v.purchase_days_ago),
  price_cents: v.plan_key ? null : v.price_cents, expires: v.expires_in_days === null ? null : dayOffset(v.expires_in_days), plan_id: v.plan_key ? 'r-' + v.plan_key : null,
  url: '', notes: '虚构样例', stopped_on: v.stopped_days_ago === null ? null : dayOffset(-v.stopped_days_ago) } }));
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
    return { ...v, paid_count: paid.length, paid_until: paidUntil, plan:p??null, plan_name: p?.fields.name ?? null, plan_deleted: false, valid_until: until, status, spent_cents: spent };
  }).sort((a, b) => a.fields.name.localeCompare(b.fields.name));
  return { generation, today: todayIso, items, in_use: items.filter(v => v.status !== 'stopped' && v.status !== 'expired').length, expiring: items.filter(v => v.status === 'expiring').length, expired: items.filter(v => v.status === 'expired').length,
    spent_cents: String(items.reduce((t, v) => t + BigInt(v.spent_cents ?? '0'), 0n)), unknown_price: items.filter(v => v.spent_cents === null).length,
    plans: plans.map(p => ({ id: p.id, name: p.fields.name, interval_months: p.fields.interval_months, linked_to: virtuals.find(v => v.fields.plan_id === p.id)?.fields.name ?? null })) };
}

export function wealthPreview(command: string, args: Record<string, unknown>): { value: unknown } | null {
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
  if (command === 'virtual_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as VirtualSave, id = input.id ?? crypto.randomUUID(), old = virtuals.find(v => v.id === id);
    const taken = input.fields.plan_id && virtuals.find(v => v.fields.plan_id === input.fields.plan_id && v.id !== id);
    if (taken) throw { code: 'VIRTUAL_PLAN_TAKEN', message: `这项计划已关联「${taken.fields.name}」` };
    if(input.plan) {
      const pid=input.plan.id??crypto.randomUUID(), oldPlan=plans.find(x=>x.id===pid);
      const pf=input.plan.fields;
      const nextPlan: Plan={id:pid,fields:pf,revision:(oldPlan?.revision??0)+1,active_from:oldPlan?.active_from??(todayIso>pf.first_due?todayIso:pf.first_due),next_due:null};
      plans=oldPlan?plans.map(x=>x.id===pid?nextPlan:x):[...plans,nextPlan];
      input.fields={...input.fields,plan_id:pid,price_cents:null,expires:null};
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
  if (!command.startsWith('wealth_')) return null;
  if (params.get('wealth') === 'error' && command !== 'wealth_request_result') throw { message: '虚构读取失败，用于验证错误状态。' };
  if (command === 'wealth_summary') { if (params.get('wealth') === 'error') throw { message: '虚构盘点读取失败。' }; return { value: summary() }; }
  if (command === 'wealth_accounts') return { value: accounts.map(withLatest) };
  if (command === 'wealth_request_result') return { value: receipts.get(String(args.request)) ?? null };
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
    const end = (s: Snapshot): CompareEnd => ({ snapshot_id: s.id, date: s.date, complete: !s.missing.length, missing: s.missing.length });
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
  id, fields: { name, category_id: null, estimated_price_cents: yuan, priority: null, target_date: '', external_link: '', notes: '虚构心愿样例' },
  status: 'ongoing', revision: 1, created_at: created, updated_at: created, abandoned_at: null, achieved_at: null,
  converted_asset: null, cover: null, photos: [],
});
let wishes: PreviewWish[] = params.get('state') === 'empty' ? [] : [
  wishFixture('wish-lens', '虚构心愿 · 相机镜头', '880000', '2026-08-05T09:00:00.000Z'),
  wishFixture('wish-lens-2', '虚构心愿 · 相机镜头', '120000', '2026-09-12T09:00:00.000Z'),
  wishFixture('wish-desk', '虚构心愿 · 实木书桌', '450000', '2026-09-20T09:00:00.000Z'),
];

// U18 布局夹具：心愿按设计 §6.1 覆盖金额/状态组合（价格 2,850、已攒 850、
// 还差 2,000；大金额、未知/零、长名称、已实现/已放弃）；周期按 0/1/30 条
// 付款与长名称/备注构造。仅浏览器预览，刷新即重置。
const layoutWish = (id: string, name: string, price: string | null, prefs: Partial<PreviewWish['preferences']> & { mode: 'countdown' | 'savings' }, status: PreviewWish['status'] = 'ongoing', created = '2026-09-01T09:00:00.000Z'): PreviewWish => ({
  ...wishFixture(id, name, price, created), status,
  preferences: { added_date: '2026-09-01', channel_id: null, saved_cents: '0', achievement_source: null, pinned: false, reminder: false, ...prefs },
});
if (params.get('wish-fixture') === 'layout') {
  wishes = [
    layoutWish('wish-2850', '虚构长名称心愿 · 等待很久的木框全画幅镜头与整套滤镜系统', '285000', { mode: 'savings', saved_cents: '85000' }),
    layoutWish('wish-big', '大金额心愿 · 工作室整套设备', '1234567890', { mode: 'savings', saved_cents: '0' }),
    layoutWish('wish-unknown', '价格未知心愿 · 待定型号耳机', null, { mode: 'countdown' }),
    layoutWish('wish-zero', '零价格心愿 · 朋友转让的旧书架', '0', { mode: 'savings', saved_cents: '0' }),
    layoutWish('wish-no-date', '无目标日期心愿 · 年度旅行相机包', '99000', { mode: 'countdown' }),
    layoutWish('wish-done', '已实现心愿 · 键盘', '29900', { mode: 'savings', saved_cents: '29900', achievement_source: 'savings' }, 'achieved'),
    layoutWish('wish-given-up', '已放弃心愿 · 跑步机', '399900', { mode: 'countdown' }, 'abandoned'),
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
    && (query.filter === 'all' || w.status === query.filter));
  const value = (w: PreviewWish): string | number | null => query.sort === 'name' ? w.fields.name.toLowerCase() : query.sort === 'priority' ? w.fields.priority ?? null : query.sort === 'price' ? w.fields.estimated_price_cents === null ? null : Number(w.fields.estimated_price_cents) : query.sort === 'target' ? w.fields.target_date ?? null : w.preferences?.added_date ?? w.created_at.slice(0,10);
  found.sort((a, b) => { const pinned=Number(!!b.preferences?.pinned)-Number(!!a.preferences?.pinned); if(pinned)return pinned; const x=value(a),y=value(b); if(x===null && y!==null)return 1;if(y===null && x!==null)return -1;const order=x===null?0:typeof x==='number' && typeof y==='number'?x-y:String(x)<String(y)?-1:String(x)>String(y)?1:0;return order*(query.descending?-1:1)||b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id); });
  const ongoing = wishes.filter(w => w.status === 'ongoing');
  return { generation, items: found.slice(query.offset, query.offset + 100).map(w => structuredClone(w)), total: found.length,
    ongoing_known_cents: String(ongoing.reduce((t, w) => t + BigInt(w.fields.estimated_price_cents ?? '0'), 0n)),
    ongoing_unknown_count: ongoing.filter(w => w.fields.estimated_price_cents === null).length };
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
  if (target.kind === 'snapshot') { if (!snapshots.some(s => s.id === target.id)) fail(); return; }
  if (target.kind === 'expense') { const e = expenses.find(x => x.id === target.id); if (!e || e.asset_deleted) fail(); return; }
  if (target.kind === 'payment') { if (!payments.some(p => p.id === target.id && p.plan_id === target.plan_id && p.state === 'paid')) fail(); return; }
  if (target.kind === 'plan') { if (!plans.some(p => p.id === target.id)) fail(); return; }
  if (target.kind === 'virtual') { if (!virtuals.some(v => v.id === target.id)) fail(); return; }
  if (target.kind === 'wish') { if (!wishes.some(w => w.id === target.id)) fail(); return; }
  fail();
}
export type { TimelineSelection };
