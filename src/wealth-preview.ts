// Development-only in-memory stand-in for the wealth commands used by
// visual-preview. It mirrors the Rust rules loosely for demo purposes and
// proves nothing about native storage or calculation.
import type { Account, AccountSave, Draft, Entry, Point, Share, Snapshot, SnapshotSave, Summary } from './wealth';

const generation = 'visual-fixture-only';
const params = new URLSearchParams(location.search);
const now = new Date();
const monthsAgo = (n: number) => { const d = new Date(now.getFullYear(), now.getMonth() - n + 1, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const account = (id: string, name: string, institution: string, side: 'asset' | 'liability', kind: string, position: number, counted = true): Account =>
  ({ id, fields: { name, institution, side, kind, counted, opened_on: '2025-01-01', closed_on: null, notes: '' }, position, revision: 1, latest: null });
let accounts: Account[] = [
  account('w-cash', '虚构储蓄卡', '虚构银行', 'asset', 'cash', 0),
  account('w-broker', '虚构证券账户', '虚构券商', 'asset', 'mixed', 1),
  account('w-fund', '虚构公积金', '公积金中心', 'asset', 'housing_fund', 2),
  account('w-card', '虚构信用卡', '虚构银行', 'liability', 'credit_card', 3),
  account('w-loan', '虚构房贷', '虚构银行', 'liability', 'loan', 4, false),
];
type Stored = { id: string; date: string; notes: string; revision: number; entries: Entry[] };
const entry = (a: Account, yuan: number | null): Entry => ({ account_id: a.id, state: yuan === null ? 'missing' : 'entered', amount_cents: yuan === null ? null : String(yuan * 100), side: a.fields.side, kind: a.fields.kind, counted: a.fields.counted });
const [cash, broker, fund, card, loan] = accounts;
let snapshots: Stored[] = [
  [5, 82_000, 180_000, 46_000, 6_200, 820_000], [4, 88_500, 176_500, 47_800, 4_100, 816_000],
  [2, 93_000, 191_000, 51_400, 7_800, 808_000], [1, 97_200, null, 53_200, 3_900, 804_000],
].map(([ago, ...v], i) => ({ id: `w-snap-${i}`, date: monthsAgo(ago as number), notes: '', revision: 1, entries: [entry(cash, v[0]), entry(broker, v[1]), entry(fund, v[2]), entry(card, v[3]), entry(loan, v[4])] }));
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

export function wealthPreview(command: string, args: Record<string, unknown>): { value: unknown } | null {
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
