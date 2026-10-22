import { holdingSupported, validateHoldingFact, sameHoldingFact } from "./holdings";
import type { AccountGroup, GroupSave, GroupDelete, GroupReorder } from './account-groups';
import { currencyCode, convertCurrency, validateCurrencyFact, validCurrency } from './currency';
import { reviewFixtures } from './investment-review/fixtures';
import type { InvestmentReviewRead } from './wealth';
import nonblockingDemo from '../tests/fixtures/planning-basic/nonblocking-demo.json';
import debtDemo from '../tests/fixtures/planning-basic/debt-loops.json';
import { completionFixture } from './planning-completion-fixture';
import { debtFixture } from './planning-debt-fixture';
// Development-only in-memory stand-in for the wealth commands used by
// visual-preview. It mirrors the Rust rules loosely for demo purposes and
// proves nothing about native storage or calculation.
import { financialImportPreview } from './financial-import-preview';
import type { Account, AccountSave, CompareCell, CompareEnd, CompareRow, Draft, Entry, HistoryRow, Point, Share, Snapshot, SnapshotSave, StructurePair, Summary } from './wealth';
import { assetKinds, kindLabel } from './wealth';
import { expenseCategories } from './expenses';
import { recurringCategories } from './recurring';
import { virtualKindText } from './virtual';
import type { Expense, ExpenseSave, ExpenseView, Line } from './expenses';
import type { Due, Overview, Payment, PaymentSave, Plan, PlanSave, PaymentRangeSave } from './recurring';
import type { BalanceRecord, BalanceSave, TopupFields, TopupSave, VirtualAsset, VirtualFields, VirtualKind, VirtualOverview, VirtualSave, VirtualStatus, ReminderState, ReminderSave } from './virtual';
import type { WishlistItem, WishlistPage, WishlistQuery } from './wishlist';
import type { SourceTarget, TimelineSelection } from './source';
import { coverageFor, scheduleDates, planScheduleDates, shiftDays } from './recurring-model';
import { computeReview, defaultRetire } from './plan';
import { emptyCore, costSources, eventSource } from './plan-core';
import { mergeDebtRepayments } from './plan-debt';
import { simplifiedEmpty } from './plan-simplified';
import type { PlanningSources, ProfileUpdate } from './plan';
import { basicInputFixtures } from './plan-basic-fixtures';
import { allModules, type RuntimeModules } from './modules';
import { normalizeFinancePeriod, financePeriodContains, type FinancePeriod } from './finance-contract';
import type { FinanceRead, FinanceSources } from './finance-service';
import type { AssumptionReadV1, MovementRecordV1, ReviewPreviewV1 } from './planning-followup-contract';
import type { Income, IncomeSave, Mark, ProfileState, Reasons, StoredProfile } from './plan';
import demoAssets from './demo-assets.json';
import demoFinance from './demo-finance.json';
import type { SavingsGoal, SavingsRead, SavingsObservation, SavingsSave, SavingsTrash } from './savings-goals';

const generation = 'visual-fixture-only';
const params = new URLSearchParams(location.search);
let previewModules: RuntimeModules = { ...allModules, planning: params.get('plan-module') !== 'off', wealth: params.get('plan-wealth') !== 'off', incomes: params.get('income-module') !== 'off', movements: params.get('movement-module') !== 'off', finance_status: 'ready', finance_revision: 1 };
const now = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shifted = (months: number, offset = 0) => {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const target = new Date(base.getFullYear(), base.getMonth() - months, 1);
  return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(base.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate())));
};
let accounts: Account[] = demoFinance.accounts.map((a, position) => ({ id: 'w-' + a.key,
  fields: { name: a.name, institution: a.institution, side: a.side as 'asset' | 'liability', kind: a.kind, counted: a.counted, opened_on: shifted(6), closed_on: null, notes: '虚构样例', purchase_cents: 'purchase_cents' in a ? a.purchase_cents : null, purchased_on: 'purchased_on' in a ? a.purchased_on : null }, position, revision: 1, latest: null }));
let accountGroups: AccountGroup[] = params.get('groups') === 'normal' ? [
  { id: 'fictional-emergency', name: '虚构应急金', position: 0, revision: 1, accounts: 0 },
  { id: 'fictional-long', name: '虚构长期投资', position: 1, revision: 1, accounts: 0 },
  { id: 'fictional-empty', name: '虚构空分组', position: 2, revision: 1, accounts: 0 },
] : [];
if (accountGroups.length) accounts = accounts.map(a => ({ ...a, fields: { ...a.fields, group_id: a.fields.kind === 'cash' ? accountGroups[0].id : ['investment','mixed','fund','bond'].includes(a.fields.kind) ? accountGroups[1].id : null } }));
const groupUnknownChecks = new Set<string>();
const groupReceipts = new Map<string, { fingerprint: string; value: unknown }>();
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
// Dense dates and retired accounts; only fictional in-memory evidence.
if (params.get('wealth-fixture') === 'usability' && snapshots.length > 2) {
  snapshots[snapshots.length - 2].date = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const retired = ['虚构旧银行卡', '虚构旧基金', '虚构旧储蓄'].map((name, i): Account => ({ id: `fx-closed-${i}`, fields: { name, institution: '虚构平台', side: 'asset', kind: 'cash', counted: true, opened_on: shifted(6), closed_on: iso(now), notes: '虚构停用账户' }, position: i * 2, revision: 1, latest: null }));
  accounts.splice(1, 0, retired[0]); accounts.splice(3, 0, retired[1]); accounts.push(retired[2]);
  snapshots = snapshots.map(s => ({ ...s, entries: [...s.entries, ...retired.filter(a => s.date < a.fields.closed_on!).map(a => entry(a, 0))] }));
}
// Explicit fictional fixture: leave today open for a new quick check-in.
if (params.get('wealth-fixture') === 'quick-new-day') {
  snapshots = snapshots.filter(snapshot => snapshot.date !== iso(now));
}
// First complete quick update must offer the same reminder as a full check-in.
// A single incomplete snapshot, with only the cash balance unknown.
if (params.get('wealth-fixture') === 'quick-first-complete' && snapshots.length) {
  snapshots = snapshots.slice(-1).map(s => ({ ...s, entries: s.entries.map((e, i) => i === 0 ? { ...e, state: 'missing' as const, amount_cents: null } : e) }));
}
// Explicit fictional foreign-currency fixture; ordinary sample amounts remain unchanged.
if (params.get('wealth-fixture') === 'currency' || params.get('currency') === '1' || params.get('currency') === 'retired-rate') {
  accounts = accounts.map((a,i) => i < 3 ? { ...a, fields: { ...a.fields, name: `虚构${i===2?'日元':'美元'}账户${i+1}`, currency: i===2?'JPY':'USD' } } : a);
  snapshots = snapshots.map(s=>({...s,entries:s.entries.map(e=>{
    const account=accounts.find(a=>a.id===e.account_id)!,code=currencyCode(account.fields.currency);
    if(code==='CNY'||e.amount_cents===null)return e;
    const original_minor=code==='JPY'?'10000':e.amount_cents,fx_rate_micro=code==='JPY'?'50000':'7000000';
    return {...e,original_minor,fx_rate_micro,amount_cents:convertCurrency(code,original_minor,fx_rate_micro)};
  })}));
}
// Fictional rate suggestion acceptance: a retired zero-balance account and a new account today.
if (params.get('currency') === 'retired-rate' && accounts.length >= 2) {
  const oldId=accounts[0].id, secondId=accounts[1].id;
  accounts[0]={...accounts[0],fields:{...accounts[0].fields,name:'虚构已停用美元账户',closed_on:iso(now)}};
  accounts[1]={...accounts[1],fields:{...accounts[1].fields,currency:'CNY'}};
  snapshots=snapshots.filter(s=>s.date<iso(now)).map(s=>({...s,entries:s.entries.map(e=>{
    if(e.account_id===oldId&&e.amount_cents!==null)return {...e,amount_cents:'0',original_minor:'0',fx_rate_micro:'7123456'};
    if(e.account_id===secondId){const plain={...e};delete plain.original_minor;delete plain.fx_rate_micro;return plain;}
    return e;
  })}));
  accounts.push({id:'fx-new-usd',position:accounts.length,revision:1,latest:null,has_entries:false,fields:{...accounts[0].fields,name:'虚构新美元账户（无记录）',opened_on:iso(now),closed_on:null,notes:'虚构：沿用已停用账户最近记录的汇率建议。'}});
}
// Fictional holding input fixtures; amounts and FX remain the same recorded facts.
if (params.get('holding') === '1') {
  const ids=new Set(accounts.filter(a=>holdingSupported(a.fields.kind)).map(a=>a.id));
  accounts=accounts.map(a=>ids.has(a.id)?{...a,fields:{...a.fields,holding_mode:true,holding_unit:'份',name:`虚构持仓 · ${a.fields.name}`}}:a);
  snapshots=snapshots.map(s=>({...s,entries:s.entries.map(e=>{
    if(!ids.has(e.account_id)||e.amount_cents==null)return e;
    const a=accounts.find(a=>a.id===e.account_id)!,code=currencyCode(a.fields.currency),minor=e.original_minor??e.amount_cents;
    return {...e,quantity_e8:(BigInt(minor)*(code==='JPY'?100000000n:1000000n)).toString(),unit_price_e6:'1000000'};
  })}));
}
const receipts = new Map<string, string>();
/** Valid calendar day in YYYY-MM-DD form, as the native backend requires. */
const previewDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v && v >= '1900-01-01';
const quickFingerprints = new Map<string, string>();
let quickStaleShown = false;

const due = (a: Account, d: string) => a.fields.opened_on <= d && (!a.fields.closed_on || d < a.fields.closed_on);
const known = (e: Entry) => e.amount_cents !== null;
function latestBefore(id: string, before?: string) {
  const hit = snapshots.filter(s => !before || s.date < before).sort((a, b) => b.date.localeCompare(a.date)).flatMap(s => s.entries.filter(e => e.account_id === id && known(e)).map(e => ({ amount_cents: e.amount_cents!, date: s.date, ...(e.original_minor!=null?{original_minor:e.original_minor,fx_rate_micro:e.fx_rate_micro}:{}),...(e.quantity_e8!=null?{quantity_e8:e.quantity_e8,unit_price_e6:e.unit_price_e6}:{}) })))[0];
  return hit ?? null;
}
const withLatest = (a: Account): Account => ({ ...a, latest: latestBefore(a.id), has_entries: snapshots.some(s=>s.entries.some(e=>e.account_id===a.id)), last_entered_on: snapshots.filter(s => s.entries.some(e => e.account_id === a.id && e.state === 'entered')).map(s => s.date).sort().at(-1) ?? null });
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
    const balance = (kinds: string[]) => complete ? String(s.entries.filter(e => e.counted && e.side === 'asset' && kinds.includes(e.kind) && known(e)).reduce((t, e) => t + BigInt(e.amount_cents!), 0n)) : null;
    const p: Point = { snapshot_id: s.id, date: s.date, notes: s.notes, assets_cents: String(assets), liabilities_cents: String(liabilities), net_cents: String(net), liquid_cents: balance(['cash']), invested_cents: balance(['investment', 'mixed', 'fund', 'bond', 'precious_metal']), complete, has_unchanged: s.entries.some(e => e.state === 'unchanged'), missing: s.missing.length, compared_to: null, scope_changed: false, change_cents: null, hpf_change_cents: null, change_rate_hundredths: null };
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
  return { generation, points, structure_date: last?.s.date ?? null, structure_entries: last?.s.entries.map(e => ({ ...e })) ?? [], latest_entries: [...snapshots].sort((a,b) => a.date.localeCompare(b.date)).at(-1)?.entries.map(e => ({ ...e })) ?? [], structure: shares('asset'), liabilities: shares('liability') };
}

