// 规划假设与资金流动的独立组件预览。驱动是纯内存的虚构端口实现：只在预览／测试使用，
// 不进入普通应用保存路径，也不声称真实保存或重新计算损益——previewReview 的 result
// 永远回显固定夹具结果。状态由 ?state= 切换；&theme=dark 切换主题。
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AssumptionReadV1, FollowupRead, FollowupWriteResult, MovementFieldsV1, MovementPageV1, MovementQueryV1,
  MovementRecordV1, MovementSourceOptionV1, PlanningFollowupPortV1, ReviewDraftV1, ReviewPairV1, ReviewPreviewV1, SourcePageV1, SourceQueryV1,
} from '../../planning-followup-contract.ts';
import { AssumptionsEditor } from '../AssumptionsEditor.tsx';
import { FollowupSection } from '../FollowupSection.tsx';
import '../../theme.css';
import '../planning-followup-ui.css';
import './preview.css';

const GENERATION = 'preview-generation';
const states = ['normal', 'no-accounts', 'no-pair', 'disabled', 'read-error', 'needs-review', 'conflict', 'unresolved'] as const;
type State = typeof states[number];

const pair: ReviewPairV1 = { from_snapshot_id: 'fx-start', to_snapshot_id: 'fx-end' };
const accounts = [
  { id: 'fx-inv', name: '虚构券商投资账户', kind: 'investment', selectable: true },
  { id: 'fx-cash', name: '虚构现金账户', kind: 'cash', selectable: true },
  { id: 'fx-old', name: '虚构已停用账户', kind: 'mixed', selectable: false },
];
const movements: MovementRecordV1[] = [
  { id: 'fx-transfer', revision: 1, deleted: false, fields: { date: '2026-10-15', amount_cents: '800000', from: { kind: 'account', account_id: 'fx-inv' }, to: { kind: 'account', account_id: 'fx-cash' }, purpose: 'own_transfer', source: null, notes: '虚构：取回资金，是否消费未记录' }, source_status: 'unlinked' },
  { id: 'fx-funding', revision: 1, deleted: false, fields: { date: '2026-10-02', amount_cents: '1000000', from: { kind: 'external', label: '虚构工资结余转入' }, to: { kind: 'account', account_id: 'fx-inv' }, purpose: 'external_funding', source: null, notes: '虚构：外部投入本金' }, source_status: 'unlinked' },
  { id: 'fx-living', revision: 1, deleted: false, fields: { date: '2026-10-20', amount_cents: '50000', from: { kind: 'account', account_id: 'fx-inv' }, to: { kind: 'external', label: '虚构房租' }, purpose: 'living_payment', source: null, notes: '虚构：直接从投资账户支付生活费' }, source_status: 'unlinked' },
  { id: 'fx-dividend', revision: 2, deleted: false, fields: { date: '2026-10-25', amount_cents: '30000', from: { kind: 'account', account_id: 'fx-inv' }, to: { kind: 'account', account_id: 'fx-cash' }, purpose: 'income_distribution', source: { kind: 'income', key: 'fx-income-key-1' }, notes: '虚构：分红转出，已关联收入记录' }, source_status: 'matched' },
  { id: 'fx-deleted', revision: 1, deleted: true, fields: { date: '2026-09-30', amount_cents: '200000', from: { kind: 'account', account_id: 'fx-cash' }, to: { kind: 'account', account_id: 'fx-inv' }, purpose: 'own_transfer', source: null, notes: '虚构：误记后删除' }, source_status: 'unlinked' },
];
const sourceOptions: Record<'income' | 'expense', MovementSourceOptionV1[]> = {
  income: [
    { ref: { kind: 'income', key: 'fx-income-key-1' }, label: '虚构现金分红入账', date: '2026-10-25', amount_cents: '30000', available: true, unavailable_reason: null },
    { ref: { kind: 'income', key: 'fx-income-key-2' }, label: '虚构利息入账', date: '2026-10-05', amount_cents: '12000', available: false, unavailable_reason: '已关联其他资金流动' },
  ],
  expense: [{ ref: { kind: 'expense', key: 'fx-expense-key-1' }, label: '虚构年度保险费', date: '2026-10-12', amount_cents: '360000', available: true, unavailable_reason: null }],
};
const assumptions: AssumptionReadV1 = {
  generation: GENERATION, revision: 2,
  values: { real_return_before_hundredths: 100, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 },
  confirmation: 'confirmed', confirmed_values: { real_return_before_hundredths: 100, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 },
};
const savedDraft: ReviewDraftV1 = { selection: { mode: 'manual', inflow_cents: '1000000', outflow_cents: '800000' }, confirmed_complete: false, unsupported_movements: false, notes: '虚构：手填合计' };

