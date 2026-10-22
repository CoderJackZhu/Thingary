import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { HeaderSlot } from './HeaderSlot';
import { FinancePeriodControl } from './FinancePeriodControl';
import { IncomeRecords } from './IncomeRecords';
import { IncomeDialog } from './IncomeDialog';
import { ExpensesPage } from './ExpensesPage';
import { MovementsList } from './planning-followup-ui/MovementsList';
import { nativePlanningFollowupPortV1 } from './planning-followup-port';
import type { PlanningFollowupPortV1 } from './planning-followup-contract';
import { useFinanceSources } from './finance-data';
import { financeCapabilities, financePeriodContains, type FinancePeriod } from './finance-contract';
import { availableFinanceRecordTabs, defaultFinanceRecordTab, type FinanceRoute, type FinanceRecordTab } from './finance-navigation';
import type { RuntimeModules } from './modules';
import { type Income, type IncomeList } from './plan';
import { storedPending, code } from './wealth';
import { usePendingReceipt } from './WealthPage';
import { useSource } from './useSource';
import type { SourceProps, SourceTarget, SourceFocus } from './source';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { errorMessage } from './asset';
import { useRestored } from './undo';
import './wealth.css';
import './planning.css';
import './planning-followup-ui/planning-followup-ui.css';
import { t } from './i18n.ts';
type RecordsRoute = Extract<FinanceRoute, { page: 'records' }>;
export type FinanceRecordsPageProps = SourceProps & {
  generation: string; today: string; modules: RuntimeModules; route: RecordsRoute;
  onRouteChange: (route: RecordsRoute) => void; search: string; onSearch: (search: string) => void;
  onEditingChange: (editing: boolean) => void; onOpenAsset: (id: string) => void; onOpenSource: (target: SourceTarget) => void;
  onNewAccount: () => void; blocked?: boolean; autoNew?: boolean; onAutoNewDone?: () => void;
  restoreScroll?: { top: number; done: () => void } | null; followupPort?: PlanningFollowupPortV1;
};
const labels: Record<FinanceRecordTab, string> = { income: '收入', expenses: '重要支出', movements: '资金流动' };
function RecordsContent({ generation, today, modules, route, onRouteChange, search, onSearch, onEditingChange, onOpenAsset, onOpenSource, onNewAccount, blocked = false, autoNew, onAutoNewDone, restoreScroll, followupPort, source, onSourceDone }: FinanceRecordsPageProps) {
  const capabilities = financeCapabilities(modules);
  const tabs = availableFinanceRecordTabs(capabilities);
  const routeFocus = useRef<{ key: string; focus: SourceFocus | null }>({ key: '', focus: null });
  const focusKey = JSON.stringify([generation, route.source]);
  if (routeFocus.current.key !== focusKey) routeFocus.current = { key: focusKey, focus: route.source ? { generation, token: (routeFocus.current.focus?.token ?? 0) + 1, target: route.source } : null };
  const activeSource = source ?? routeFocus.current.focus;
  const explicit = !!route.source || !!activeSource;
  const sourceTab = activeSource?.target.kind === 'income' ? 'income' : activeSource?.target.kind === 'expense' ? 'expenses' : activeSource?.target.kind === 'movement' ? 'movements' : route.tab;
  const tab = explicit ? tabs.includes(sourceTab) ? sourceTab : null : defaultFinanceRecordTab(capabilities, route.tab);
  const period: FinancePeriod = route.period ?? { kind: 'all' };
  const { load, reload } = useFinanceSources(generation, period, modules);
  useRestored(reload);
  const sources = load.status === 'ready' ? load.sources : null;
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  const [editing, setEditing] = useState<Income | 'new' | null>(null);
  const [childEditing, setChildEditing] = useState(false);
  const [newForChild, setNewForChild] = useState(false);
  const [defaultHpf, setDefaultHpf] = useState('');
  const [defaultNotice, setDefaultNotice] = useState('');
  const [outside, setOutside] = useState<Income | null>(null);
  const [openError, setOpenError] = useState('');
  const [opening, setOpening] = useState(false);
  const [receiptResolutionVersion, setReceiptResolutionVersion] = useState(0);
  const openTicket = useRef(0), openingRef = useRef(false), opener = useRef<HTMLElement | null>(null);
  const portRef = useRef<PlanningFollowupPortV1 | null>(null);
  if (!portRef.current) portRef.current = nativePlanningFollowupPortV1();
  const port = followupPort ?? portRef.current;
  const frozen = blocked || !!pending || busy;
  const frozenRef = useRef(frozen); frozenRef.current = frozen;
  const scope = JSON.stringify([generation, modules]);
  useEffect(() => { ++openTicket.current; setEditing(null); setOutside(null); openingRef.current = false; setOpening(false); return () => { ++openTicket.current; }; }, [scope]);
  useEffect(() => { onEditingChange(!!editing || childEditing || !!pending || busy || opening); return () => onEditingChange(false); }, [editing, childEditing, pending, busy, opening, onEditingChange]);
  useEffect(() => { if (tab && route.tab !== tab) onRouteChange({ ...route, tab }); }, [tab, explicit, route.tab]);
  const rememberOpener = () => { opener.current = document.activeElement as HTMLElement | null; };
  const onPendingRef = useRef(() => setPending(storedPending()));
  const childEditingRef = useRef((value: boolean) => { setChildEditing(value); setPending(storedPending()); });
  const childNewDoneRef = useRef(() => setNewForChild(false));
  async function openNew() {
    if (frozen || editing || childEditing || openingRef.current || !tab) return;
    if (tab !== 'income') { setNewForChild(true); return; }
    if (sources?.incomes.status !== 'ready') return;
    rememberOpener();
    const ticket = ++openTicket.current;
    openingRef.current = true; setOpening(true); setOpenError(''); setDefaultNotice('');
    // Default depends on the latest non-investment record globally, never the period-filtered rows.
    try {
      const defaults = await invoke<{ generation: string; hpf_cents: string | null }>('plan_income_defaults');
      if (ticket !== openTicket.current || frozenRef.current) return;
      if (defaults.generation !== generation) { setOpenError('资料库已变化，请重新读取。'); return; }
      setDefaultHpf(defaults.hpf_cents ?? ''); setEditing('new');
    } catch (error) {
      if (ticket === openTicket.current && !frozenRef.current) {
        if (code(error) === 'MODULE_DISABLED' || code(error) === 'STALE_DATASET') { setOpenError(errorMessage(error)); return; }
        setDefaultHpf(''); setEditing('new');
        setDefaultNotice('公积金默认金额未读取，已留空；请按实际金额填写，留空表示未知。');
      }
    }
    finally { if (ticket === openTicket.current) { openingRef.current = false; setOpening(false); } }
  }
  const newDisabled = frozen || !!editing || childEditing || opening || !tab || !sources || (tab === 'income' ? sources.incomes.status !== 'ready' : tab === 'expenses' ? sources.expenses.status !== 'ready' : false);
  const action = tab ? { label: tab === 'income' ? opening ? t('正在准备收入…') : t('记一笔收入') : tab === 'expenses' ? t('记一笔支出') : t('记一笔资金流动'), plus: true, disabled: newDisabled, run: () => void openNew() } : undefined;
  usePageBar('finance-records', { primary: action, newRecord: action, search: tab ? { key: 'finance-records', placeholder: t('搜索{v1}', { v1: labels[tab] }) } : undefined });
  const autoConsumed = useRef(false);
  useEffect(() => {
    if (!autoNew) { autoConsumed.current = false; return; }
    if (autoConsumed.current || newDisabled) return;
    autoConsumed.current = true; void openNew(); onAutoNewDone?.();
  }, [autoNew, newDisabled, tab]);
  const incomeSourceError = useSource({ source: activeSource?.target.kind === 'income' ? activeSource : null, onSourceDone }, tab === 'income' && capabilities.incomeRecords ? generation : undefined, async (target, alive) => {
    if (target.kind !== 'income') return false;
    if (frozen || editing || childEditing || openingRef.current) throw new Error(t('请先关闭表单或核对上次保存结果，再打开来源收入。'));
    const expected = ++openTicket.current;
    openingRef.current = true; setOpening(true);
    try {
      const all = await invoke<IncomeList>('plan_income_list');
      if (!alive() || frozenRef.current || expected !== openTicket.current || all.generation !== generation) return false;
      const found = all.rows.find(row => row.id === target.id);
      if (!found) return false;
      rememberOpener(); setEditing(found); return true;
    } finally { if (expected === openTicket.current) { openingRef.current = false; setOpening(false); } }
  });
  useEffect(() => {
    if (!restoreScroll || !sources || tab === 'expenses') return;
    requestAnimationFrame(() => restoreScroll.done());
  }, [restoreScroll, sources, tab]);
  const failedSource = useRef<number | null>(null);
  useEffect(() => { if (tab === null && activeSource && failedSource.current !== activeSource.token) { failedSource.current = activeSource.token; onSourceDone?.('来源所属的记录模块已关闭，无法打开这条来源。'); } }, [tab, activeSource?.token, onSourceDone]);
  const setPeriod = (next: FinancePeriod) => onRouteChange({ ...route, period: next });
  async function verifyOriginal() { await verify(); if (!storedPending()) setReceiptResolutionVersion(n => n + 1); }
  return <section className="stats-section wealth-section planning-section" aria-label={t('收支记录')}>
    <HeaderSlot target="page-header-tabs"><div className="page-tabs" role="group" aria-label={t('记录类型')}>{tabs.map(value => <button key={value} type="button" aria-pressed={tab === value} disabled={frozen || !!editing || childEditing || opening} onClick={() => { onRouteChange({ ...route, tab: value, source: undefined }); }}>{labels[value]}</button>)}</div></HeaderSlot><FinancePeriodControl recordedYears={sources?.record_years.status === 'ready' ? sources.record_years.value : undefined} value={period} today={today} disabled={frozen || !!editing || childEditing || opening} onChange={setPeriod}/>
    {sources?.record_years.status === 'error' && <p className="notice" role="alert">{t('历史年份读取失败：{message}。仍可通过“其他年份”选择。', { message: sources.record_years.message })}<button onClick={reload}>{t('重试')}</button></p>}
    {pending && <p className="notice" role="status">{t('上次「{label}」的保存结果未确认。', { label: pending.label })}{pending.command === 'financial_import_commit' ? <span>{t('请到设置的数据管理核对上次金融导入结果。')}</span> : <button disabled={busy} onClick={() => void verifyOriginal()}>{t('核对结果')}</button>}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {(openError || incomeSourceError) && <p className="notice" role="alert">{openError || incomeSourceError}</p>}
    {tab === null ? <p className="notice" role="status">{explicit ? t('来源所属的记录模块已关闭，无法打开这条来源。') : t('收支记录模块已关闭。请在设置中启用需要的功能。')}</p> : <>
      {tab !== 'movements' && <p className="muted small">{t('当前搜索范围：{v1}明细；搜索不改变期间合计。', { v1: labels[tab] })}</p>}
      {load.status === 'loading' && <p role="status">{t('正在读取收支资料…')}</p>}
      {load.status === 'error' && <p className="notice" role="alert">{t('读取失败：{message}', { message: load.message })}<button onClick={reload}>{t('重试')}</button></p>}
      {tab === 'income' && sources && (sources.incomes.status === 'ready' ? <IncomeRecords incomes={{ generation, rows: sources.incomes.value }} period={period} search={search} disabled={frozen || !!editing || opening} onOpen={income => { if (!frozen && !editing && !openingRef.current) { ++openTicket.current; rememberOpener(); setEditing(income); } }} onNew={() => void openNew()}/> : <p className="notice" role={sources.incomes.status === 'error' ? 'alert' : 'status'}>{sources.incomes.status === 'error' ? t('收入读取失败：{message}', { message: sources.incomes.message }) : sources.incomes.reason}<button onClick={reload}>{t('重新读取')}</button></p>)}
      {tab === 'expenses' && pending?.command !== 'financial_import_commit' && <ExpensesPage key={`expenses-${receiptResolutionVersion}`} embedded generation={generation} today={today} period={period} onPeriodChange={setPeriod} controlledView={sources?.expenses.status === 'ready' ? sources.expenses.value : null} controlledError={load.status === 'error' ? load.message : sources?.expenses.status === 'error' ? sources.expenses.message : sources?.expenses.status === 'disabled' ? sources.expenses.reason : ''} onRefresh={reload} blocked={frozen} onEditingChange={childEditingRef.current} onOpenAsset={onOpenAsset} onOpenSource={onOpenSource} search={search} onSearch={onSearch} autoNew={newForChild} onAutoNewDone={childNewDoneRef.current} source={activeSource} onSourceDone={onSourceDone} restoreScroll={restoreScroll}/>}
      {tab === 'movements' && <MovementsList embedded port={port} generation={generation} writeVersion={sources?.write_version ?? 0} today={today} period={period} accountIds={route.movementAccountIds} search={search} blocked={frozen} onPending={onPendingRef.current} onEditingChange={childEditingRef.current} onSaved={reload} autoNew={newForChild} onAutoNewDone={childNewDoneRef.current} onNewAccount={onNewAccount} receiptResolutionVersion={receiptResolutionVersion} source={activeSource} onSourceDone={onSourceDone}/>}
    </>}
    {outside && <p className="notice" role="status">{t('已保存收入（{date}），不在当前期间内。', { date: outside.fields.date })}<button disabled={frozen} onClick={() => { setPeriod({ kind: 'all' }); setOutside(null); onSearch(''); }}>{t('查看全部收入')}</button></p>}
    {editing && <IncomeDialog key={editing === 'new' ? 'new' : editing.id} income={editing === 'new' ? null : editing} generation={generation} today={today} hpfDefault={defaultHpf} hpfDefaultNotice={editing === 'new' ? defaultNotice : undefined} accountsEnabled={modules.wealth} accounts={sources?.accounts.status === 'ready' ? sources.accounts.value : []} onSavedIncome={saved => { if (!financePeriodContains(period, saved.fields.date)) setOutside(saved); }} onClose={saved => { setEditing(null); setPending(storedPending()); if (saved) reload(); requestAnimationFrame(() => { if (opener.current?.isConnected && !opener.current.matches(':disabled')) opener.current.focus(); else refocusHeading(); }); }}/ >}
  </section>;
}
/** Dataset replacement unmounts every editor and invalidates its asynchronous work. */
export function FinanceRecordsPage(props: FinanceRecordsPageProps) { return <RecordsContent key={props.generation} {...props}/>; }