// Standalone expenses for the preview; item purchases come from the demo assets.
let expenses: Expense[] = (params.get('expenses') === 'empty' || params.get('state') === 'empty') ? [] : demoFinance.expenses.filter(e => !e.deleted).map(e => ({
  id: 'x-' + e.key, fields: { title: e.title, date: shifted(0, -e.days_ago), amount_cents: e.amount_cents, category: e.category,
    notes: '虚构样例', refund_cents: e.refund_cents, refund_date: e.refund_days_ago === null ? null : shifted(0, -e.refund_days_ago), asset_id: e.asset_key },
  revision: 1, asset_name: demoAssets.find(a => a.key === e.asset_key)?.name ?? null, asset_deleted: false,
}));
function expenseView(year: number | null, period: FinancePeriod = year === null ? { kind: 'all' } : { kind: 'year', year }): ExpenseView {
  const items: Line[] = (params.get('expenses') === 'empty' || params.get('state') === 'empty') ? [] : demoAssets.flatMap(a => [
    { source: 'purchase' as const, id: a.key, asset_id: a.key, title: a.name, category: a.category, date: a.purchase_date, amount_cents: a.price_cents, notes: null },
    ...(a.maintenance ? [{ source: 'maintenance' as const, id: 'm-' + a.key, asset_id: a.key, title: `${a.name} · ${a.maintenance.title}`, category: a.category, date: a.maintenance.date, amount_cents: a.maintenance.cost_cents, notes: null }] : []),
    ...(a.sale ? [{ source: 'sale' as const, id: 's-' + a.key, asset_id: a.key, title: a.name, category: a.category, date: a.sale.date, amount_cents: a.sale.price_cents, notes: null }] : []),
  ]);
  const paidLines: Line[] = payments.filter(p => p.state === 'paid').map(p => ({ source: 'payment', id: p.id, asset_id: null, plan_id: p.plan_id, title: p.plan_name, category: plans.find(x => x.id === p.plan_id)?.fields.category ?? null, date: p.paid_date, amount_cents: p.amount_cents, notes: null }));
  const virtualLines: Line[] = virtuals.filter(v => !v.fields.plan_id && v.fields.price_cents !== null).map(v => ({ source: 'virtual', id: v.id, asset_id: null, title: v.fields.name, category: 'digital', date: v.fields.purchase_date, amount_cents: v.fields.price_cents, notes: null }));
  const all: Line[] = [...items, ...(previewModules.recurring ? paidLines : []), ...(previewModules.virtual ? virtualLines : []), ...(previewModules.expenses ? expenses : []).flatMap(e => [
    { source: e.fields.asset_id ? 'linked' as const : 'expense' as const, id: e.id, asset_id: e.fields.asset_id, title: e.fields.title, category: e.fields.category, date: e.fields.date, amount_cents: e.fields.amount_cents, notes: e.fields.notes },
    ...(e.fields.refund_date ? [{ source: 'refund' as const, id: e.id, asset_id: e.fields.asset_id, title: e.fields.title, category: e.fields.category, date: e.fields.refund_date, amount_cents: e.fields.refund_cents, notes: e.fields.notes }] : []),
  ])];
  const inYear = (l: Line) => financePeriodContains(period, l.date);
  const lines = all.filter(inYear).sort((a, b) => b.date!.localeCompare(a.date!)), undated = all.filter(l => l.date === null);
  const sum = (ls: Line[]) => ls.reduce((t, l) => t + BigInt(l.amount_cents ?? '0'), 0n);
  const spendSource = (l: Line) => ['purchase', 'maintenance', 'expense', 'payment', 'virtual', 'topup'].includes(l.source);
  const spentLines = lines.filter(l => spendSource(l) && l.amount_cents !== null);
  const spent = sum(spentLines), refunds = sum(lines.filter(l => l.source === 'refund'));
  const yearKeys = [...new Set(all.flatMap(l => l.date ? [l.date.slice(0, 4)] : []))].sort();
  const bucket = (ls: Line[]) => { const spentB = sum(ls.filter(l => spendSource(l) && l.amount_cents !== null)); const count = ls.filter(l => spendSource(l)).length; const known = ls.filter(l => spendSource(l) && l.amount_cents !== null).length;
    return { spent: String(spentB), refund: String(sum(ls.filter(l => l.source === 'refund'))), sale: String(sum(ls.filter(l => l.source === 'sale'))), count, known_count: known, unknown_count: count - known }; };
  const annual_totals = period.kind === 'all' ? yearKeys.map(k => { const b = bucket(all.filter(l => l.date?.startsWith(k + '-'))); return { year: Number(k), spent_cents: b.spent, refund_cents: b.refund, net_cents: String(BigInt(b.spent) - BigInt(b.refund)), sale_cents: b.sale, count: b.count, known_count: b.known_count, unknown_count: b.unknown_count }; }) : [];
  const monthBucket = (m: string) => { const b = bucket(all.filter(l => l.date?.startsWith(m))); return { month: m, spent_cents: b.spent, refund_cents: b.refund, count: b.count, known_count: b.known_count, unknown_count: b.unknown_count }; };
  return { generation, year, period, years: yearKeys.map(Number).sort((a, b) => b - a), lines, undated,
    months: year === null ? [] : Array.from({ length: 12 }, (_, i) => monthBucket(`${year}-${String(i + 1).padStart(2, '0')}`)),
    annual_totals,
    spent_cents: String(spent), refund_cents: String(refunds), net_cents: String(spent - refunds), sale_cents: String(sum(lines.filter(l => l.source === 'sale'))),
    undated_cents: String(sum(undated)), unknown_amount_count: lines.filter(l => l.amount_cents === null).length };
}