/** 虚构内存端口：脚本化各方法返回，仅供本预览页使用。 */
function fictionalPort(state: State): PlanningFollowupPortV1 {
  const write = (): FollowupWriteResult =>
    state === 'conflict' ? { status: 'rejected', issues: [{ path: '', code: 'revision_conflict', message: '虚构：记录已变化，请重新读取。' }] }
      : state === 'unresolved' ? { status: 'unresolved', request_id: 'fx-original-request' }
        : { status: 'saved', id: 'fx-saved-record', revision: 2 };
  const read = <T,>(value: T): FollowupRead<T> =>
    state === 'disabled' ? { status: 'disabled', message: '虚构：规划模块已关闭，资金流动与假设暂不可用。' }
      : state === 'read-error' ? { status: 'error', code: 'FICTIONAL_READ_ERROR', message: '虚构：读取失败样例。' }
        : { status: 'ready', value };
  /** 虚构预览：result 固定回显夹具（余额 −300000、损益 +5000），totals 只回显草稿数字，绝不重算损益。 */
  const previewOf = (draft: ReviewDraftV1, needsReview: boolean): ReviewPreviewV1 => ({
    generation: GENERATION, pair, review_id: 'fx-review', revision: 1,
    input: {
      contract_version: 1,
      from: { snapshot_id: 'fx-start', revision: 1, date: '2026-09-30', members: [{ account_id: 'fx-inv', kind: 'investment', counted: true, amount_cents: '10000000' }] },
      to: { snapshot_id: 'fx-end', revision: 1, date: '2026-10-31', members: [{ account_id: 'fx-inv', kind: 'investment', counted: true, amount_cents: '9700000' }] },
      flow: null, overlapping_active_flow_ids: [],
    },
    result: needsReview ? { status: 'needs_review', reasons: ['stale_endpoints'], change_cents: '-300000' }
      : { status: 'ready', value: { opening_cents: '10000000', closing_cents: '9700000', change_cents: '-300000', inflow_cents: '0', outflow_cents: '800000', profit_cents: '500000' } },
    saved_mode: 'manual', selected: draft.selection,
    previous_totals: null,
    selected_totals: draft.selection.mode === 'manual' ? { inflow_cents: draft.selection.inflow_cents, outflow_cents: draft.selection.outflow_cents } : { inflow_cents: '1000000', outflow_cents: '800000' },
    difference: { inflow_cents: null, outflow_cents: null },
    movement_count: draft.selection.mode === 'movements' ? 2 : 0,
    confirmation: needsReview ? 'needs_review' : 'unconfirmed',
    reasons: needsReview ? [{ path: 'movements', code: 'stale_movements', message: '虚构：相关流动已更正，请重新核对' }] : [],
    basis_key: 'fx-preview-only-not-a-domain-key',
  });
  const needsReview = state === 'needs-review';
  return {
    async readAssumptions() { return read({ ...assumptions, confirmation: needsReview ? 'needs_review' : assumptions.confirmation }); },
    async saveAssumptions(_values, _confirm, _context) { return write(); },
    async listAccounts() { return read({ generation: GENERATION, accounts: state === 'no-accounts' ? [] : accounts }); },
    async listMovements(query: MovementQueryV1, generation: string): Promise<FollowupRead<MovementPageV1>> {
      if (state === 'disabled' || state === 'read-error') return read<MovementPageV1>({ generation, records: [], next_cursor: null });
      const active = movements.filter(m => query.deleted === 'all' || m.deleted === (query.deleted === 'deleted'))
        .filter(m => !query.account_id || m.fields.from.kind === 'account' && m.fields.from.account_id === query.account_id || m.fields.to.kind === 'account' && m.fields.to.account_id === query.account_id)
        .filter(m => (!query.from_date || m.fields.date >= query.from_date) && (!query.to_date || m.fields.date <= query.to_date));
      const start = query.cursor === 'page-2' ? 3 : 0, slice = active.slice(start, start + 3);
      return read({ generation, records: slice, next_cursor: start + 3 < active.length ? 'page-2' : null });
    },
    async listSources(query: SourceQueryV1, generation: string): Promise<FollowupRead<SourcePageV1>> {
      return read({ generation, options: sourceOptions[query.kind].filter(o => o.label.includes(query.text)), next_cursor: null });
    },
    async saveMovement(_id, fields: MovementFieldsV1, _context) { movements.push({ id: 'fx-new', revision: 1, deleted: false, fields, source_status: fields.source ? 'matched' : 'unlinked' }); return write(); },
    async setMovementDeleted(id, deleted, _context) { const m = movements.find(x => x.id === id); if (m) { m.deleted = deleted; m.revision += 1; } return write(); },
    async readReview(_pair, generation) { return read({ draft: savedDraft, preview: { ...previewOf(savedDraft, needsReview), generation } }); },
    async listReviews(generation) { return read({ generation, records: [{ id: 'fx-review', revision: 1, deleted: false, pair, from_date: '2026-09-30', to_date: '2026-10-31', mode: 'manual', confirmation: 'unconfirmed' }] }); },
    async setReviewDeleted(_id, _deleted, _context) { return write(); },
    async previewReview(_pair: ReviewPairV1, draft: ReviewDraftV1, generation: string) { return read({ ...previewOf(draft, needsReview), generation }); },
    async saveReview(_pair, _draft, _basis, _context) { return write(); },
    async resolve(_context) { return { status: 'saved', id: 'fx-review', revision: 2 }; },
  };
}

