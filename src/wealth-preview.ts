// Development-only in-memory stand-in for the wealth commands used by
// visual-preview. It mirrors the Rust rules loosely for demo purposes and
// proves nothing about native storage or calculation.
import type { Account, AccountSave, Draft, Entry, Point, Share, Snapshot, SnapshotSave, Summary } from './wealth';
import type { Expense, ExpenseSave, ExpenseView, Line } from './expenses';
import type { Due, Overview, Payment, PaymentSave, Plan, PlanSave } from './recurring';
import type { VirtualAsset, VirtualFields, VirtualKind, VirtualOverview, VirtualSave, VirtualStatus } from './virtual';
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
let expenses: Expense[] = params.get('expenses') === 'empty' ? [] : demoFinance.expenses.filter(e => !e.deleted).map(e => ({
  id: 'x-' + e.key, fields: { title: e.title, date: shifted(0, -e.days_ago), amount_cents: e.amount_cents, category: e.category,
    notes: '虚构样例', refund_cents: e.refund_cents, refund_date: e.refund_days_ago === null ? null : shifted(0, -e.refund_days_ago), asset_id: e.asset_key },
  revision: 1, asset_name: demoAssets.find(a => a.key === e.asset_key)?.name ?? null, asset_deleted: false,
}));
function expenseView(year: number | null): ExpenseView {
  const items: Line[] = params.get('expenses') === 'empty' ? [] : demoAssets.flatMap(a => [
    { source: 'purchase' as const, id: a.key, asset_id: a.key, title: a.name, category: a.category, date: a.purchase_date, amount_cents: a.price_cents },
    ...(a.maintenance ? [{ source: 'maintenance' as const, id: 'm-' + a.key, asset_id: a.key, title: `${a.name} · ${a.maintenance.title}`, category: a.category, date: a.maintenance.date, amount_cents: a.maintenance.cost_cents }] : []),
    ...(a.sale ? [{ source: 'sale' as const, id: 's-' + a.key, asset_id: a.key, title: a.name, category: a.category, date: a.sale.date, amount_cents: a.sale.price_cents }] : []),
  ]);
  const paidLines: Line[] = payments.filter(p => p.state === 'paid').map(p => ({ source: 'payment', id: p.id, asset_id: null, title: p.plan_name, category: plans.find(x => x.id === p.plan_id)?.fields.category ?? null, date: p.paid_date, amount_cents: p.amount_cents }));
  const virtualLines: Line[] = virtuals.filter(v => !v.fields.plan_id && v.fields.price_cents !== null).map(v => ({ source: 'virtual', id: v.id, asset_id: null, title: v.fields.name, category: 'digital', date: v.fields.purchase_date, amount_cents: v.fields.price_cents }));
  const all: Line[] = [...items, ...paidLines, ...virtualLines, ...expenses.flatMap(e => [
    { source: e.fields.asset_id ? 'linked' as const : 'expense' as const, id: e.id, asset_id: e.fields.asset_id, title: e.fields.title, category: e.fields.category, date: e.fields.date, amount_cents: e.fields.amount_cents },
    ...(e.fields.refund_date ? [{ source: 'refund' as const, id: e.id, asset_id: e.fields.asset_id, title: e.fields.title, category: e.fields.category, date: e.fields.refund_date, amount_cents: e.fields.refund_cents }] : []),
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
function schedule(p: Plan, from: string, to: string) {
  const out: string[] = [];
  for (let k = 0; ; k++) { const d = nth(p.fields.first_due, p.fields.interval_months, k); if (d > to || (p.fields.end_date && d > p.fields.end_date)) break; if (d >= from) out.push(d); }
  return out;
}
const plan = (id: string, name: string, category: string, amount: string, interval: number, first: string, extra: Partial<Plan['fields']> = {}): Plan =>
  ({ id, fields: { name, category, amount_cents: amount, interval_months: interval, first_due: first, end_date: null, paused: false, notes: '', ...extra }, revision: 1, active_from: first, next_due: null });
let plans: Plan[] = params.get('recurring') === 'empty' ? [] : demoFinance.plans.map(p =>
  plan('r-' + p.key, p.name, p.category, p.amount_cents, p.interval_months, shifted(p.months_ago, p.day_offset), { paused: p.paused }));
let payments: Payment[] = params.get('recurring') === 'empty' ? [] : demoFinance.plans.flatMap(p => p.paid_periods.map(k => {
  const due = nth(shifted(p.months_ago, p.day_offset), p.interval_months, k);
  return { id: `p-${p.key}-${k}`, plan_id: 'r-' + p.key, plan_name: p.name, due_date: due, state: 'paid', paid_date: due, amount_cents: p.amount_cents, notes: '虚构付款', revision: 1, off_schedule: false };
}));
function recurringOverview(): Overview {
  const soon = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)), year = iso(new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));
  const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const free = (p: Plan, d: string) => !payments.some(x => x.plan_id === p.id && x.due_date === d);
  const due: Due[] = [], upcoming: Due[] = []; let annual = 0n, next12 = 0n;
  const out = plans.map(p => {
    const item = (d: string): Due => ({ plan_id: p.id, plan_name: p.fields.name, category: p.fields.category, due_date: d, amount_cents: p.fields.amount_cents });
    const next = schedule(p, tomorrow, year).find(d => free(p, d)) ?? null;
    if (!p.fields.paused) {
      due.push(...schedule(p, p.active_from, todayIso).filter(d => free(p, d)).map(item));
      upcoming.push(...schedule(p, tomorrow, soon).filter(d => free(p, d)).map(item));
      next12 += BigInt(p.fields.amount_cents) * BigInt(schedule(p, tomorrow, year).filter(d => free(p, d)).length);
      if (!p.fields.end_date || p.fields.end_date >= todayIso) annual += BigInt(p.fields.amount_cents) * 12n / BigInt(p.fields.interval_months);
    }
    return { ...p, next_due: next };
  });
  return { generation, today: todayIso, due: due.sort((a, b) => a.due_date.localeCompare(b.due_date)), upcoming: upcoming.sort((a, b) => a.due_date.localeCompare(b.due_date)),
    annual_cents: String(annual), monthly_cents: String((annual + 6n) / 12n), next12_cents: String(next12), plans: out,
    payments: [...payments].sort((a, b) => b.due_date.localeCompare(a.due_date)).map(x => ({ ...x, off_schedule: !schedule(plans.find(p => p.id === x.plan_id)!, x.due_date, x.due_date).length })) };
}

// Virtual assets share the native fixture definitions; derivation mirrors virtual_assets.rs.
const dayOffset = (days: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
let virtuals: { id: string; fields: VirtualFields; revision: number }[] = params.get('virtual') === 'empty' ? [] : demoFinance.virtuals.map(v => ({ id: 'v-' + v.key, revision: 1, fields: {
  name: v.name, kind: v.kind as VirtualKind, provider: v.provider, purchase_date: v.purchase_days_ago === null ? null : dayOffset(-v.purchase_days_ago),
  price_cents: v.plan_key ? null : v.price_cents, expires: v.expires_in_days === null ? null : dayOffset(v.expires_in_days), plan_id: v.plan_key ? 'r-' + v.plan_key : null,
  url: '', notes: '虚构样例', stopped_on: v.stopped_days_ago === null ? null : dayOffset(-v.stopped_days_ago) } }));
function virtualOverview(): VirtualOverview {
  const items: VirtualAsset[] = virtuals.map(v => {
    const p = plans.find(x => x.id === v.fields.plan_id), paid = payments.filter(x => x.plan_id === p?.id && x.state === 'paid');
    const last = paid.map(x => x.due_date).sort().at(-1);
    const until = p ? (last ? (() => { const [y, m, d] = nth(last, p.fields.interval_months, 1).split('-').map(Number); return iso(new Date(y, m - 1, d - 1)); })() : null) : v.fields.expires;
    const spent = p ? String(paid.reduce((t, x) => t + BigInt(x.amount_cents ?? '0'), 0n)) : v.fields.price_cents;
    const soon = dayOffset(p ? 7 : 30);
    const status: VirtualStatus = v.fields.stopped_on ? 'stopped' : until === null ? (v.fields.kind === 'license' && !p ? 'perpetual' : 'unknown') : until < todayIso ? 'expired' : until <= soon ? 'expiring' : 'active';
    return { ...v, plan_name: p?.fields.name ?? null, plan_deleted: false, valid_until: until, status, spent_cents: spent };
  }).sort((a, b) => a.fields.name.localeCompare(b.fields.name));
  return { generation, today: todayIso, items, in_use: items.filter(v => v.status !== 'stopped').length, expiring: items.filter(v => v.status === 'expiring').length, expired: items.filter(v => v.status === 'expired').length,
    spent_cents: String(items.reduce((t, v) => t + BigInt(v.spent_cents ?? '0'), 0n)), unknown_price: items.filter(v => v.spent_cents === null).length,
    plans: plans.map(p => ({ id: p.id, name: p.fields.name, interval_months: p.fields.interval_months, linked_to: virtuals.find(v => v.fields.plan_id === p.id)?.fields.name ?? null })) };
}

export function wealthPreview(command: string, args: Record<string, unknown>): { value: unknown } | null {
  if (command === 'recurring_overview') { if (params.get('recurring') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' }; return { value: recurringOverview() }; }
  if (command === 'recurring_plan_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as PlanSave, id = input.id ?? crypto.randomUUID(), old = plans.find(p => p.id === id);
    const next: Plan = { id, fields: input.fields, revision: (old?.revision ?? 0) + 1, active_from: old ? (old.fields.paused && !input.fields.paused ? todayIso : old.active_from) : input.fields.first_due, next_due: null };
    plans = old ? plans.map(p => p.id === id ? next : p) : [...plans, next];
    receipts.set(input.request_id, id);
    return { value: next };
  }
  if (command === 'recurring_payment_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as PaymentSave, p = plans.find(x => x.id === input.plan_id)!;
    if (!input.id && payments.some(x => x.plan_id === input.plan_id && x.due_date === input.due_date)) throw { code: 'PAYMENT_EXISTS', message: '这一期已经记录过，请打开原记录更正' };
    const id = input.id ?? crypto.randomUUID(), old = payments.find(x => x.id === id);
    const next: Payment = { id, plan_id: p.id, plan_name: p.fields.name, due_date: input.due_date, state: input.state, paid_date: input.paid_date, amount_cents: input.amount_cents, notes: input.notes, revision: (old?.revision ?? 0) + 1, off_schedule: false };
    payments = old ? payments.map(x => x.id === id ? next : x) : [...payments, next];
    receipts.set(input.request_id, id);
    return { value: next };
  }
  if (command === 'virtual_overview') { if (params.get('virtual') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' }; return { value: virtualOverview() }; }
  if (command === 'virtual_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as VirtualSave, id = input.id ?? crypto.randomUUID(), old = virtuals.find(v => v.id === id);
    const taken = input.fields.plan_id && virtuals.find(v => v.fields.plan_id === input.fields.plan_id && v.id !== id);
    if (taken) throw { code: 'VIRTUAL_PLAN_TAKEN', message: `这项计划已关联「${taken.fields.name}」` };
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
  if (command === 'wealth_summary') return { value: summary() };
  if (command === 'wealth_accounts') return { value: accounts.map(withLatest) };
  if (command === 'wealth_request_result') return { value: receipts.get(String(args.request)) ?? null };
  if (command === 'wealth_snapshot_draft') {
    const date = String(args.date), existing = snapshots.find(s => s.date === date);
    const draft: Draft = { generation, date, existing: existing ? view(existing) : null, rows: accounts.filter(a => due(a, date)).map(a => ({ account: withLatest(a), previous: latestBefore(a.id, date) })) };
    return { value: draft };
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