// Recurring plans share the native fixture definitions.
const todayIso = iso(now);
let savingsGoals: SavingsGoal[] = params.get('state') === 'empty' || params.get('savings') === 'empty' || !accounts.length ? [] : [{
  id: 'preview-savings-goal', fields: { name: '虚构应急金', target_cents: '15000000', target_date: `${now.getFullYear()+1}-12-31`, notes: '' },
  account_ids: accounts.filter(a=>a.fields.side==='asset' && a.fields.kind==='cash').slice(0,2).map(a=>a.id),
  position:0,revision:1,created_on:shifted(6),created_at:`${shifted(6)}T08:00:00Z`,updated_at:`${todayIso}T08:00:00Z`,deleted_at:null,
}];
function savingsRead(year=now.getFullYear()): SavingsRead {
  const w=summary(),latest=[...w.points].reverse().find(p=>p.complete),s=latest?snapshots.find(s=>s.id===latest.snapshot_id):null;
  const basis=(s:Stored)=>({snapshot_id:s.id,date:s.date,revision:s.revision});
  const observe=(g:SavingsGoal,s:Stored|null|undefined):SavingsObservation[]=>g.account_ids.map(id=>{
    const a=accounts.find(a=>a.id===id),e=s?.entries.find(e=>e.account_id===id);
    const known=params.get('savings')!=='unknown' && !!e && e.amount_cents!==null && e.kind!=='property';
    return {account_id:id,name:a?.fields.name??'历史账户',kind:e?.kind??a?.fields.kind??'cash',status:known?'known':'missing',amount_cents:known?e!.amount_cents:null,reason:known?'':'该次盘点没有此账户已知余额'};
  });
  const active=savingsGoals.filter(g=>!g.deleted_at);
  return {generation,write_version:planWriteVersion,today:todayIso,year,years:[...new Set([now.getFullYear(),...w.points.map(p=>Number(p.date.slice(0,4)))])],basis:s?basis(s):null,newer_incomplete:w.points.at(-1)?.complete===false,accounts:accounts.map(withLatest),goals:active.map(g=>({goal:g,observations:observe(g,s),shared_account_ids:g.account_ids.filter(id=>active.filter(g=>g.account_ids.includes(id)).length>1),planning_overlap:previewModules.planning?false:null,history:snapshots.filter(s=>s.date>=g.created_on && Number(s.date.slice(0,4))<=year && !view(s).missing.length).map(s=>({basis:basis(s),observations:observe(g,s)}))}))};
}
/** k-th scheduled date counted from the anchor, clamped to month end (preview mirror of Rust). */
function nth(first: string, interval: number, k: number) {
  const [y, m, d] = first.split('-').map(Number), total = m - 1 + interval * k, yy = y + Math.floor(total / 12), mm = total % 12;
  return iso(new Date(yy, mm, Math.min(d, new Date(yy, mm + 1, 0).getDate())));
}
function schedule(p: Plan, from: string, to: string) { return planScheduleDates(p, from, to); }

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
if (params.has('subscription-lifecycle')) {
  plans = [plan('r-lifecycle', 'GPT Plus · 虚构订阅', 'subscription', '14000', 1, '2026-01-31', { service_start: '2026-01-31', coverage_start: '2026-01-31', end_date: '2026-07-30', auto_renew: false })];
  plans[0].active_from = todayIso;
  payments = [{ id: 'p-lifecycle', plan_id: 'r-lifecycle', plan_name: plans[0].fields.name, due_date: '2026-01-31', state: 'paid', paid_date: '2026-01-31', amount_cents: '14000', coverage_start: '2026-01-31', coverage_end: '2026-02-27', notes: '虚构付款', revision: 1, off_schedule: false }];
}
const subscriptionPreviewRates = new Map<string, { from: string; amount: string }[]>();
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
    return { ...p, next_due: p.fields.paused ? null : next, current_coverage: currentCoverage, next_coverage: next ? coverageFor(p.fields, next) : null, monthly_cents: String((amount+BigInt(p.fields.interval_months)/2n)/BigInt(p.fields.interval_months)), paid_cents: String(payments.filter(x=>x.plan_id===p.id&&x.state==='paid').reduce((t,x)=>t+BigInt(x.amount_cents ?? '0'),0n)), estimated_cents: start ? p.resumptions?.length ? String(schedule(p, start, todayIso).reduce((t,d) => t + BigInt(subscriptionPreviewRates.get(p.id)?.filter(r => r.from <= d).at(-1)?.amount ?? p.fields.amount_cents), 0n)) : String(amount*BigInt(historyCount)) : null, contract_cents: contractCount ? String(amount*BigInt(contractCount)) : null };
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
if (params.has('subscription-lifecycle')) {
  const base = virtuals[0]?.fields;
  if (base) virtuals = [{ id: 'v-lifecycle', revision: 1, fields: { ...base, name: 'GPT Plus · 虚构订阅', plan_id: 'r-lifecycle', billing: 'subscription', kind: 'subscription', price_cents: null, stopped_on: null } }];
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
    return { ...v, paid_count: paid.length, paid_until: paidUntil, plan:p??null, plan_name: p?.fields.name ?? null, plan_deleted: false, valid_until: until, status, spent_cents: v.fields.billing === 'topup' ? (mine.length ? String(known) : null) : spent,
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
if (params.get('hpf') === 'unknown' && planIncomes.length) [...planIncomes].sort((a,b)=>b.fields.date.localeCompare(a.fields.date))[0].fields.hpf_cents = null;
let planTrash: Income[] = [];
// 首页规划摘要的退休预算夹具：set 为虚构 5000 元，也可直接给元数（如 plan-budget=6500）。
const planBudgetParam = params.get('plan-budget');
const planBudgetCents = planBudgetParam === null ? null : planBudgetParam === 'set' ? '500000' : /^\d+(\.\d{1,2})?$/.test(planBudgetParam) ? String(Math.round(Number(planBudgetParam) * 100)) : null;
// 虚构通用规划，不含旧政策资料。
let planProfile: ProfileState['saved'] = params.get('plan-profile') === 'empty' ? null : { revision: 1, updated_at: new Date().toISOString(), profile: { assumptions: { inflation_hundredths: 200 }, retire: { ...structuredClone(defaultRetire), spend_cents: planBudgetCents } } };
// 首页规划摘要的局部读取失败夹具：只让指定来源失败，验证独立降级与局部重试。
const planFail = (source: string) => params.get('plan-fail') === source;

// ---- 通用规划基础：专用虚构预览（不代表原生保存或计算）----
// ?plan-basic=unknown|zero|negative|saved|terminal-zero|missing-costs|excluded|manual|beijing|beijing-complete|blank
// 其余开关：plan-start=live、plan-wealth=off、plan-req=zero|not-found|payment|bounds、state=save-error|unknown-result。
// 能力结果只在预览里按已保存输入挑选严格夹具；它不是计算器，原生联调以 Codex 的真实服务为准。
const firstRunFixture = params.get('plan-first-run');
const basicScenario = firstRunFixture ? ({ '0': 'blank', '1': 'unknown', '2': 'unknown', overdue: 'unknown', costs: 'missing-costs', beijing: 'beijing', '2b': 'beijing' }[firstRunFixture] ?? 'unknown') : params.get('plan-basic');
const basicDefaults = (): StoredProfile => {
  const f = basicInputFixtures.unknown;
  const retire = { ...structuredClone(defaultRetire), spend_cents: f.spend_cents, mode: f.mode, emergency_months: 0, setup_completed: true, basic: structuredClone(f.basic), core: emptyCore(todayIso), simplified: { ...simplifiedEmpty(), time: { reference: null, target_month: `${now.getFullYear()+20}-01`, horizon_month: `${now.getFullYear()+50}-01` }, income_mode: 'excluded' as const } };
  return { assumptions: { inflation_hundredths: 0 }, retire };
};
function basicScenarioProfile(kind: string): ProfileState['saved'] {
  if (kind === 'blank') return null;
  const p = basicDefaults(), r = p.retire, b = r.basic!;
  const contribution = { unknown: null, zero: '0', negative: '-200000', saved: '500000', 'terminal-zero': '500000' }[kind as 'unknown'] ?? null;
  b.contribution.monthly_cents = contribution;
  if (kind === 'manual') { r.simplified.income_mode = 'manual'; r.simplified.future_incomes = [{ id:'fx-annuity',name:'企业年金',role:'other',included:true,monthly_cents:'120000',start_month:r.simplified.time.target_month,end_month:null,basis:'start_month',basis_month:null,growth:'fixed_nominal',source:null,source_checked_on:null,notes:'' }]; }
  if (kind === 'missing-costs') { r.rent_cents = '100000'; r.spend_items = [{ id:'fx-health',label:'医疗',monthly_cents:'100000',start_month:null,end_month:null,time_unconfirmed:false,inflation_hundredths:400,essential:true }]; }
  if (params.get('plan-start') === 'live') b.start = { kind: 'live' };
  return { revision: 1, updated_at: new Date().toISOString(), profile: p };
}
if (basicScenario) planProfile = basicScenarioProfile(basicScenario);
// Confirmed planning / continuation acceptance fixtures, all balances fictional.
const coreScenario = firstRunFixture === 'overdue' || firstRunFixture === '2b' ? 'overdue' : params.get('plan-core');
if (coreScenario && planProfile && snapshots.length) {
  const s = snapshots[snapshots.length - 1], cash = accounts.find(a => a.fields.kind === 'cash')!, debt = accounts.find(a => a.fields.kind === 'loan')!;
  s.entries = s.entries.map(e => e.account_id === cash.id ? { ...e, amount_cents: '70000000' } : e.side === 'liability' ? { ...e, counted: true, amount_cents: e.account_id === debt.id && ['occurred','partial'].includes(coreScenario) ? '10000000' : '0' } : e);
  const p = planProfile.profile, r = p.retire;
  if (r.basic) {
    r.basic.start = { kind: 'live' };
    r.basic.contribution.monthly_cents = '500000';
  }
  r.core = { ...emptyCore(s.date), fund_rules: s.entries.filter(e => e.counted && e.side === 'asset').map(e => ({ account_id: e.account_id, availability: e.kind === 'cash' ? 'available' : 'restricted', share_hundredths: 10000 })) };
  if (['occurred','partial','overdue'].includes(coreScenario)) {
    const date = shifted(1).slice(0, 7);
    r.life_events = [{ id: 'fx-occurred', label: '虚构已购住宅', kind: 'house', date, included: false, price_cents: '40000000', down_cents: '30000000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 30, holding_cents: '10000', rent_saved_cents: '0', cycle_years: null, until_month: null, time_unconfirmed: false, resale_cents: '0' }];
    if (coreScenario === 'overdue') r.life_events[0].included = true;
    else {
      r.core.occurrences = [{ id: 'fx-occurrence', event_id: 'fx-occurred', status: 'occurred', actual_date: date + '-01', payments_complete: coreScenario === 'occurred', payments: [{ id: 'fx-payment', date: date + '-01', amount_cents: '30000000', account_id: cash.id, absorbed_snapshot_id: s.id, absorbed_revision: s.revision, source_kind: null, source_id: null }], loan: { account_id: debt.id, as_of: s.date, principal_cents: '10000000', remaining_months: 50 } }];
    }
  }
  if (r.basic) {
    const scopes = costSources(r.life_events).map(source => ({ source_id: source.id, treatment: source.id === eventSource('fx-occurred','loan') && coreScenario !== 'overdue' ? 'included' as const : 'extra' as const, reference_cents: source.id === eventSource('fx-occurred','loan') && coreScenario !== 'overdue' ? '200000' : null }));
    r.basic.contribution_costs = scopes;
    r.basic.retirement_costs = scopes.map(source => ({ ...source, treatment: 'extra', reference_cents: null }));
  }
}
// First-run fixtures are fictional in-memory inputs, using the unchanged real calculator.
if (firstRunFixture && planProfile?.profile.retire.basic) {
  const p = planProfile.profile, r = p.retire, b = r.basic!;
  if (firstRunFixture === '1') { r.spend_cents = null; r.simplified.income_mode = 'unconfirmed'; }
  if (firstRunFixture === 'costs') r.simplified.income_mode = 'excluded';
  if (firstRunFixture === '2b') { r.simplified.income_mode = 'unconfirmed'; r.rent_cents = '100000'; b.retirement_costs = []; b.contribution.monthly_cents = null; }
  if (firstRunFixture === 'overdue') { r.simplified.income_mode = 'excluded'; b.contribution.monthly_cents = null; }
}
// ?plan-household=couple-same|couple-age|couple-age-empty: fictional two-person fixtures for the saved plan.
const householdFixture = params.get('plan-household');
if (householdFixture && planProfile?.profile.retire.basic) {
  const partner = { birth_month: '1992-04', stop_age_months: householdFixture === 'couple-same' ? null : 62 * 12, monthly_cents: householdFixture === 'couple-age' ? '150000' : null };
  planProfile.profile.retire.simplified.household = { mode: 'couple', partner };
  if (params.get('plan-household-mode') === 'fire') planProfile.profile.retire.mode = 'fire';
}
const reviewFixture = params.get('review-fixture');
if (reviewFixture && snapshots.length >= 2) {
  const last = snapshots.at(-1)!;
  snapshots = [snapshots[0], last].map((s, i) => ({ ...s, entries: s.entries.map(e => ({ ...e, state: 'entered' as const, amount_cents: e.kind === 'cash' ? (i ? '16000000' : '10000000') : '0', counted: e.side === 'asset' })) }));
  planIncomes = reviewFixture === 'no-income' ? [] : [{ id: 'review-income', revision: 1, fields: { date: last.date, net_cents: '2000000', hpf_cents: '0', notes: '虚构已记录收入；增长可能含估值' } }];
  if (['history', 'hpf-unknown', 'no-investment'].includes(reviewFixture)) {
    const base = snapshots[0];
    snapshots = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(base), id: `review-history-${i}`, date: shifted(3 - i), notes: '虚构三段可比历史', entries: base.entries.map(e => ({ ...e, counted: reviewFixture !== 'no-investment' || e.kind !== 'mixed', amount_cents: e.kind === 'cash' ? String(10000000 + i * 300000) : e.kind === 'deposit' ? '0' : e.kind === 'housing_fund' ? String(i * 100000) : e.side === 'asset' ? String(i * 200000) : '0' })) }));
    planIncomes = snapshots.slice(1).map((s, i) => ({ id: `review-history-income-${i}`, revision: 1, fields: { date: s.date, net_cents: '1000000', hpf_cents: reviewFixture === 'hpf-unknown' ? null : '100000', notes: '虚构税后收入和缴存' } }));
  }
  if (reviewFixture === 'scope') snapshots[1].entries[0].counted = !snapshots[0].entries[0].counted;
  if (reviewFixture === 'incomplete') snapshots.splice(1, 0, { ...structuredClone(snapshots[0]), id: 'review-incomplete', date: shifted(1), entries: snapshots[0].entries.map((e, i) => i ? e : { ...e, amount_cents: null, state: 'missing' }) });
  if (reviewFixture === 'no-plan') planProfile = null;
  else if (planProfile) {
    const r = planProfile.profile.retire, s = snapshots.at(-1)!;
    r.core = { ...emptyCore(s.date), fund_rules: s.entries.filter(e => e.counted && e.side === 'asset').map(e => ({ account_id: e.account_id, availability: 'available' as const, share_hundredths: 10000 })) };
    if (['history', 'hpf-unknown', 'no-investment'].includes(reviewFixture)) {
      r.core.fund_rules = s.entries.filter(e => e.counted && e.side === 'asset').map(e => ({ account_id: e.account_id, availability: e.kind === 'housing_fund' ? 'restricted' as const : 'available' as const, share_hundredths: 10000 }));
      if (r.basic) r.basic.contribution.monthly_cents = null;
    }
    r.life_events = reviewFixture === 'pending' ? [{ id: 'review-event', label: '虚构大额安排', kind: 'other', date: shifted(1).slice(0,7), included: true, price_cents: '10000', down_cents: '10000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 1, holding_cents: '0', rent_saved_cents: '0', cycle_years: null, until_month: null, time_unconfirmed: false, resale_cents: '0' }] : [];
  }
}
if (params.get('plan-usability') === '1' && planProfile?.profile.retire.basic) {
  const r = planProfile.profile.retire;
  r.life_events = ['北京买房', '二手车', '二三线买房'].map((label, i) => ({ id: `fx-layout-${i}`, label, kind: i === 1 ? 'car' : 'house', date: `${now.getFullYear()+2}-10`, included: i !== 2, price_cents: i === 1 ? '7000000' : '180000000', down_cents: i === 1 ? '7000000' : '60000000', extra_cents: '0', loan_rate_hundredths: 350, loan_years: 30, holding_cents: '120000', rent_saved_cents: '0', cycle_years: null, until_month: null, time_unconfirmed: false, resale_cents: '0' }));
  const scopes = costSources(r.life_events).map(s => ({ source_id: s.id, treatment: 'extra' as const, reference_cents: null }));
  r.basic!.contribution_costs = scopes; r.basic!.retirement_costs = scopes;
  if (params.get('plan-costs') === 'missing') { r.basic!.contribution_costs = []; r.basic!.retirement_costs = []; }
  if (params.get('plan-funds') === 'missing-one' && r.core) r.core.fund_rules = r.core.fund_rules.slice(1);
  if (params.get('plan-event-time') === 'pending') r.life_events[1].time_unconfirmed = true;
}
if (params.get('plan-time') === 'age' && planProfile?.profile.retire.basic) {
  planProfile.profile.retire.simplified.time = { reference: { month: '1990-06', age_months: 0 }, target_month: '2050-06', horizon_month: '2080-06' };
}
// Historical JSON fixtures use the same read boundary as native storage: facts survive,
// old goals/budgets are not defaults and unoccurred intentions require reconfirmation.
if (planProfile) {
  const p=planProfile.profile,r=p.retire;
  if (!r.basic) p.retire={...structuredClone(defaultRetire),core:r.core,life_events:r.life_events.map(e=>({...e,included:r.core?.occurrences.some(o=>o.status==='occurred'&&o.event_id===e.id)?e.included:false}))};
  for (const key of ['saving_phases','route_id','route_from_age','gap_share_hundredths','gap_keeps_paying','legacy_definition']) delete (p.retire as Record<string,unknown>)[key];
}
const nonblockingScenario = params.get('plan-nonblocking');
const nonblockingBatch = structuredClone(nonblockingDemo) as unknown as PlanningSources;
if (nonblockingScenario) {
  planProfile = structuredClone(nonblockingBatch.profile.status === 'ready' ? nonblockingBatch.profile.value.saved : null);
  if (nonblockingScenario === 'empty') planProfile = null;
  if (planProfile) {
    const p = planProfile.profile, r = p.retire;
    if (nonblockingScenario === 'unknown') r.core!.occurrences = [{ id: crypto.randomUUID(), event_id: r.life_events[0].id, status: 'occurred', actual_date: nonblockingBatch.today, payments_complete: false, payments: [{ id: crypto.randomUUID(), date: nonblockingBatch.today, amount_cents: null, account_id: null, absorbed_snapshot_id: null, absorbed_revision: null, source_kind: null, source_id: null }], loan: null }];
    if (nonblockingScenario === 'funds') r.core!.fund_rules = [];
    if (nonblockingScenario === 'income') r.simplified.income_mode = 'unconfirmed';
  }
}
let planWriteVersion = 1;
const debtScenario = params.get('plan-debt');
const debtBatch = debtFixture(debtDemo as unknown as PlanningSources, debtScenario ?? 'normal');
if (debtScenario && debtBatch.profile.status === 'ready') planProfile = debtBatch.profile.value.saved;
const completionScenario = params.get('plan-completion');
const completionBatch = completionFixture(debtDemo as unknown as PlanningSources, completionScenario ?? 'funds');
if (completionScenario && completionBatch.profile.status === 'ready') planProfile = completionBatch.profile.value.saved;
const updateResults = new Map<string, NonNullable<ProfileState['saved']>>();
let lostOnce = false;
const readError = (message: string, code = 'READ_FAILED') => ({ status: 'error' as const, value: { code, message } });
const planningSources = (args: Record<string, unknown>): PlanningSources => {
  if (completionScenario) return { ...completionBatch, generation, write_version: planWriteVersion, profile: { status: 'ready', value: { generation, saved: planProfile } } };
  if (debtScenario) return { ...debtBatch, generation, write_version: planWriteVersion, profile: { status: 'ready', value: { generation, saved: planProfile } } };
  if (nonblockingScenario) return { ...nonblockingBatch, generation, write_version: planWriteVersion, profile: nonblockingScenario === 'error' ? { status: 'error', value: { code: 'READ_FAILED', message: '虚构规划资料读取失败' } } : { status: 'ready', value: { generation, saved: planProfile } } };
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
  const p: StoredProfile = old ? structuredClone(old) : { assumptions: { inflation_hundredths: 0 }, retire: structuredClone(defaultRetire) };
  const core = (basis: string) => { if (p.retire.core && p.retire.core.monetary_basis_date !== basis) throw { code: 'PLANNING_BASIS', message: '已有金额基准固定' }; return (p.retire.core ??= { ...emptyCore(basis) }); };
  if (u.section === 'setup') {
    let next = mergeSection(old, { ...u, section: 'basic', fields: u.fields.basic });
    if (u.fields.budget) next = mergeSection(next, { ...u, section: 'budget', fields: u.fields.budget });
    if (u.fields.funds) next = mergeSection(next, { ...u, section: 'funds', fields: u.fields.funds });
    next = mergeSection(next, { ...u, section: 'simplified', fields: u.fields.simplified });
    return next;
  }
  if (u.section === 'basic') {
    const f = u.fields;
    if (old?.retire.basic && old.retire.basic.contribution.id !== f.basic.contribution.id) throw { code: 'PLANNING_BASIC', message: '投入稳定ID不能替换' };
    for (const key of ["saving_phases","route_id","route_from_age","gap_share_hundredths","gap_keeps_paying","legacy_definition"]) delete (p.retire as Record<string, unknown>)[key];
    core(f.monetary_basis_date); p.assumptions.inflation_hundredths = f.inflation_hundredths;
    Object.assign(p.retire, { basic: f.basic, spend_cents: f.spend_cents, mode: f.mode, real_return_before_hundredths: f.real_return_before_hundredths, real_return_after_hundredths: f.real_return_after_hundredths, volatility_hundredths: f.volatility_hundredths, emergency_months: f.emergency_months, setup_completed: true });
  } else if (u.section === 'funds') {
    const f = u.fields;
    Object.assign(core(f.monetary_basis_date), { fund_rules: f.fund_rules, releases: f.releases });
  } else if (u.section === 'debt_repayments') {
    if (!p.retire.core) throw { code: 'PLANNING_BASIC', message: '先确认资金起点' };
    p.retire.core.debt_repayments = mergeDebtRepayments(p.retire.core.debt_repayments ?? [], u.fields.updates, u.fields.remove);
  } else if (u.section === 'events') {
    const f = u.fields;
    if (!p.retire.core) throw { code: 'PLANNING_BASIC', message: '先确认金额基准' };
    if ('costs' in f) throw { code: 'PLANNING_BASIC', message: '旧阶段费用不能保存' };
    p.retire.life_events = f.life_events; p.retire.core.occurrences = f.occurrences;
  } else if (u.section === 'simplified') p.retire.simplified = structuredClone(u.fields);
  else if (u.section === 'budget') Object.assign(p.retire, u.fields);
  return p;
}
// Previews use the same real capability calculator with fictional sources.
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
let previewMerged = false;
const previewGroups = new Map<string, { assetId: string; planId: string; assetName: string; planName: string }>();
// ?trash=link 预先放入一组已删除的关联订阅，用于查看最近删除里的整组恢复与清除。
if (params.get('trash') === 'link') {
  const asset = virtuals.find(v => plans.some(p => p.id === v.fields.plan_id)), plan = plans.find(p => p.id === asset?.fields.plan_id);
  if (asset && plan) {
    virtuals = virtuals.filter(v => v.id !== asset.id); plans = plans.filter(p => p.id !== plan.id); payments = payments.filter(p => p.plan_id !== plan.id);
    previewGroups.set(`${asset.id}|${plan.id}`, { assetId: asset.id, planId: plan.id, assetName: asset.fields.name, planName: plan.fields.name });
  }
}
/** 预览最近删除中的关联订阅组（内存桩）。 */
export function previewLinkGroups() { return [...previewGroups.values()]; }
export function previewPurgeLinkGroup(id: string) { return previewGroups.delete(id); }
export function wealthPreview(command: string, args: Record<string, unknown>): { value: unknown } | null {
  // Fictional capability only; browser preview never calls device authentication.
  if (command === 'privacy_auth_available') return { value: ['success', 'cancel'].includes(params.get('privacy-auth') ?? '') };
  if (command === 'privacy_authenticate') {
    if (params.get('privacy-auth') === 'success') return { value: null };
    throw { code: 'AUTH_FAILED', message: '虚构身份验证已取消，请点解锁重试。' };
  }
  if(command==='savings_goals_read') {
    if(params.get('savings')==='error') throw {message:'虚构目标读取失败'};
    if(!previewModules.wealth) throw {code:'MODULE_DISABLED',message:'账户与盘点已关闭'};
    return {value:savingsRead(typeof args.year==='number'?args.year:now.getFullYear())};
  }
  if(command==='savings_goals_save') {
    if(params.get('state')==='save-error') throw {message:'虚构保存失败，输入保留'};
    const input=args.input as SavingsSave,old=savingsGoals.find(g=>g.id===input.id),id=input.id??crypto.randomUUID();
    const next:SavingsGoal={id,fields:input.fields,account_ids:input.account_ids,position:old?.position??savingsGoals.length,revision:(old?.revision??0)+1,created_on:old?.created_on??todayIso,created_at:old?.created_at??new Date().toISOString(),updated_at:new Date().toISOString(),deleted_at:null};
    savingsGoals=old?savingsGoals.map(g=>g.id===id?next:g):[...savingsGoals,next];receipts.set(input.request_id,id);planWriteVersion++;
    if(params.get('state')==='unresolved') throw {message:'虚构响应丢失'};
    return {value:next};
  }
  if(command==='savings_goals_trash') {
    const input=args.input as SavingsTrash;savingsGoals=savingsGoals.map(g=>g.id===input.id?{...g,revision:g.revision+1,deleted_at:input.deleted?new Date().toISOString():null}:g);receipts.set(input.request_id,input.id);planWriteVersion++;return {value:null};
  }
  const imported = financialImportPreview(command, args, generation); if (imported) return imported;
  // Explicit injected output only: preview never reimplements native investment profit.
  if (command === 'investment_review_list') return { value: { generation, records: [] } };
  if (command === 'investment_review_read') {
    const fixture = reviewFixtures[params.get('investment') as keyof typeof reviewFixtures];
    if (fixture) return { value: { generation, ...structuredClone(fixture), from_value_key: 'fictional-preview-only', to_value_key: 'fictional-preview-only', records: [] } satisfies InvestmentReviewRead };
    throw { code: 'PREVIEW_NATIVE_ONLY', message: '浏览器预览不执行原生投资计算。可用 investment=ready-profit 等显式虚构夹具查看状态；实际资料请在原生应用核对。' };
  }
  if (command === 'investment_review_save' || command === 'investment_review_trash') throw { code: 'PREVIEW_NATIVE_ONLY', message: '此处为固定虚构输出，未保存。真实投资核对须在原生应用中进行。' };
  if (command === 'notification_permission') return { value: null };
  // ---- 关联订阅命令的内存桩----
  if (command === 'link_view') {
    const kind = args.kind as 'virtual' | 'plan', id = args.id as string;
    if (params.get('link') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' };
    const asset = virtuals.find(v => (kind === 'virtual' ? v.id === id : v.fields.plan_id === id));
    const plan = plans.find(p => (kind === 'plan' ? p.id === id : p.id === asset?.fields.plan_id));
    const paid = payments.filter(p => p.plan_id === plan?.id && p.state === 'paid');
    const relation = asset && plan ? 'linked' : 'unlinked';
    return { value: { generation, relation, asset: asset ? { id: asset.id, name: asset.fields.name, revision: asset.revision, deleted: false, billing: 'subscription', stopped_on: asset.fields.stopped_on ?? null, provider: asset.fields.provider, label_name: null } : null, plan: plan ? { id: plan.id, name: plan.fields.name, revision: plan.revision, deleted: false, category: plan.fields.category, end_date: plan.fields.end_date ?? null, auto_renew: plan.fields.auto_renew ?? true, paused: plan.fields.paused, service_start: plan.fields.service_start ?? null } : null, paid_count: paid.length, skipped_count: 0, paid_cents: String(paid.reduce((t, p) => t + BigInt(p.amount_cents ?? '0'), 0n)), paid_until: paid.map(p => p.coverage_end ?? p.due_date).sort().at(-1) ?? null, needs_review: !!asset?.fields.stopped_on && (plan?.fields.end_date ?? null) === null, occupied_by: null, candidates: [], group: null, reminder: null } };
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
    const held = previewGroups.get(groupId), asset = virtuals.find(v => v.id === assetId), plan = plans.find(p => p.id === planId);
    return { value: { generation, preview: 'preview-fixture', group_id: groupId, asset_name: held?.assetName ?? asset?.fields.name ?? '', plan_name: held?.planName ?? plan?.fields.name ?? '', payments_hidden: payments.filter(p => p.plan_id === planId).length, payments_stay_deleted: 0, blockers: [] } };
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
  if (command === 'link_purge_preview') {
    if (params.get('link') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' };
    const groupId = args.groupId as string, g = previewGroups.get(groupId);
    if (!g) throw { message: '这组记录已恢复或已清除，请重新读取最近删除' };
    return { value: { generation, preview: 'preview-fixture', group_id: groupId, asset_name: g.assetName, plan_name: g.planName, payments_total: 3, payments_live: 2, payments_deleted: 1, rate_segments: 2, rule_segments: 1, period_ends: 0, reminders: 1, external_refs: [], blockers: [] } };
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
  // 旧订阅合并发现：?merge=1 显示一对虚构候选，确认后本次预览内不再出现（不改动其他夹具）。
  if (command === 'link_merge_view') {
    return { value: { generation, pairs: params.get('merge') === '1' && !previewMerged ? [{ asset_id: 'merge-asset', asset_name: '虚构旧云盘', asset_revision: 1, provider: '虚构提供方', asset_price_cents: '60000', asset_expires: null, stopped_on: null, plan_id: 'merge-plan', plan_name: '虚构旧云盘', plan_revision: 1, amount_cents: '5000', interval_months: 1, interval_days: null, paid_count: 3, paid_cents: '15000' }] : [] } };
  }
  if (command === 'link_merge') {
    previewMerged = true;
    receipts.set((args.input as { request_id: string }).request_id, '1');
    return { value: '1' };
  }
  if (command === 'link_save' || command === 'link_create' || command === 'link_reconcile') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as { request_id: string; fields?: import('./recurring').PlanFields };
    if (input.fields?.name && input.fields.amount_cents) {
      plans = plans.map(p => p.fields.name === input.fields!.name || p.id === (args.input as { plan_id?: string }).plan_id ? { ...p, fields: { ...p.fields, ...input.fields! }, revision: p.revision + 1 } : p);
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
  if (command === 'recurring_detail') {
    if (params.get('subscription-history') === 'error') throw { message: '虚构付款记录读取失败。' };
    const o = recurringOverview(), p = o.plans.find(p => p.id === args.planId);
    if (!p) throw { message: '找不到这项计划' };
    return { value: { generation, plan: p, payments: o.payments.filter(r => r.plan_id === p.id) } };
  }
  if (command === 'recurring_resume') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as import('./recurring').ResumeSave, p = plans.find(p => p.id === input.plan_id)!;
    if (!subscriptionPreviewRates.has(p.id)) subscriptionPreviewRates.set(p.id, [{ from: p.fields.service_start!, amount: p.fields.amount_cents }]);
    subscriptionPreviewRates.get(p.id)!.push({ from: input.start_date, amount: input.amount_cents });
    const oldRule = { effective_date: p.fields.service_start!, anchor: p.fields.coverage_start!, first_due: p.fields.first_due, service_start: p.fields.service_start!, interval_months: p.fields.interval_months, interval_days: p.fields.interval_days ?? null, trial_days: p.fields.trial_days ?? null };
    const rule = { ...oldRule, effective_date: input.start_date, anchor: input.start_date, first_due: input.start_date, interval_months: input.interval_months, interval_days: input.interval_days, trial_days: null };
    p.resumptions = [...(p.resumptions ?? []), { resumed_on: input.start_date, previous_end: p.fields.end_date! }];
    p.rules = [...(p.rules?.length ? p.rules : [oldRule]), rule];
    p.fields = { ...p.fields, amount_cents: input.amount_cents, first_due: input.start_date, coverage_start: input.start_date, interval_months: input.interval_months, interval_days: input.interval_days, trial_days: null, auto_renew: true, paused: false, end_date: null };
    p.active_from = input.start_date; p.revision++;
    virtuals = virtuals.map(v => v.id === input.asset_id ? { ...v, fields: { ...v.fields, stopped_on: null }, revision: v.revision + 1 } : v);
    receipts.set(input.request_id,p.id); return { value: p.id };
  }
  if (command === 'recurring_overview') { if (params.get('recurring') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' }; return { value: recurringOverview() }; }  if (command === 'recurring_plan_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as PlanSave, id = input.id ?? crypto.randomUUID(), old = plans.find(p => p.id === id);
    const next: Plan = { ...old, id, fields: input.fields, revision: (old?.revision ?? 0) + 1, active_from: old ? (old.fields.paused && !input.fields.paused ? todayIso : old.active_from) : input.fields.service_start ? (todayIso > input.fields.first_due ? todayIso : input.fields.first_due) : input.fields.first_due, next_due: null };
    plans = old ? plans.map(p => p.id === id ? next : p) : [...plans, next];
    receipts.set(input.request_id, id);
    return { value: next };
  }
  if (command === 'recurring_payment_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as PaymentSave, p = plans.find(x => x.id === input.plan_id)!;
    if (!input.id && payments.some(x => x.plan_id === input.plan_id && x.due_date === input.due_date)) throw { code: 'PAYMENT_EXISTS', message: '这一期已经记录过，请打开原记录更正' };
    if (input.state === 'paid') {
      const day = input.paid_date ?? '';
      if (!day) throw { code: 'PAYMENT_DATE', message: '请填写实付日期' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) throw { code: 'DATE', message: '日期须为有效的 YYYY-MM-DD' };
      if (day > todayIso) throw { code: 'PAYMENT_DATE', message: '实付日期不能晚于今天' };
      if (!/^\d+$/.test(input.amount_cents ?? '') || BigInt(input.amount_cents!) <= 0n) throw { code: 'PAYMENT_AMOUNT', message: '实付金额须为正数' };
    }
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
    // Mock only: deleted records are dropped (not listed in 最近删除), so lists and totals update after a delete.
    if (input.deleted && input.kind === 'account') { accounts = accounts.filter(a => a.id !== input.id); return { value: null }; }
    if (input.deleted && input.kind === 'expense') { expenses = expenses.filter(e => e.id !== input.id); return { value: null }; }
    if (input.deleted && input.kind === 'payment') { payments = payments.filter(p => p.id !== input.id); return { value: null }; }
    if (input.deleted && input.kind === 'plan') { plans = plans.filter(p => p.id !== input.id); payments = payments.filter(p => p.plan_id !== input.id); return { value: null }; }
    if (input.deleted && input.kind === 'virtual') { virtuals = virtuals.filter(v => v.id !== input.id); topups = topups.filter(t => t.asset_id !== input.id); balances = balances.filter(b => b.asset_id !== input.id); return { value: null }; }
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
    if (input.fields.topup_date && !previewDay(input.fields.topup_date)) throw { code: 'DATE', message: '日期须为有效的 YYYY-MM-DD' };
    if (input.fields.topup_date && input.fields.topup_date > todayIso) throw { code: 'TOPUP_DATE', message: '充值日期不能晚于今天' };
    if (!input.fields.paid_cents && !input.fields.gift_cents && !input.fields.credit_cents) throw { code: 'TOPUP_EMPTY', message: '请至少填写实付、赠送或到账额度中的一项' };
    topups = [...topups.filter(t => t.id !== input.id), { id: input.id ?? crypto.randomUUID(), asset_id: input.asset_id, fields: input.fields, revision: 1 }];
    receipts.set(input.request_id, input.asset_id);
    return { value: { id: input.id ?? '', asset_id: input.asset_id, fields: input.fields, revision: 1 } };
  }
  if (command === 'virtual_balance_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as BalanceSave;
    if (!previewDay(input.recorded_on)) throw { code: 'DATE', message: '日期须为有效的 YYYY-MM-DD' };
    if (input.recorded_on > todayIso) throw { code: 'BALANCE_DATE', message: '记录日期不能晚于今天' };
    balances = [...balances.filter(b => b.id !== input.id), { id: input.id ?? crypto.randomUUID(), asset_id: input.asset_id, balance_cents: input.balance_cents, recorded_on: input.recorded_on, notes: input.notes, revision: 1 }];
    receipts.set(input.request_id, input.asset_id);
    return { value: { id: input.id ?? '', asset_id: input.asset_id, balance_cents: input.balance_cents, recorded_on: input.recorded_on, notes: input.notes, revision: 1 } };
  }
  if (command === 'virtual_save') {
    if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
    const input = args.input as VirtualSave, id = input.id ?? crypto.randomUUID(), old = virtuals.find(v => v.id === id);
    {
      const f = input.fields;
      if (!f.name.trim() || [...f.name.trim()].length > 80) throw { code: 'VIRTUAL_NAME', message: '名称须为 1–80 字' };
      for (const d of [f.purchase_date, f.expires, f.stopped_on, input.first_topup?.topup_date]) if (d && !previewDay(d)) throw { code: 'DATE', message: '日期须为有效的 YYYY-MM-DD' };
      if (f.purchase_date && f.purchase_date > todayIso) throw { code: 'VIRTUAL_DATE', message: '购买日期不能晚于今天' };
      if (f.stopped_on && f.stopped_on > todayIso) throw { code: 'VIRTUAL_STOP', message: '停用日期不能晚于今天' };
      if (f.stopped_on && f.purchase_date && f.stopped_on < f.purchase_date) throw { code: 'VIRTUAL_STOP', message: '停用日期不能早于购买日期' };
      if (input.first_topup?.topup_date && input.first_topup.topup_date > todayIso) throw { code: 'TOPUP_DATE', message: '充值日期不能晚于今天' };
    }
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
    {
      const f = input.fields, day = iso(now), valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v && v >= '1900-01-01';
      if (!f.title.trim() || [...f.title.trim()].length > 80) throw { code: 'EXPENSE_TITLE', message: '名称须为 1–80 字' };
      if (!valid(f.date)) throw { code: 'DATE', message: '日期须为有效的 YYYY-MM-DD' };
      if (f.date > day) throw { code: 'EXPENSE_DATE', message: '支出日期不能晚于今天' };
      if (!/^\d+$/.test(f.amount_cents) || BigInt(f.amount_cents) <= 0n) throw { code: 'EXPENSE_AMOUNT', message: '金额须为正数' };
      if ((f.refund_cents === null) !== (f.refund_date === null)) throw { code: 'EXPENSE_REFUND', message: '退款须同时填写金额和日期' };
      if (f.refund_cents !== null && f.refund_date !== null) {
        if (!/^\d+$/.test(f.refund_cents) || BigInt(f.refund_cents) <= 0n) throw { code: 'EXPENSE_REFUND', message: '退款金额须为正数' };
        if (BigInt(f.refund_cents) > BigInt(f.amount_cents)) throw { code: 'EXPENSE_REFUND', message: '退款不能超过支出金额' };
        if (!valid(f.refund_date)) throw { code: 'DATE', message: '日期须为有效的 YYYY-MM-DD' };
        if (f.refund_date < f.date || f.refund_date > day) throw { code: 'EXPENSE_REFUND', message: '退款日期须在支出日期与今天之间' };
      }
    }
    const next: Expense = { id, fields: input.fields, revision: (old?.revision ?? 0) + 1, asset_name: input.fields.asset_id ? demoAssets.find(a => a.key === input.fields.asset_id)?.name ?? '虚构物品' : null, asset_deleted: false };
    expenses = old ? expenses.map(e => e.id === id ? next : e) : [...expenses, next];
    receipts.set(input.request_id, id);
    return { value: next };
  }
  if (command === 'modules_get') return { value: previewModules };
  if (command === 'modules_set') { previewModules = { ...previewModules, ...(args.modules as Partial<RuntimeModules>), ...(typeof args.incomes === 'boolean' ? { incomes: args.incomes } : {}), ...(typeof args.movements === 'boolean' ? { movements: args.movements } : {}), finance_revision: previewModules.finance_revision + 1, finance_status: 'ready' }; return { value: previewModules }; }
  if (command === 'finance_sources') {
    if (params.get('finance') === 'error') throw { message: '虚构财务读取失败，用于验证重试。' };
    const period = args.period as FinancePeriod;
    const disabled = <T,>():FinanceRead<T> => ({ status:'disabled', reason:'功能已关闭，本次未读取' });
    const read = <T,>(enabled:boolean, name:string, fn:()=>T):FinanceRead<T> => {
      if (!enabled) return disabled();
      try { if (params.get(name) === 'error' || name === 'income' && planFail('income')) throw Error('虚构来源读取失败'); return {status:'ready',value:fn()}; }
      catch(e) { return {status:'error',code:'PREVIEW',message:String(e)}; }
    };
    const w = summary();
    const allIncome = read(previewModules.incomes,'income',()=>planIncomes);
    const allExpenses = read(true,'expenses',()=>expenseView(null));
    const movementYears = read(previewModules.movements && previewModules.wealth,'movement',()=>params.get('movement') === 'populated' ? [Number(todayIso.slice(0,4))] : []);
    const yearError = [allIncome,allExpenses,movementYears].find(r=>r.status==='error');
    const recordYears:FinanceRead<number[]> = yearError?.status === 'error' ? yearError : {status:'ready',value:[...new Set([
      ...(allIncome.status==='ready'?allIncome.value.map(i=>Number(i.fields.date.slice(0,4))):[]),
      ...(allExpenses.status==='ready'?allExpenses.value.years:[]),
      ...(movementYears.status==='ready'?movementYears.value:[]),
    ])].sort((a,b)=>a-b)};
    const value:FinanceSources = {
      generation, today:todayIso,write_version:planWriteVersion,period,modules:previewModules,record_years:recordYears,
      wealth:read(previewModules.wealth,'wealth',()=>w), accounts:read(previewModules.wealth,'accounts',()=>accounts.map(withLatest)),
      incomes:read(previewModules.incomes,'income',()=>planIncomes.filter(i=>financePeriodContains(period,i.fields.date))),
      expenses:read(true,'expenses',()=>({...expenseView(period.kind==='year'?period.year:null,period),period})),
      asset_review:read(previewModules.wealth,'wealth',()=>({generation,incomplete_count:w.points.filter(p=>!p.complete).length,intervals:w.points.filter(p=>p.complete&&p.compared_to).map(p=>({snapshot_id:p.snapshot_id,from:p.compared_to!,to:p.date,days:Math.round((Date.parse(p.date)-Date.parse(p.compared_to!))/86400000),status:p.scope_changed?'scope_changed' as const:'ok' as const,delta_nw_cents:p.change_cents,hpf_change_cents:p.hpf_change_cents,market_change_cents:p.market_change_cents??null}))})),
      history:read(previewModules.wealth&&previewModules.incomes,'history',()=>computeReview(w.points,planIncomes,planMarks,generation)),
    };
    if(args.view==='annual' && (period.kind==='year' || period.kind==='range')) {
      const range=normalizeFinancePeriod(period)!;
      const start=range.from;
      const last=w.points.filter(p=>p.complete&&p.date<=todayIso&&financePeriodContains(period,p.date)).at(-1);
      const first=w.points.filter(p=>p.complete&&p.date<=start&&p.date<=todayIso).at(-1)??w.points.find(p=>p.complete&&p.date<=todayIso&&financePeriodContains(period,p.date));
      value.annual={...(period.kind==='year'?{year:period.year}:{}),range,years:{status:'ready',value:[...new Set([now.getFullYear(),...(recordYears.status==='ready'?recordYears.value:[]),...w.points.map(p=>Number(p.date.slice(0,4)))])].sort((a,b)=>a-b)},comparison:read(previewModules.wealth,'wealth',()=>first&&last&&first.date<last.date?wealthPreview('wealth_compare',{from:first.snapshot_id,to:last.snapshot_id})!.value as import('./wealth').Compare:null),scope_changed:!!first&&!!last&&w.points.some(p=>p.complete&&p.date>first.date&&p.date<=last.date&&p.scope_changed),savings:read(previewModules.wealth,'savings',()=>savingsRead(Number(todayIso.slice(0,4)))),planning:read(previewModules.wealth&&previewModules.planning,'planning',()=>[])};
    }
    return {value};
  }
  if (command === 'movement_accounts') return { value:{generation,accounts:accounts.map(a=>({id:a.id,name:a.fields.name,kind:a.fields.kind,selectable:!a.fields.closed_on}))} };
  if (command === 'movement_list') {
    if (!previewModules.movements || !previewModules.wealth) throw {code:'MODULE_DISABLED',message:'资金流动已关闭'};
    if (params.get('movement') === 'error') throw {message:'虚构资金流动读取失败'};
    const records: MovementRecordV1[] = params.get('movement') === 'populated' ? [
      { id:'preview-transfer', revision:1, deleted:false, fields:{date:todayIso,amount_cents:'100050',from:{kind:'account',account_id:'w-cash'},to:{kind:'account',account_id:'w-broker'},purpose:'own_transfer',source:null,notes:'虚构：本月投资转入'},source_status:'unlinked' },
      { id:'preview-payment', revision:1, deleted:false, fields:{date:todayIso,amount_cents:'8800',from:{kind:'account',account_id:'w-cash'},to:{kind:'external',label:'虚构服务商'},purpose:'living_payment',source:{kind:'expense',key:'preview-expense-source'},notes:'虚构：来源更正后待核对'},source_status:'needs_review' },
    ] : [];
    const query = args.query as {from_date?:string;to_date?:string;account_id?:string;deleted?:string};
    return {value:{generation,records:records.filter(r=>(!query.from_date||r.fields.date>=query.from_date)&&(!query.to_date||r.fields.date<=query.to_date)&&(!query.account_id||r.fields.from.kind==='account'&&r.fields.from.account_id===query.account_id||r.fields.to.kind==='account'&&r.fields.to.account_id===query.account_id)),next_cursor:null}};
  }
  if (command === 'movement_sources') return {value:{generation,options:[],next_cursor:null}};
  if (command === 'followup_review_list') return {value:{generation,records:[]}};
  if (command === 'followup_review_read' || command === 'followup_review_preview') {
    if (params.get('investment') === 'error') throw {message:'虚构投资复盘读取失败'};
    const pair = args.pair as {from_snapshot_id:string,to_snapshot_id:string};
    const from=snapshots.find(s=>s.id===pair.from_snapshot_id), to=snapshots.find(s=>s.id===pair.to_snapshot_id);
    if (!from||!to) throw {code:'NOT_FOUND',message:'虚构盘点不存在'};
    const endpoint=(s:Stored)=>({snapshot_id:s.id,revision:s.revision,date:s.date,members:s.entries.filter(e=>['investment','mixed','fund','bond'].includes(e.kind)).map(e=>({account_id:e.account_id,kind:e.kind as 'investment'|'mixed'|'fund'|'bond',counted:e.counted,amount_cents:e.amount_cents}))});
    // Fixed unavailable result: this visual fixture intentionally performs no profit calculation.
    const preview:ReviewPreviewV1={generation,pair,review_id:null,revision:null,input:{contract_version:1,from:endpoint(from),to:endpoint(to),flow:null,overlapping_active_flow_ids:[]},result:{status:'needs_review',reasons:['incomplete_flow'],change_cents:null},saved_mode:null,selected:{mode:'manual',inflow_cents:null,outflow_cents:null},previous_totals:null,selected_totals:{inflow_cents:null,outflow_cents:null},difference:{inflow_cents:null,outflow_cents:null},movement_count:0,confirmation:'unconfirmed',reasons:[],basis_key:'fictional-preview-only'};
    return {value:command==='followup_review_read'?{draft:{selection:preview.selected,confirmed_complete:false,unsupported_movements:false,notes:''},preview}:preview};
  }
  if (['movement_save','movement_trash','followup_review_save','followup_review_trash'].includes(command)) throw {code:'PREVIEW_NATIVE_ONLY',message:'虚构浏览器预览不提交资金记录；原生保存另行验证。'};
  // Development-only read fixture. It never confirms or writes a native profile.
  if (command === 'plan_assumptions_read') {
    if (params.get('assumptions') === 'error') throw { code: 'PREVIEW_READ_ERROR', message: '虚构假设读取失败，请重试。' };
    if (!previewModules.planning) throw { code: 'MODULE_DISABLED', message: '目标模块已关闭。' };
    const p = planProfile?.profile;
    const values = { real_return_before_hundredths: p?.retire.real_return_before_hundredths ?? 0, real_return_after_hundredths: p?.retire.real_return_after_hundredths ?? 0, inflation_hundredths: p?.assumptions.inflation_hundredths ?? 200, volatility_hundredths: p?.retire.volatility_hundredths ?? 500 };
    const confirmation = params.get('assumptions') === 'confirmed' ? 'confirmed' : params.get('assumptions') === 'needs_review' ? 'needs_review' : 'unconfirmed';
    return { value: { generation, revision: planProfile?.revision ?? null, values, confirmation, confirmed_values: confirmation === 'unconfirmed' ? null : { ...values } } satisfies AssumptionReadV1 };
  }
  if (command === 'plan_assumptions_save') throw { code: 'PREVIEW_NATIVE_ONLY', message: '虚构浏览器预览不提交假设核对；原生保存另行验证。' };
  if (command === 'planning_sources') { if (params.get('plan') === 'error') throw { message: '虚构读取失败，用于验证错误状态。' }; return { value: planningSources(args) }; }
  if (command === 'plan_profile_update') {
    const input = args.input as ProfileUpdate;
    if (updateResults.has(input.request_id)) return { value: updateResults.get(input.request_id) };
    if (params.get('state') === 'save-error' || debtScenario === 'error') throw { message: '模拟保存失败，输入应保留。' };
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
      throw { code: 'PLANNING_SCOPED', message: '请使用分区更新；旧完整请求不能覆盖当前资料。' };
    }
    if (command === 'plan_income_defaults') {
      if (params.has('income-default-error')) throw { message: '虚构默认金额读取失败。' };
      const latest = [...planIncomes].filter(row => !['interest', 'cash_dividend', 'other_investment'].includes(row.fields.category ?? 'unclassified')).sort((a, b) => b.fields.date.localeCompare(a.fields.date) || a.id.localeCompare(b.id))[0];
      return { value: { generation, hpf_cents: latest?.fields.hpf_cents ?? null } };
    }
    if (command === 'plan_income_list') return { value: { generation, rows: [...planIncomes].sort((a, b) => b.fields.date.localeCompare(a.fields.date) || a.id.localeCompare(b.id)) } };
    if (command === 'plan_income_save') {
      if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
      const input = args.input as IncomeSave, id = input.id ?? crypto.randomUUID(), old = planIncomes.find(i => i.id === id);
      if (!previewDay(input.fields.date)) throw { code: 'DATE', message: '日期须为有效的 YYYY-MM-DD' };
      if (input.fields.date > todayIso) throw { code: 'INCOME_DATE', message: '到账日期不能晚于今天' };
      if ([...(input.fields.notes ?? '')].length > 500) throw { code: 'INCOME_NOTES', message: '备注最多 500 字，且不能含空字符' };
      const next: Income = { id, fields: input.fields, revision: (old?.revision ?? 0) + 1, classification_changed: old?.classification_changed === true || !!old && (old.fields.category ?? 'unclassified') !== (input.fields.category ?? 'unclassified') };
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
      const lines = [...expenseView(null).lines, { source: 'purchase' as const, id: 'review-unknown', asset_id: null, title: '虚构金额待补的购入', category: null, date: point.date, amount_cents: null, notes: null, plan_id: null }].filter(l => l.date !== null && l.date > from && l.date <= point.date)
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
      const reasons: Reasons = { generation, snapshot_id: point.snapshot_id, from, to: point.date, notes: point.notes, lines };
      return { value: reasons };
    }
    return null;
  }
  if (!command.startsWith('wealth_') && !command.startsWith('account_group')) return null;
  if (params.get('wealth') === 'error' && command !== 'wealth_request_result') throw { message: '虚构读取失败，用于验证错误状态。' };
  if (command === 'wealth_summary') { if (params.get('wealth') === 'error') throw { message: '虚构盘点读取失败。' }; return { value: summary() }; }
  if (command === 'account_groups_list') {
    if (params.get('groups') === 'error') throw { message: '虚构分组读取失败，请重试' };
    return { value: { generation, groups: accountGroups.map(g => ({ ...g, accounts: accounts.filter(a => a.fields.group_id === g.id).length })) } };
  }
  if (['account_group_save', 'account_group_delete', 'account_groups_reorder'].includes(command)) {
    const input = args.input as GroupSave | GroupDelete | GroupReorder;
    if (input.generation !== generation) throw { code: 'STALE_DATASET', message: '资料库已切换' };
    const fingerprint = JSON.stringify([command, input]), oldReceipt = groupReceipts.get(input.request_id);
    if (oldReceipt) { if (oldReceipt.fingerprint !== fingerprint) throw { code: 'REQUEST_CONFLICT', message: '请求标识已用于不同内容' }; return { value: oldReceipt.value }; }
    if (params.get('state') === 'save-error') throw { message: '虚构分组保存失败，输入已保留' };
    let value: unknown = null;
    if (command === 'account_group_save') {
      const request = input as GroupSave, name = request.name.trim(), old = accountGroups.find(g => g.id === request.id);
      if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) throw { code: 'GROUP_NAME', message: '分组名称须为 1–40 字，不能含控制字符' };
      if (accountGroups.some(g => g.name === name && g.id !== request.id)) throw { code: 'GROUP_NAME', message: '已有同名分组' };
      if ((request.id !== null && !old) || (old?.revision ?? null) !== request.expected_revision) throw { code: 'REVISION_CONFLICT', message: '分组已变化，请重新读取' };
      const next = { id: old?.id ?? crypto.randomUUID(), name, position: old?.position ?? (Math.max(-1, ...accountGroups.map(g => g.position)) + 1), revision: (old?.revision ?? 0) + 1, accounts: old ? accounts.filter(a => a.fields.group_id === old.id).length : 0 };
      accountGroups = old ? accountGroups.map(g => g.id === old.id ? next : g) : [...accountGroups, next]; value = next;
    } else if (command === 'account_group_delete') {
      const request = input as GroupDelete, old = accountGroups.find(g => g.id === request.id), count = accounts.filter(a => a.fields.group_id === request.id).length;
      if (!old || old.revision !== request.expected_revision || count !== request.expected_accounts) throw { code: 'REVISION_CONFLICT', message: '分组或关联账户已变化，请重新读取' };
      accounts = accounts.map(a => a.fields.group_id === request.id ? { ...a, revision: a.revision + 1, fields: { ...a.fields, group_id: null } } : a);
      accountGroups = accountGroups.filter(g => g.id !== request.id);
    } else {
      const request = input as GroupReorder;
      if (new Set(request.ids).size !== request.ids.length || request.ids.length !== accountGroups.length || accountGroups.some(g => !request.ids.includes(g.id))) throw { code: 'GROUP_ORDER', message: '分组列表已变化，请重新读取后排序' };
      accountGroups = request.ids.map((id, position) => { const g = accountGroups.find(g => g.id === id)!; return { ...g, position, revision: g.revision + 1 }; });
    }
    groupReceipts.set(input.request_id, { fingerprint, value }); receipts.set(input.request_id, 'account-groups');
    if (params.get('group-write') === 'unknown') { groupUnknownChecks.add(input.request_id); throw { message: '虚构分组响应丢失，请核对结果' }; }
    if (params.get('state') === 'unresolved') throw { message: '虚构分组响应丢失，请核对结果' };
    return { value };
  }
  if (command === 'wealth_accounts') return { value: accounts.map(withLatest) };
  if (command === 'wealth_request_result') { const request = String(args.request); if (receipts.get(request) === 'account-groups' && groupUnknownChecks.has(request)) { groupUnknownChecks.delete(request); throw { message: '虚构首次分组回执查询暂不可用，原请求保留，请再次核对' }; } if (params.get('state') === 'unresolved' || params.get('quick') === 'unknown') throw { message: '暂时无法核对。' }; return { value: receipts.get(String(args.request)) ?? null }; }
  // 只读详情：按稳定 ID 读取一次盘点（§5.2），浏览不写资料。
  if (command === 'wealth_snapshot') { if (planFail('snapshot')) throw { message: '虚构盘点明细读取失败，用于验证首页摘要的局部降级。' }; const found = snapshots.find(s => s.id === String(args.id)); return { value: found ? view(found) : null }; }
  if (command === 'wealth_snapshot_draft') {
    const date = String(args.date), existing = snapshots.find(s => s.date === date);
    const draft: Draft = { generation, date, existing: existing ? view(existing) : null, rows: accounts.filter(a => due(a, date)).map(a => ({ account: withLatest(a), previous: latestBefore(a.id, date) })) };
    const rate_suggestions: Record<string,{rate:string;date:string}> = {};
    for(const a of accounts){const code=currencyCode(a.fields.currency);if(code==='CNY')continue;const saved=existing?.entries.find(e=>e.account_id===a.id&&e.fx_rate_micro!=null),previous=latestBefore(a.id,date);const source=saved?{...saved,date}:previous;if(source?.fx_rate_micro&&(!rate_suggestions[code]||source.date>rate_suggestions[code].date))rate_suggestions[code]={rate:source.fx_rate_micro,date:source.date};}
    return { value: { ...draft, rate_suggestions } };
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
      return { snapshot_id: s.id, date: s.date, state: e.state, amount_cents: e.amount_cents, ...(e.original_minor!=null?{original_minor:e.original_minor,fx_rate_micro:e.fx_rate_micro}:{}),...(e.quantity_e8!=null?{quantity_e8:e.quantity_e8,unit_price_e6:e.unit_price_e6}:{}), counted: e.counted, change_cents: null };
    });
    // 与前次＝紧邻的前一行，两行都已知才有值，不跨过未知去找更早的值。
    for (let i = 1; i < rows.length; i++) { const p = rows[i - 1], c = rows[i]; if (p.amount_cents !== null && c.amount_cents !== null) c.change_cents = (BigInt(c.amount_cents) - BigInt(p.amount_cents)).toString(); }
    return { value: { generation, account: withLatest(a), rows } };
  }
  if (params.get('state') === 'save-error') throw { message: '模拟保存失败，输入应保留。' };
  if (command === 'wealth_account_save') {
    const input = args.input as AccountSave;
    if (receipts.has(input.request_id)) return { value: withLatest(accounts.find(a => a.id === receipts.get(input.request_id))!) };
    if (input.fields.kind === 'property' && input.fields.counted) throw { code: 'PROPERTY_COUNTED', message: '房产仅单独记录估值，不能计入金融净资产' };
    if (input.fields.group_id && !accountGroups.some(g => g.id === input.fields.group_id)) throw { code: 'GROUP_NOT_FOUND', message: '分组已删除，请重新选择' };
    const id = input.id ?? crypto.randomUUID(), old = accounts.find(a => a.id === id);
    const f = input.fields;
    if((f.holding_mode&&!holdingSupported(f.kind))||(!f.holding_mode&&f.holding_unit!=null)||(f.holding_unit!=null&&(!f.holding_unit.trim()||[...f.holding_unit].length>8||/[\u0000-\u001f\u007f-\u009f]/.test(f.holding_unit))))throw {code:'ACCOUNT_HOLDING',message:'仅投资类账户可按持仓记录，单位须为1–8字'};
    if(!validCurrency(currencyCode(f.currency)))throw {code:'ACCOUNT_CURRENCY',message:'币种须为三位大写字母'};
    if(old&&currencyCode(old.fields.currency)!==currencyCode(f.currency)&&snapshots.some(s=>s.entries.some(e=>e.account_id===old.id)))throw {code:'ACCOUNT_CURRENCY',message:'已有记录的账户不能更改币种，请新建一个外币账户，再停用旧账户。'};
    if (old && !['property','vehicle'].includes(f.kind) && (old.fields.purchase_cents != null || old.fields.purchased_on != null)) throw { code: 'ACCOUNT_PURCHASE', message: '请先清空并保存购入价和购入日期，再更改类型' };
    if ((f.purchase_cents != null || f.purchased_on != null) && !['property','vehicle'].includes(f.kind)) throw { code: 'ACCOUNT_PURCHASE', message: '只有房产和车辆可以填写购入价和购入日期' };
    if (f.purchase_cents != null && (!/^\d+$/.test(f.purchase_cents) || BigInt(f.purchase_cents) > 99999999999n)) throw { code: 'ACCOUNT_PURCHASE', message: '购入价超出可保存的金额范围' };
    if (f.purchased_on != null && (!/^\d{4}-\d{2}-\d{2}$/.test(f.purchased_on) || Number.isNaN(Date.parse(f.purchased_on)) || new Date(f.purchased_on).toISOString().slice(0,10) !== f.purchased_on || f.purchased_on < '1900-01-01' || f.purchased_on > iso(now))) throw { code: 'ACCOUNT_PURCHASE', message: '购入日期须在 1900-01-01 至今天之间' };
    const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day && day >= '1900-01-01';
    if (!validDay(f.opened_on)) throw { code: 'ACCOUNT_DATE', message: '启用日期须为 1900-01-01 之后的有效日期' };
    if (f.opened_on > iso(now)) throw { code: 'ACCOUNT_DATE', message: '启用日期不能晚于今天' };
    if (f.closed_on != null) {
      if (!validDay(f.closed_on)) throw { code: 'ACCOUNT_DATE', message: '停用日期须为有效日期' };
      if (f.closed_on > iso(now)) throw { code: 'ACCOUNT_DATE', message: '停用日期不能晚于今天' };
      if (f.closed_on <= f.opened_on) throw { code: 'ACCOUNT_DATE', message: '停用日期须晚于启用日期' };
    }
    const next: Account = { id, fields: input.fields, position: old?.position ?? accounts.length, revision: (old?.revision ?? 0) + 1, latest: null };
    accounts = old ? accounts.map(a => a.id === id ? next : a) : [...accounts, next];
    receipts.set(input.request_id, id);
    return { value: withLatest(next) };
  }
  if (command === 'wealth_quick_update') {
    const input = args.input as import('./wealth').QuickUpdate;
    if (input.generation !== generation) throw { code: 'STALE_DATASET', message: '资料库已切换。' };
    const fingerprint = JSON.stringify(input);
    if (receipts.has(input.request_id)) {
      if (quickFingerprints.get(input.request_id) !== fingerprint) throw { code: 'REQUEST_CONFLICT', message: '请求标识已用于不同内容。' };
      return { value: view(snapshots.find(s => s.id === receipts.get(input.request_id))!) };
    }
    const fail = (code: string, message: string): never => { throw { code, message }; };
    const today = iso(now), latest = snapshots.map(s => s.date).sort().at(-1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < '1900-01-01' || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date) fail('DATE', '日期格式应为 YYYY-MM-DD');
    if (input.date > today) fail('SNAPSHOT_DATE', '盘点日期不能晚于今天');
    if (latest && input.date < latest) fail('QUICK_DATE', '历史金额请到盘点记录里更正');
    if ([...input.note].length > 500 || input.note.includes('\0')) fail('QUICK_NOTE', '备注最多 500 字，且不能含空字符');
    if (input.changes.length < 1 || input.changes.length > 2) fail('QUICK_CHANGES', '一次只能更新一个账户或一笔转账');
    const existing = snapshots.find(s => s.date === input.date), active = accounts.filter(a => due(a, input.date));
    const changed = new Map<string, import('./wealth').QuickChange>(); let effect = 0n;
    if(input.changes.length===2){const [a,b]=input.changes,ac=accounts.find(x=>x.id===a.account_id),bc=accounts.find(x=>x.id===b.account_id);if(ac?.fields.holding_mode||bc?.fields.holding_mode)fail('QUICK_HOLDING','持仓账户请用增减持仓');if(currencyCode(ac?.fields.currency)!==currencyCode(bc?.fields.currency)||(currencyCode(ac?.fields.currency)!=='CNY'&&a.fx_rate_micro!==b.fx_rate_micro))fail('QUICK_CURRENCY','转账须相同币种和汇率，请分别修改余额');}
    const parse = (value: string) => {
      if (typeof value !== 'string' || !/^\d{1,11}$/.test(value) || BigInt(value) > 99999999999n) fail('WEALTH_AMOUNT', '金额须为非负整数分');
      return BigInt(value);
    };
    for (const change of input.changes) {
      const account = active.find(a => a.id === change.account_id);
      if (!account || changed.has(change.account_id)) fail('SNAPSHOT_ACCOUNT', '这个账户不在该日期的盘点范围内，或重复填写');
      const next = parse(change.amount_cents), kept = existing?.entries.find(e => e.account_id === change.account_id);
      const previous = kept ? kept.amount_cents : latestBefore(change.account_id, input.date)?.amount_cents ?? null;
      try { validateCurrencyFact(currencyCode(account!.fields.currency),change); } catch { fail('FX_MISMATCH','原币金额与汇率折算不一致'); }
      const original=kept?kept.original_minor:latestBefore(change.account_id,input.date)?.original_minor;
      if(currencyCode(account!.fields.currency)==='CNY'&&change.expected_original_minor!=null)fail('FX_MISMATCH','人民币账户不能填写原币金额');
      if(currencyCode(account!.fields.currency)!=='CNY'&&change.expected_previous!=null&&(change.expected_original_minor==null||change.expected_original_minor!==original))fail('QUICK_STALE','原币金额已经变化，请重新读取');
      const previousFact=kept??latestBefore(change.account_id,input.date);
      if(account!.fields.holding_mode||change.quantity_e8!=null||change.unit_price_e6!=null){
        if(!sameHoldingFact(kept,change)&&!!account!.fields.holding_mode!==(change.quantity_e8!=null))fail('HOLDING_MISMATCH','请按当前录入方式填写');
        try{validateHoldingFact(currencyCode(account!.fields.currency),change);}catch{fail('HOLDING_MISMATCH','份额与单价不一致');}
      }
      if(account!.fields.holding_mode&&change.expected_previous!=null&&(change.expected_quantity_e8==null||change.expected_quantity_e8!==previousFact?.quantity_e8))fail('QUICK_STALE','份额已经变化，请重新读取');
      const expected = change.expected_previous == null ? null : parse(change.expected_previous);
      if (input.changes.length === 2 && expected === null) fail('QUICK_TRANSFER', '转账须基于两个账户的已知金额');
      if (expected !== null && (previous === null || BigInt(previous) !== expected)) fail('QUICK_STALE', '账户金额已经变化，请重新读取');
      if (params.get('quick') === 'stale' && expected !== null && !quickStaleShown) { quickStaleShown = true; fail('QUICK_STALE', '虚构账户金额已经变化，请重新读取'); }
      effect += (next - BigInt(previous ?? '0')) * (account!.fields.side === 'asset' ? 1n : -1n);
      changed.set(change.account_id,change);
    }
    if (input.changes.length === 2 && effect !== 0n) fail('QUICK_TRANSFER', '折算或舍入使人民币变化无法抵消，请分别修改余额');
    const entries: Entry[] = active.map(account => {
      const kept = existing?.entries.find(e => e.account_id === account.id), previous = latestBefore(account.id, input.date);
      if (changed.has(account.id)) return { ...(changed.get(account.id)!.quantity_e8!=null?{quantity_e8:changed.get(account.id)!.quantity_e8,unit_price_e6:changed.get(account.id)!.unit_price_e6}:{}), ...(changed.get(account.id)!.original_minor!=null?{original_minor:changed.get(account.id)!.original_minor,fx_rate_micro:changed.get(account.id)!.fx_rate_micro}:{}), account_id: account.id, state: 'entered', amount_cents: changed.get(account.id)!.amount_cents, side: kept?.side ?? account.fields.side, kind: kept?.kind ?? account.fields.kind, counted: kept?.counted ?? account.fields.counted };
      if (kept) return { ...kept };
      return { account_id: account.id, state: previous ? 'unchanged' : 'missing', amount_cents: previous?.amount_cents ?? null, ...(previous?.original_minor!=null?{original_minor:previous.original_minor,fx_rate_micro:previous.fx_rate_micro}:{}),...(previous?.quantity_e8!=null?{quantity_e8:previous.quantity_e8,unit_price_e6:previous.unit_price_e6}:{}), side: account.fields.side, kind: account.fields.kind, counted: account.fields.counted };
    });
    const extra = input.note.trim() ? input.changes.map(change => active.find(a => a.id === change.account_id)!.fields.name).join(' → ') + '：' + input.note.trim() : '';
    const stored: Stored = { id: existing?.id ?? crypto.randomUUID(), date: input.date, notes: [existing?.notes ?? '', extra].filter(Boolean).join('\n'), revision: (existing?.revision ?? 0) + 1, entries };
    snapshots = existing ? snapshots.map(s => s.id === stored.id ? stored : s) : [...snapshots, stored];
    receipts.set(input.request_id, stored.id); quickFingerprints.set(input.request_id, fingerprint);
    if (params.get('quick') === 'unknown') throw { message: '虚构保存响应丢失，原请求已保留。' };
    return { value: view(stored) };
  }
  if (command === 'wealth_snapshot_save') {
    const input = args.input as SnapshotSave;
    if (receipts.has(input.request_id)) return { value: view(snapshots.find(s => s.id === receipts.get(input.request_id))!) };
    if (snapshots.some(s => s.date === input.date && s.id !== input.id)) throw { code: 'SNAPSHOT_DATE_TAKEN', message: '这一天已有盘点，请打开原盘点更正' };
    for (const c of input.close_accounts ?? []) {
      const acc = accounts.find(x => x.id === c.account_id);
      if (!acc) throw { code: 'NOT_FOUND', message: '要停用的账户已不存在，请重新读取' };
      if (acc.revision !== c.expected_revision) throw { code: 'REVISION_CONFLICT', message: '账户已变化，请重新读取' };
      if (input.entries.some(e => e.account_id === acc.id)) throw { code: 'SNAPSHOT_ACCOUNT', message: '停用的账户不能同时填写金额' };
      if (snapshots.some(s => s.entries.some(e => e.account_id === acc.id) && s.date >= input.date)) throw { code: 'ACCOUNT_DATE', message: '该账户在这一天或之后已有盘点记录，不能从这次起停用' };
    }
    accounts = accounts.map(a => (input.close_accounts ?? []).some(c => c.account_id === a.id) ? { ...a, revision: a.revision + 1, fields: { ...a.fields, closed_on: input.date } } : a);
    const id = input.id ?? crypto.randomUUID(), old = snapshots.find(s => s.id === id);
    const entries = input.entries.map(e => {
      const a = accounts.find(x => x.id === e.account_id)!, kept = old?.entries.find(x => x.account_id === e.account_id);
      const cents = e.state === 'missing' ? null : e.state === 'unchanged' ? kept?.state === 'unchanged' && e.amount_cents === null ? kept.amount_cents : e.amount_cents ?? latestBefore(a.id, input.date)?.amount_cents ?? null : e.amount_cents;
      const source=e.state==='unchanged'?(kept?.state==='unchanged'&&e.amount_cents===null?kept:latestBefore(a.id,input.date)):e;
      const fx=source?.original_minor!=null?{original_minor:source.original_minor,fx_rate_micro:source.fx_rate_micro}:{};
      const holdingFields=source?.quantity_e8!=null?{quantity_e8:source.quantity_e8,unit_price_e6:source.unit_price_e6}:{};
      if(a.fields.holding_mode||e.quantity_e8!=null||e.unit_price_e6!=null||source?.quantity_e8!=null){
        if(e.state==='entered'&&!sameHoldingFact(kept,e)&&!!a.fields.holding_mode!==(e.quantity_e8!=null))throw {code:'HOLDING_MISMATCH',message:'请按当前录入方式填写'};
        if(e.state==='unchanged'&&((e.quantity_e8!=null&&e.quantity_e8!==source?.quantity_e8)||(e.unit_price_e6!=null&&e.unit_price_e6!==source?.unit_price_e6)))throw {code:'HOLDING_MISMATCH',message:'沿用须保留份额和单价'};
        try{validateHoldingFact(currencyCode(a.fields.currency),{amount_cents:cents,...fx,...holdingFields});}catch{throw {code:'HOLDING_MISMATCH',message:'份额与单价不一致'};}
      }
      if(e.state==='unchanged'&&((e.original_minor!=null&&e.original_minor!==source?.original_minor)||(e.fx_rate_micro!=null&&e.fx_rate_micro!==source?.fx_rate_micro)))throw {code:'FX_MISMATCH',message:'沿用须保留原币金额和汇率'};
      try { validateCurrencyFact(currencyCode(a.fields.currency),{amount_cents:cents,...fx}); } catch { throw {code:'FX_MISMATCH',message:'原币金额与汇率折算不一致'}; }
      return { ...fx, ...holdingFields, account_id: a.id, state: e.state, amount_cents: cents, side: kept?.side ?? a.fields.side, kind: kept?.kind ?? a.fields.kind, counted: kept?.counted ?? a.fields.counted };
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

// ---- 手机心愿预览（只加不改）：?wish-fixture=mobile 给出一组覆盖各状态的虚构心愿；写入命令在内存里生效，刷新重置。
// ?mobile-state=save-error 让心愿写入失败（输入保留）；?mobile-state=unknown 让第一次心愿写入已生效但回执丢失、第一次核对也失败。
if (params.get('wish-fixture') === 'mobile') {
  const day = (offset: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
  const made = (id: string, name: string, cents: string | null, added: string, notes: string, part: Partial<PreviewWish> & { prefs?: Partial<NonNullable<PreviewWish['preferences']>>; target?: string; category?: string | null } = {}): PreviewWish => {
    const base = wishFixture(id, name, cents, added + 'T09:00:00.000Z');
    const { prefs, target, category, ...rest } = part;
    return { ...base, ...rest, fields: { ...base.fields, notes, target_date: target ?? '', category_id: category ?? null }, preferences: { added_date: added, channel_id: null, mode: null, saved_cents: '0', achievement_source: null, pinned: false, reminder: false, ...prefs } };
  };
  wishes = [
    made('wish-tent', '露营帐篷', null, day(-18), '周末想和朋友去郊外露营，先看看口碑和重量', { category: 'outdoor', cover: { id: 'object3d-tent', name: '露营帐篷示意图（非实物照片）' } }),
    made('wish-vacuum', '戴森吸尘器', '399000', day(-49), '现在这台吸力变弱，电池只能用 10 分钟，拖线又不方便。想要能吸地毯、还能吸床垫的。\n顾虑：价格偏高；集尘桶容量小，家里有宠物毛发要常倒。等 11 月促销再看。', { category: 'home', cover: { id: 'icon-robot-vacuum', name: '吸尘器示意图（非实物照片）' }, target: day(21), external_link: 'https://dyson.example.cn/vacuum' as never, replacement_asset: { id: 'coffee', name: '家里的咖啡机', deleted: false }, prefs: { reminder: true } } as never),
    made('wish-grinder', '咖啡磨豆机', '131200', day(-62), '手冲用，想要研磨更均匀的', { category: 'home' }),
    made('wish-monitor', '4K 显示器', '429900', day(-95), '写稿和修图时屏幕太小，色准也不够', { category: 'computer', cover: { id: 'icon-monitor', name: '显示器示意图（非实物照片）' }, target: day(-20) }),
    made('wish-lens-fe', '索尼 FE 24-70 镜头', '899900', day(-144), '等相机用满一年后再决定要不要加镜头', { category: 'audio', cover: { id: 'icon-lens', name: '相机镜头示意图（非实物照片）' }, target: day(120), prefs: { pinned: true } }),
    made('wish-projector', '便携投影仪', '259900', day(-243), '客厅没有电视，想在墙上看电影', { category: 'computer', cover: { id: 'icon-projector', name: '投影仪示意图（非实物照片）' }, decision_state: 'purchased', status: 'achieved', converted_asset: { id: 'tablet', name: 'iPad Air 4', deleted: false }, target: day(-190) } as never),
    made('wish-watch', '智能手表', '199900', day(-285), '试戴后发现不常戴，记步用手机就够了', { category: 'phone', cover: { id: 'icon-watch', name: '手表示意图（非实物照片）' }, decision_state: 'dropped', status: 'abandoned', decision_note: '试戴后发现不常戴，记步用手机就够了。' } as never),
    made('wish-old', '旧版显示器（历史待核实）', '300000', day(-300), '旧攒钱达标，购入情况尚未确认', { decision_state: 'legacy_achieved', status: 'achieved', prefs: { mode: 'savings', saved_cents: '300000', achievement_source: 'savings' } } as never),
  ];
}
const wishReceipts = new Map<string, WishlistItem>();
let wishLost = false, wishCheckFailed = false;
const wishError = (code: string, message: string) => ({ code, message });
function wishWrite(requestId: string, input: { generation?: string }, change: (found: PreviewWish | undefined) => PreviewWish | void, id: string | null, revision: number | null, lose = true): PreviewWish {
  if (params.get('mobile-state') === 'save-error') throw wishError('PREVIEW_ERROR', '虚构保存失败，请核对输入后重试。');
  if (input.generation && input.generation !== generation) throw wishError('STALE_DATASET', '资料已切换。');
  const previous = wishReceipts.get(requestId);
  if (previous) return structuredClone(previous) as PreviewWish;
  const found = id ? wishes.find(w => w.id === id) : undefined;
  if (id && !found) throw wishError('NOT_FOUND', '找不到这条心愿。');
  if (found && revision !== null && found.revision !== revision) throw wishError('REVISION_CONFLICT', '心愿已变化，请返回重新读取。');
  const next = (change(found) ?? found) as PreviewWish;
  next.revision = (found?.revision ?? 0) + 1; next.updated_at = new Date().toISOString();
  wishes = found ? wishes.map(w => w.id === next.id ? next : w) : [next, ...wishes];
  wishReceipts.set(requestId, structuredClone(next));
  if (lose && params.get('mobile-state') === 'unknown' && !wishLost) { wishLost = true; throw new Error('虚构保存响应丢失。'); }
  return structuredClone(next);
}
function wishCheck(requestId: string): WishlistItem | null {
  if (params.get('mobile-state') === 'unknown' && wishLost && !wishCheckFailed) { wishCheckFailed = true; throw new Error('虚构回执暂不可用。'); }
  const saved = wishReceipts.get(requestId);
  return saved ? structuredClone(saved) : null;
}
/** 购入转换：物品已由 save_asset 的预览处理创建，这里把心愿记为已购入并关联。 */
export function previewMarkWishPurchased(wishlistId: string, expectedRevision: number, asset: { id: string; name: string }, requestId: string): void {
  wishWrite('convert:' + requestId, {}, found => { if (!found) return; return { ...found, decision_state: 'purchased', status: 'achieved', achieved_at: new Date().toISOString(), converted_asset: { id: asset.id, name: asset.name, deleted: false } }; }, wishlistId, expectedRevision, false);
}
export function previewWishCommand(command: string, args: Record<string, unknown>): { value: unknown } | null {
  const input = args.input as Record<string, any> | undefined;
  if (command === 'saved_wishlist_request') return { value: wishCheck((input as { request_id: string }).request_id) };
  if (command === 'saved_wish_feature') return { value: wishCheck(String(args.request)) };
  if (command === 'stage_wishlist_cover') return { value: wishes.find(w => w.id === args.wishlistId)?.cover ?? { id: 'staged-' + String(args.wishlistId), name: '心愿封面' } };
  if (command === 'change_wishlist') {
    const action = input!.action as { type: string; wishlist_id: string; decision_note: string };
    return { value: wishWrite(input!.request_id, input!, found => found && ({ ...found, decision_state: action.type === 'drop' ? 'dropped' : 'considering', status: action.type === 'drop' ? 'abandoned' : 'ongoing', decision_note: action.decision_note, abandoned_at: action.type === 'drop' ? new Date().toISOString() : null }), action.wishlist_id, input!.expected_revision) };
  }
  if (command === 'link_wish_asset') {
    const name = demoAssets.find(a => a.key === input!.asset_id)?.name ?? String(input!.asset_id);
    return { value: wishWrite(input!.request_id, input!, found => found && ({ ...found, decision_state: 'purchased', status: 'achieved', achieved_at: new Date().toISOString(), converted_asset: { id: input!.asset_id, name, deleted: false } }), input!.wishlist_id, input!.expected_revision) };
  }
  if (command === 'verify_legacy_wish') {
    const outcome = input!.outcome as 'purchased' | 'considering' | 'dropped';
    return { value: wishWrite(input!.request_id, input!, found => found && ({ ...found, decision_state: outcome, status: outcome === 'purchased' ? 'achieved' : outcome === 'dropped' ? 'abandoned' : 'ongoing', decision_note: input!.decision_note }), input!.wishlist_id, input!.expected_revision) };
  }
  if (command === 'save_wish_plan') {
    const fields = input!.fields as PreviewWish['fields'];
    const photos = (input!.photos as { ids: string[]; cover_id: string | null }), named = (id: string) => ({ id, name: id.startsWith('icon-') ? '图标示意图（非实物照片）' : '图片 ' + id.slice(0, 4) });
    return { value: wishWrite(input!.request_id, input!, found => ({
      ...(found ?? wishFixture(crypto.randomUUID(), fields.name, fields.estimated_price_cents, new Date().toISOString())),
      fields: { ...fields, priority: null, target_date: fields.target_date ?? '' }, preferences: input!.preferences, photos: photos.ids.map(named), cover: photos.cover_id ? named(photos.cover_id) : null,
      replacement_asset: input!.replacement_asset_id ? { id: input!.replacement_asset_id, name: demoAssets.find(a => a.key === input!.replacement_asset_id)?.name ?? String(input!.replacement_asset_id), deleted: false } : input!.replacement_asset_id === null && input!.clear_replacement ? null : found?.replacement_asset,
    }), input!.id, input!.expected_revision) };
  }
  if (command === 'wealth_trash' && input!.kind === 'wish') {
    const found = wishes.find(w => w.id === input!.id);
    if (!found) throw wishError('NOT_FOUND', '找不到这条心愿。');
    if (found.revision !== input!.expected_revision) throw wishError('REVISION_CONFLICT', '心愿已变化，请返回重新读取。');
    wishes = wishes.filter(w => w.id !== input!.id); receipts.set(input!.request_id, input!.id);
    return { value: null };
  }
  return null;
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
  if (target.kind === 'income') { if (!previewModules.incomes || !planIncomes.some(i=>i.id===target.id)) fail(); return; }
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