function App() {
  const query = new URLSearchParams(location.search);
  const state = (query.get('state') ?? 'normal') as State;
  const [writeVersion, setWriteVersion] = useState(0);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  document.documentElement.dataset.mode = query.get('theme') === 'dark' ? 'dark' : 'light';
  const port = useMemo(() => fictionalPort(states.includes(state) ? state : 'normal'), [state]);
  const pairOrNull = state === 'no-pair' ? null : pair;
  return <main className="pfu-preview">
    <h1>规划假设与资金流动 · 独立组件预览</h1>
    <p className="pfu-muted">全部为虚构资料与内存驱动：提交只改内存，不保存、不重新计算损益；真实端口接入前不代表原生行为。刷新重置。</p>
    <nav aria-label="预览状态">{states.map(s => <a key={s} href={`?state=${s}&theme=${query.get('theme') ?? 'light'}`}>{s}</a>)}</nav>
    <div className="pfu-toolbar">
      <button type="button" className="pfu-btn pfu-primary" onClick={() => { setNotice(''); setAssumptionsOpen(true); }}>打开假设核对编辑器</button>
      <button type="button" className="pfu-btn" onClick={() => setWriteVersion(v => v + 1)}>模拟资料版本变化（重读）</button>
      {notice && <p role="status" className="pfu-notice">{notice}</p>}
    </div>
    {assumptionsOpen && <AssumptionsEditor port={port} generation={GENERATION} onPending={() => setNotice('虚构：原请求已保留，请核对结果。')} onClose={saved => { setAssumptionsOpen(false); setNotice(saved ? '虚构：假设已保存（内存）。' : ''); }}/>}
    <FollowupSection port={port} generation={GENERATION} pair={pairOrNull} writeVersion={writeVersion} today="2026-10-12"
      onPending={() => setNotice('虚构：原请求已保留，请核对结果。')} onEditingChange={() => {}}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
