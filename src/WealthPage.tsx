import { HoldingInput } from "./HoldingInput";
import { holdingFact, holdingText, holdingSupported } from "./holdings";
import type { CurrencyFact } from "./currency";
import { AccountGroupManager } from './AccountGroupManager';
import { accountGroupTotals } from './wealth-display';
import { groupNameError, recallGroupViews, rememberGroupView } from './account-groups';
import type { AccountGroup, AccountGroupList } from './account-groups';
import { QuickUpdateDialog } from './QuickUpdateDialog';
import { CurrencyInput } from './CurrencyInput';
import { currencies, currencyCode, currencyDecimals, currencyAmount, rateLabel, rateSuggestions, convertCurrency, validCurrency } from './currency';
import { accountUpdateAge } from './wealth';
import { SavingsGoals } from './SavingsGoals';
import { CheckinReminder } from './CheckinReminder';
import { CheckinReminderAsk } from './CheckinReminderAsk';
import { DualLineChart } from './DualLineChart';
import { TrendRangeControl, useTrendSelection } from './TrendRangeControl';
import { accountVisible, fixedAssetChange, accountBalanceView, balanceComparison } from './wealth-display';
import type { AccountView } from './wealth-display';
import { SortHeader } from './SortHeader';
import { sortRecords, moneySortValue, type ListSort } from './list-sort';
import { HeaderSlot } from './HeaderSlot';
import { CloseButton } from './CloseButton';
import { useSource } from './useSource';
import type { SourceProps } from './source';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Info, Switch } from './FormControls';
import { Icon } from './AssetViews';
import { quickAvailable, selectAccountKind, defaultAccountCounted, accountKindHint, assetKinds, liabilityKinds, kindLabel, signedMoney, changeText, comparisonText, enterJumpsAmount, checkInUnfilledTargets, nextUnfilledLabel, applyClosing, canCloseInCheckIn, rateText, noteSummary, snapshotEntryInput, previousCheckInRow, storedPending, resolvePending, submit, Unresolved, previewTotals } from './wealth';
import type { Account, AccountFields, AccountSave, CheckInRow, Draft, Pending, Point, Snapshot, SnapshotSave, Summary, TrashKind } from './wealth';
import { WealthChanges } from './WealthChanges';
import { offerUndo, useRestored } from './undo';
import './wealth.css';

export type WealthReviewFocus = { generation: string; kind: 'accounts' | 'snapshot' | 'history' | 'check-in' | 'savings-goals'; id?: string; date?: string };
type Tab = 'overview' | 'accounts' | 'changes' | 'history';

/** Shared by wealth and expense pages: one stored receipt, checked by request id. */
export function usePendingReceipt(reload: () => void) {
  const [pending, setPending] = useState<Pending | null>(storedPending), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  async function verify() {
    if (!pending) return;
    setBusy(true);
    try {
      const outcome = await resolvePending(pending);
      setPending(null); reload();
      setNotice(outcome === 'saved' ? `已确认「${pending.label}」保存成功。` : outcome === 'stale' ? '资料库已切换，上次请求不属于当前资料，已放弃。' : `「${pending.label}」没有保存，请重新录入。`);
    } catch (e) { setPending(storedPending()); setNotice(errorMessage(e) + ' 原请求已保留，请稍后再核对。'); }
    finally { setBusy(false); }
  }
  return { pending, setPending, notice, setNotice, busy, verify };
}
function FixedAssetPurchase({ account }: { account: Account }) {
  if (!['property', 'vehicle'].includes(account.fields.kind) || !account.latest) return null;
  const purchase = account.fields.purchase_cents;
  if (purchase == null) return null;
  let hidden = false;
  try { hidden = localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; } catch { /* Preference unavailable. */ }
  const delta = fixedAssetChange(purchase, account.latest.amount_cents)!;
  return <small className="muted" style={{ display: 'block', whiteSpace: 'normal' }}>{hidden ? '购入 •••• · 估值较购入价 ••••' : <>购入 {money(purchase)} · 估值较购入价 {changeText(delta.change_cents)}{delta.rate_hundredths !== null ? `（${rateText(delta.rate_hundredths)}）` : ''}</>}</small>;
}
function AccountBalance({ account, today, summary }: { account: Account; today: string; summary?: Pick<Summary, 'points' | 'latest_entries'> }) {
  const basis = accountBalanceView(account, summary?.points.at(-1)?.date, summary?.latest_entries);
  const age = accountUpdateAge(account.last_entered_on, today);
  return <><CurrencyBalance unit={account.fields.holding_mode ? account.fields.holding_unit ?? '份' : null} code={account.fields.currency} fact={basis.fact} date={basis.date}/><small className="account-amount-basis" data-state={basis.state} data-old={age.old}>{basis.label}{basis.state === 'unknown' && basis.date ? ` · ${basis.date}` : ''}</small><FixedAssetPurchase account={{ ...account, latest: basis.fact?.amount_cents != null ? { ...basis.fact, amount_cents: basis.fact.amount_cents, date: basis.date ?? '' } : null }}/></>;
}
function groupAmountsHidden(): boolean {
  try { return localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; }
  catch { return false; }
}
export function CurrencyBalance({ code, fact, date, unit }: { code?: string; fact: CurrencyFact | null; date?: string; unit?: string | null }) {
  if (!fact || fact.amount_cents === null) return <span className="muted">未知</span>;
  let hidden = false;
  try { hidden = localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; } catch { /* unavailable preference */ }
  if (hidden) return <>••••</>;
  const currency = currencyCode(code);
  const holding = holdingText(fact, unit ?? null, currency);
  if (currency === 'CNY') return <>{holding && <small className="holding-equation">{holding} = </small>}{money(fact.amount_cents)}{date && <small className="muted"> · {date}</small>}</>;
  return <>{holding && <small className="holding-equation">{holding} = </small>}{fact.original_minor != null ? currencyAmount(currency, fact.original_minor) : '原币金额未知'}<small className="muted" style={{ display: 'block', whiteSpace: 'normal' }}>≈ {money(fact.amount_cents)} · 汇率 {fact.fx_rate_micro ? rateLabel(fact.fx_rate_micro) : '未知'}{date ? ` · ${date}` : ''}</small></>;
}
function ForeignStructure({ summary, accounts }: { summary: Summary; accounts: Account[] }) {
  const ids = new Set(accounts.filter(a => currencyCode(a.fields.currency) !== 'CNY').map(a => a.id));
  const entries = (summary.structure_entries ?? []).filter(e => ids.has(e.account_id) && e.side === 'asset' && e.counted && e.amount_cents !== null);
  if (!entries.length) return null;
  let hidden = false;
  try { hidden = localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; } catch { /* unavailable preference */ }
  return <p className="muted small">含外币资产 {hidden ? '••••' : money(entries.reduce((n, e) => n + BigInt(e.amount_cents!), 0n).toString())}，按各次盘点所填汇率折算</p>;
}
const series = (i: number) => `var(--series-${i % 7 + 1})`;

export function WealthPage({ today, onEditingChange, source, onSourceDone, search, onSearch, autoNew, onAutoNewDone, onGotoPlanning, onCompare, reviewFocus, onReviewFocusDone, onFinancialImport, onAdjustPlan }: SourceProps & { onGotoPlanning?: (snapshotId: string) => void; onCompare?: (pair?: { fromSnapshotId: string; toSnapshotId: string }) => void; reviewFocus?: WealthReviewFocus | null; onReviewFocusDone?: () => void; onFinancialImport?: () => void; onAdjustPlan?: () => void; today: string; onEditingChange: (value: boolean) => void; search: string; onSearch: (value: string) => void; autoNew?: boolean; onAutoNewDone?: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [savingsFocus, setSavingsFocus] = useState(false);
  const [accountView, setAccountView] = useState<AccountView>('active');
  // 概览链接带来的比较区间：只在点「变化」分段时清空，进入时消费一次（U20 §2.1）。
  const [changesSeed, setChangesSeed] = useState<{ from: string; to: string } | null>(null);
  // Typing a search on 概览/盘点记录 moves to the account list it filters (3.5.1).
  const lastSearch = useRef(search);
  useEffect(() => { if (search !== lastSearch.current && search.trim()) setTab('accounts'); lastSearch.current = search; }, [search]);
  const [summary, setSummary] = useState<Summary | null>(null), [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [loadedRetry, setLoadedRetry] = useState(-1);
  const [sourceSnapshot, setSourceSnapshot] = useState<string | undefined>();
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkInPin, setCheckInPin] = useState<string | undefined>();
  const [savedSnapshot, setSavedSnapshot] = useState<Snapshot | null>(null);
  const [snapshotDetail, setSnapshotDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const goalAccount = useRef(false);
  // 新建账户成功行：仅本次页面会话记忆，离开页面或切换资料库即清除。
  const [createdAccount, setCreatedAccount] = useState<{ name: string; generation: string; afterRead: number } | null>(null);
  const [quickSaved, setQuickSaved] = useState<string | null>(null);
  const [quickAccount, setQuickAccount] = useState<Account | null>(null);
  const [goalEditing, setGoalEditing] = useState(false);
  const [groups, setGroups] = useState<AccountGroup[]>([]), [manageGroups, setManageGroups] = useState(false);
  const [groupView, setGroupView] = useState<'list' | 'group'>('list');
  const groupMemoryLoaded = useRef(false);
  useEffect(() => { if (summary && !groupMemoryLoaded.current) { groupMemoryLoaded.current = true; setGroupView(recallGroupViews(summary.generation).mode); } }, [summary]);
  useEffect(() => {
    let live = true; setError('');
    Promise.all([invoke<Summary>('wealth_summary'), invoke<Account[]>('wealth_accounts'), invoke<AccountGroupList>('account_groups_list')])
      .then(([s, a, g]) => { if (live) { if (g.generation !== s.generation) throw new Error('资料库已切换，请重新读取。'); setSummary(s); setAccounts(a); setGroups(g.groups); setLoadedRetry(retry); } })
      .catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  useEffect(() => {
    if (!reviewFocus || !summary) return;
    if (reviewFocus.generation !== summary.generation) { onReviewFocusDone?.(); return; }
    if (storedPending()) return;
    if (reviewFocus.kind === 'savings-goals') { setTab('overview'); setSavingsFocus(true); onSearch(''); }
    else if (reviewFocus.kind === 'history') setTab('history');
    else if (reviewFocus.kind === 'check-in') setCheckIn(reviewFocus.date ?? today);
    else if (reviewFocus.kind === 'accounts') { setTab('accounts'); setAccountView('all'); onSearch(''); }
    else {
      const p = summary.points.find(p => p.snapshot_id === reviewFocus.id);
      if (p) { setCheckInPin(p.snapshot_id); setCheckIn(p.date); }
      else setError('这条盘点已删除或变化，请重新读取。');
    }
    onReviewFocusDone?.();
  }, [reviewFocus, summary]);
  const reload = () => setRetry(n => n + 1);
  useRestored(reload);
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => { onEditingChange(manageGroups || !!quickAccount || goalEditing || !!editing || !!pending || busy || !!checkIn || !!snapshotDetail); return () => onEditingChange(false); }, [manageGroups, quickAccount, goalEditing, editing, pending, busy, checkIn, snapshotDetail, onEditingChange]);
  const sourceError = useSource({source,onSourceDone}, summary?.generation, async (target, alive) => {
    // 账户来源：按稳定 ID 打开账户资料表单；未保存的输入不写入（§6.2）。
    if (target.kind === 'account') {
      if (pending || busy) throw new Error('请先核对上次保存结果，再打开来源账户。');
      const fresh = await invoke<Account[]>('wealth_accounts');
      if (!alive()) return false;
      const found = fresh.find(a => a.id === target.id);
      if (!found) return false;
      setAccounts(fresh);
      setEditing(found); return true;
    }
    if (target.kind !== 'snapshot') return false;
    if (pending || busy) throw new Error('请先核对上次保存结果，再打开来源盘点。');
    // A same-generation correction must be visible: read points again instead
    // of trusting the previously rendered summary.
    const fresh = await invoke<Summary>('wealth_summary');
    if (!alive()) return false;
    if (fresh.generation !== summary?.generation) return false;
    setSummary(fresh);
    const point = fresh.points.find(p => p.snapshot_id === target.id);
    if (!point) return false;
    setSourceSnapshot(target.id); setSnapshotDetail(point.snapshot_id); return true;
  });
  useEffect(() => { if (sourceError) reload(); }, [sourceError]);
  // Hooks must run on every render: the check-in view is an early return below.
  const open = accounts?.filter(a => !a.fields.closed_on) ?? [];
  const openQuick = (account: Account) => { if (!storedPending() && !busy && quickAvailable(account, summary?.points ?? [], today)) setQuickAccount(account); };
  const newAccount = { label: '新增账户', plus: true, disabled: !!pending || !accounts, run: () => setEditing('new') };
  usePageBar('wealth', checkIn ? {} : open.length
    ? { primary: { label: '更新今天的余额', disabled: !!pending || !open.length, run: () => setCheckIn(today) }, secondary: newAccount, newRecord: newAccount, search: { key: 'wealth', placeholder: '搜索账户' } }
    : { primary: accounts?.length === 0 && onFinancialImport ? { label: '导入已有的资产表格', disabled: !!pending || busy, run: onFinancialImport } : newAccount, secondary: accounts?.length === 0 && onFinancialImport ? newAccount : undefined, newRecord: newAccount, search: { key: 'wealth', placeholder: '搜索账户' } });
  // The menu hand-off opens the same editor the page's own buttons use.
  const consumedAutoNew = useRef(false);
  useEffect(() => {
    if (!autoNew || consumedAutoNew.current) return;
    consumedAutoNew.current = true;
    onAutoNewDone?.();
    setEditing('new');
  }, [autoNew]);
  if (snapshotDetail) return <SnapshotDetail id={snapshotDetail} onCorrect={id => { const date = summary?.points.find(p => p.snapshot_id === id)?.date; setSnapshotDetail(null); if (date) { setCheckInPin(id); setCheckIn(date); } }} onClose={() => { setSnapshotDetail(null); reload(); refocusHeading(); }}/>;
  if (checkIn) return <CheckIn accountDialog={onDone => summary && <AccountDialog quickPoints={summary.points} groups={groups} onGroupsChanged={reload} account={null} generation={summary.generation} today={today} onQuick={openQuick} onClose={saved => onDone(saved)}/>} expectedId={checkInPin ?? sourceSnapshot} date={checkIn} today={today} onClose={(saved, snapshot) => { setCheckIn(null); setCheckInPin(undefined); setSourceSnapshot(undefined); setPending(storedPending()); if (saved) { setSavedSnapshot(snapshot?.missing.length === 0 ? snapshot : null); setTab('overview'); reload(); } refocusHeading(); }}/>;
  const points = summary?.points ?? [], latest = points.at(-1), lastComplete = [...points].reverse().find(p => p.complete);
  const closeAccount = (saved: boolean, createdName?: string) => {
    (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close();
    const wasCreating = editing === 'new', returnToGoal = goalAccount.current;
    goalAccount.current = false;
    setEditing(null); setPending(storedPending());
    // 只有明确保存成功的新建账户才出现继续动作；失败、结果未知与编辑/
    // 删除路径都不给成功行（I04/I05）。generation 变化时行随之失效。
    if (saved) { reload(); if (wasCreating && createdName != null && summary) setCreatedAccount({ name: createdName, generation: summary.generation, afterRead: retry + 1 }); }
    if (returnToGoal) setSavingsFocus(true); else refocusHeading();
  };
  // Search filters the account list only: the check-in set is every effective
  // account and never depends on the keyword (3.5.1/3.5.2).
  const keyword = search.trim().toLowerCase();
  const shownAccounts = accounts?.filter(a => accountVisible(a, accountView) && (!keyword || [a.fields.name, kindLabel(a.fields.kind), a.fields.institution, a.fields.notes].some(t => t.toLowerCase().includes(keyword)))) ?? [];
  const accountScope = <div className="wealth-account-scope"><label className="account-filter">显示账户 <select aria-label="账户范围" value={accountView} disabled={!accounts || !!pending} onChange={e => setAccountView(e.target.value as AccountView)}><option value="active">在用账户（{open.length}）</option><option value="closed">已停用（{(accounts?.length ?? 0) - open.length}）</option><option value="all">全部账户</option></select></label><span className="muted small">仅筛选账户清单，不改变净资产汇总</span></div>;
  return <section className="stats-section wealth-section" aria-label="财富">
    {sourceError && <p role="alert" className="notice">{sourceError}</p>}
    {quickSaved && <div className="notice" role="status"><span>已保存「{quickSaved}」的快速更新；沿用金额的来源日期保持不变。</span><CloseButton type="button" aria-label="关闭快速更新成功提示" onClick={() => setQuickSaved(null)}/></div>}
    {createdAccount && !error && loadedRetry >= createdAccount.afterRead && summary?.generation === createdAccount.generation && <div className="notice wealth-account-created" role="status"><span>已添加「{createdAccount.name}」。</span><button type="button" className="ui-link" disabled={!!pending || busy} onClick={() => setEditing('new')}>继续添加账户</button><button type="button" className="ui-link" disabled={!!pending || busy} onClick={() => { setCreatedAccount(null); setCheckIn(today); }}>去填写余额</button><CloseButton type="button" aria-label="关闭添加账户成功提示" onClick={() => setCreatedAccount(null)}/></div>}
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。{pending.command === 'financial_import_commit' ? <span>请到设置的数据管理核对上次导入结果。</span> : <button disabled={busy} onClick={() => void verify()}>核对结果</button>}</div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <HeaderSlot target="page-header-tabs"><div className="page-tabs" role="group" aria-label="财富页面">{([['overview', '概览'], ['accounts', '账户'], ['changes', '变化'], ['history', '盘点记录']] as const).filter(([k]) => !onCompare || k !== 'changes').map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setChangesSeed(null); setTab(k); }}>{l}</button>)}</div></HeaderSlot>
    {tab !== 'overview' && tab !== 'history' && accountScope}
    {tab === 'accounts' && <div className="account-group-toolbar"><label>分组方式<select aria-label="账户分组方式" value={groupView} onChange={e => { const mode = e.target.value as 'list' | 'group'; setGroupView(mode); if (summary) rememberGroupView(summary.generation, 'mode', mode); }}><option value="list">列表</option><option value="group">按分组</option></select></label><button type="button" disabled={!!pending || busy || !summary} onClick={() => setManageGroups(true)}>管理分组</button></div>}

    {savedSnapshot && !error && <div className="notice wealth-review-entry" role="status"><div><strong>{savedSnapshot.date === today ? '今天的余额已保存' : '这次余额记录已保存'}（{savedSnapshot.date}）</strong><p className="muted small">{savedSnapshot.entries.some(entry => entry.state === 'unchanged') ? '其中有沿用旧金额的账户，并非都在这一天重新填写。' : '这次填写的金额已记录。'}{!balanceComparison(summary?.points ?? [], savedSnapshot.id) ? '再有一次完整记录后，就可以比较变化。' : '接着看看哪些账户发生了变化。'}</p></div><div className="wealth-review-actions"><button type="button" className="primary" disabled={!balanceComparison(summary?.points ?? [], savedSnapshot.id) || !!pending || busy} onClick={() => {
      const pair = balanceComparison(summary?.points ?? [], savedSnapshot.id); if (!pair || pending || busy) return;
      if (onCompare) onCompare(pair); else if (onGotoPlanning) onGotoPlanning(savedSnapshot.id); else { setChangesSeed({ from: pair.fromSnapshotId, to: pair.toSnapshotId }); setTab('changes'); }
    }}>看哪些账户变化了 →</button>{onAdjustPlan && <button type="button" className="ui-link" disabled={!!pending || busy} onClick={onAdjustPlan}>需要时调整计划 →</button>}</div><CloseButton type="button" aria-label="关闭余额保存提示" onClick={() => setSavedSnapshot(null)}/></div>}
    {savedSnapshot && !error && summary && <CheckinReminderAsk savedComplete={summary.points.some(p => p.snapshot_id === savedSnapshot.id && p.complete)} completeCount={summary.points.filter(p => p.complete).length} wealthOn today={today}/>}
    {error ? <article className="ui-card ui-content" role="alert"><p>财富资料读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !summary || !accounts ? <p role="status" className="muted">正在读取财富资料…</p>
      : tab === 'overview' ? <><div className="review-plan-actions"><button type="button" className="ui-link" onClick={() => setSavingsFocus(true)}>存钱目标 ↓</button></div><Overview groups={groups} allAccounts={accounts} onQuick={openQuick} today={today} onFinancialImport={onFinancialImport} importDisabled={!!pending || busy} accountScope={accountScope} hasAccounts={accounts.length > 0} summary={summary} accounts={accounts.filter(a => accountVisible(a, accountView)).sort((a,b) => Number(!!a.fields.closed_on)-Number(!!b.fields.closed_on))} latest={latest} lastComplete={lastComplete} onNewAccount={() => setEditing('new')} onCheckIn={setCheckIn} onOpenChanges={seed => { if (onCompare) onCompare(seed ? { fromSnapshotId: seed.from, toSnapshotId: seed.to } : undefined); else { setChangesSeed(seed); setTab('changes'); } }}/><SavingsGoals key={summary.generation} generation={summary.generation} today={today} version={retry} onNewAccount={() => { if (pending || busy) return; goalAccount.current = true; setEditing('new'); }} focusRequested={savingsFocus} onFocusDone={() => setSavingsFocus(false)} blocked={!!pending || busy} onEditingChange={setGoalEditing} onPendingChange={() => setPending(storedPending())}/></>
      : tab === 'accounts' ? (keyword && !shownAccounts.length
        ? <div className="empty"><span className="empty-mark">¥</span><h2>当前条件下没有找到记录</h2><p>试试其他关键词。</p><button onClick={() => onSearch('')}>清除搜索</button></div>
        : <AccountListing mode={groupView} groups={groups} allAccounts={accounts} summary={summary} onQuick={openQuick} today={today} accounts={shownAccounts} onEdit={setEditing} onNew={() => setEditing('new')} found={keyword ? shownAccounts.length : null}/>)
      : tab === 'changes' ? <WealthChanges accountView={accountView} summary={summary} accounts={accounts} today={today} initial={changesSeed} onNewAccount={() => setEditing('new')} onCheckIn={setCheckIn}/>
      : <History points={points} onOpen={setSnapshotDetail} onCompare={onCompare} onNew={() => setCheckIn(today)} canStart={!!open.length && !pending}/>}
    {tab === 'history' && summary && !error && <CheckinReminder wealthOn today={today}/>}
    {manageGroups && summary && <AccountGroupManager generation={summary.generation} onClose={() => { setManageGroups(false); setPending(storedPending()); reload(); }} onChanged={() => { setPending(storedPending()); reload(); }}/>}
    {editing && summary && <AccountDialog quickPoints={summary.points} groups={groups} onGroupsChanged={reload} account={editing === 'new' ? null : editing} generation={summary.generation} today={today} onQuick={openQuick} onClose={closeAccount}/>}
    {quickAccount && summary && <QuickUpdateDialog account={quickAccount} generation={summary.generation} today={today} points={summary.points} onClose={(saved, snapshot) => {
      setQuickAccount(null); setPending(storedPending()); reload();
      if (saved) {
        if (snapshot && snapshot.missing.length > 0) setQuickSaved(quickAccount.fields.name);
        setSavedSnapshot(snapshot?.missing.length === 0 ? snapshot : null);
        if (editing && editing !== 'new') {
          const editorId = editing.id;
          void invoke<Account[]>('wealth_accounts').then(fresh => {
            const account = fresh.find(a => a.id === editorId);
            if (account) setEditing(current => current && current !== 'new' && current.id === editorId ? { ...current, latest: account.latest, last_entered_on: account.last_entered_on, has_entries: account.has_entries } : current);
          }).catch(() => {});
        }
      }
      if (!editing) refocusHeading();
    }}/>}
  </section>;
}

function Overview({ groups, allAccounts, onQuick, accountScope, summary, accounts, hasAccounts, latest, lastComplete, onNewAccount, onCheckIn, today, onOpenChanges, onFinancialImport, importDisabled }: { groups: AccountGroup[]; allAccounts: Account[]; onQuick: (account: Account) => void; onFinancialImport?: () => void; importDisabled?: boolean; accountScope: ReactNode; summary: Summary; accounts: Account[]; hasAccounts: boolean; latest?: Point; lastComplete?: Point; onNewAccount: () => void; onCheckIn: (date: string) => void; today: string; onOpenChanges: (range: { from: string; to: string }) => void }) {
  const [structureView, setStructureView] = useState<'kind' | 'group'>(() => recallGroupViews(summary.generation).structure);
  const groupTotals = accountGroupTotals(allAccounts, groups, summary.structure_entries ?? []);
  if (!hasAccounts) return <div className="empty"><span className="empty-mark">¥</span><h2>先建立要定期核对的账户</h2><p>银行卡、证券、基金、公积金，以及信用卡和贷款。只需名称和类型，不需要卡号或登录信息。</p><div className="review-start-actions" style={{ justifyContent: 'center' }}>{onFinancialImport && <button type="button" className="primary" disabled={importDisabled} onClick={onFinancialImport}>导入已有的资产表格</button>}<button type="button" className={onFinancialImport ? 'ui-btn' : 'primary'} disabled={importDisabled} onClick={onNewAccount}>手动添加第一个账户</button></div></div>;
  if (!latest) return <><div className="empty"><span className="empty-mark">¥</span><h2>开始第一次盘点</h2><p>对照各平台，把今天的余额和欠款逐行填进来。之后每次盘点都会成为趋势上的一个点。</p><button className="primary" onClick={() => onCheckIn(today)}>更新今天的余额</button></div><OverviewAccountList summary={summary} quickPoints={summary.points} accounts={accounts} today={today} accountScope={accountScope} onQuick={onQuick} blocked={importDisabled}/></>;
  const shown = lastComplete ?? latest;
  const comparedPoint = lastComplete?.compared_to ? summary.points.find(p => p.date === lastComplete.compared_to) : undefined;
  return <>
    {!latest.complete && <div className="notice">{latest.date} 的盘点还有 {latest.missing} 个账户没有金额，未计入完整净资产和变化比较。<button onClick={() => onCheckIn(latest.date)}>补录</button></div>}
    <div className="ui-metrics ui-card">
      <article><span>金融净资产</span><strong>{lastComplete ? signedMoney(lastComplete.net_cents) : '—'}</strong><em>{lastComplete ? `截至 ${lastComplete.date} 完整盘点 · 距今 ${Math.max(0, Math.round((Date.parse(today) - Date.parse(lastComplete.date)) / 86400000))} 天${lastComplete.has_unchanged ? ' · 含沿用金额' : ''}` : '—／尚无完整盘点'}</em></article>
      <article><span>金融资产</span><strong>{money(shown.assets_cents)}</strong><em>{`${shown.date} · ${shown.complete ? '计入净资产的账户' : '仅已知部分'}`}</em></article>
      <article><span>负债</span><strong>{money(shown.liabilities_cents)}</strong><em>{`${shown.date} · ${shown.complete ? '计入净资产的尚欠金额' : '仅已知部分'}`}</em></article>
      <article><span>与上次比较</span><strong>{comparisonText(lastComplete?.change_cents, lastComplete?.compared_to)}</strong><em>{!lastComplete?.compared_to ? '至少两次完整盘点后显示' : lastComplete.scope_changed ? '有账户改变了计入设置，不直接比较' : `对比 ${lastComplete.compared_to}${lastComplete.change_rate_hundredths !== null ? ' · ' + rateText(lastComplete.change_rate_hundredths) : ''}`}</em>{comparedPoint && lastComplete && <button className="link-cell changes-link" onClick={() => onOpenChanges({ from: comparedPoint.snapshot_id, to: lastComplete.snapshot_id })}>看哪些账户带来变化 →</button>}</article>
    </div>
    {lastComplete?.has_unchanged && <p className="notice">这次完整盘点含沿用金额，并非所有账户都在当天重新核对。账户清单标明最近手动录入时间。</p>}
    <WealthTrendCards summary={summary} today={today}/>
    <div className="stats-pair">
      <article className="ui-card ui-content"><div className="ui-section-head"><h3>资产结构</h3><div className="ui-seg" role="group" aria-label="资产结构方式"><button type="button" aria-pressed={structureView === 'kind'} onClick={() => { setStructureView('kind'); rememberGroupView(summary.generation, 'structure', 'kind'); }}>按类型</button><button type="button" aria-pressed={structureView === 'group'} onClick={() => { setStructureView('group'); rememberGroupView(summary.generation, 'structure', 'group'); }}>按分组</button></div><span>{summary.structure_date ? `${summary.structure_date} 完整盘点 · 计入净资产的账户` : '尚无完整盘点'}</span></div>{structureView === 'kind' ? <ShareBars rows={summary.structure} empty="没有计入的资产。"/> : <ShareBars rows={summary.structure_date ? groupTotals.map(g => ({ kind: g.id, amount_cents: g.assets_cents, share_hundredths: g.share_hundredths })) : []} labels={Object.fromEntries(groupTotals.map(g => [g.id, g.name]))} empty="没有计入的资产。"/>}<ForeignStructure summary={summary} accounts={allAccounts}/></article>
      <article className="ui-card ui-content"><div className="ui-section-head"><h3>计入净资产的负债</h3><Info text="按类型统计尚欠金额，不含标为不计入的负债。"/></div><ShareBars rows={summary.liabilities} empty="没有计入的负债。"/></article>
    </div>
    <OverviewAccountList summary={summary} quickPoints={summary.points} accounts={accounts} today={today} accountScope={accountScope} onQuick={onQuick} blocked={importDisabled}/>
  </>;
}

function OverviewAccountList({ summary, quickPoints, accounts, today, accountScope, onQuick, blocked }: { summary: Summary; quickPoints: Point[]; accounts: Account[]; today: string; accountScope: ReactNode; onQuick: (account: Account) => void; blocked?: boolean }) {
  return <article className="ui-card"><div className="ui-section-head"><h3>账户清单</h3></div>{accountScope}{!accounts.length && <p className="muted">当前范围没有账户，可切换上方账户范围查看其他账户。</p>}<ul className="ui-rows">{accounts.map((a,i)=><li key={a.id} className="ui-row"><span className="ui-avatar" style={{background:series(i)}}>{a.fields.name.slice(0,1)}</span><div className="ui-main"><div>{a.fields.name}</div><small>{kindLabel(a.fields.kind)}{!a.fields.counted?' · 不计入净资产':''}{a.fields.closed_on?' · 已停用':''}</small></div><span className="ui-amount" style={a.fields.side==='liability'?{color:'var(--error)'}:undefined}><AccountBalance account={a} today={today} summary={summary}/></span>{quickAvailable(a, quickPoints, today) && <button type="button" className="ui-btn wealth-quick-action" disabled={blocked} onClick={() => onQuick(a)}>更新此账户</button>}</li>)}</ul></article>;
}

function WealthTrendCards({ summary, today }: { summary: Summary; today: string }) {
  const trend = useTrendSelection(summary.generation, summary.points, today);
  return <>
    <article className="ui-card ui-content">
      <div className="ui-section-head"><h3>净资产变化<Info text="只连接完整盘点；虚线为不完整盘点。变化含存取、消费与估值，不等于投资收益。"/></h3><span className="muted small">历史 · {trend.points[0]?.date ?? "暂无盘点"}{trend.points.length > 1 ? ` → ${trend.points.at(-1)!.date}` : ""}</span></div>
      <TrendRangeControl selection={trend} points={summary.points} today={today}/>
      <NetChart points={trend.points} generation={summary.generation}/>
      <details className="trend-table"><summary>查看表格</summary><PointTable points={trend.points}/></details>
    <details className="trend-secondary"><summary>查看流动资金与投资走势</summary>
      <div className="ui-section-head"><h3>流动资金与投资<Info text="流动资金是计入净资产的现金与存款；投资是计入净资产的投资账户、混合投资、基金、债券和贵金属。公积金、个人养老金、保险、房产等不在这两条线里。面积独立显示，不相加；变化含存取与估值，不等于收益。"/></h3><span className="muted small">历史余额</span></div>
      <p className="muted small">沿用上方时间范围；金额为账户余额，不代表投资收益。</p>
      <DualLineChart points={trend.points} kind="balances" generation={summary.generation}/>
    </details></article>
  </>;
}

function ShareBars({ rows, empty, labels }: { rows: Summary['structure']; empty: string; labels?: Record<string, string> }) {
  if (labels && groupAmountsHidden()) return <p className="muted">金融金额已隐藏</p>;
  if (!rows.length) return <p className="muted">{empty}</p>;
  return <ul className="stats-category-bars">{rows.map((r, i) => <li key={r.kind}><span><i style={{ background: series(i) }}/>{labels?.[r.kind] ?? kindLabel(r.kind)}</span><div className="stats-bar"><span style={{ width: r.share_hundredths === null ? 0 : `${r.share_hundredths / 100}%`, background: series(i) }}/></div><strong>{r.share_hundredths === null ? '—' : `${(r.share_hundredths / 100).toFixed(1)}%`}</strong><small>{money(r.amount_cents)}</small></li>)}</ul>;
}

function PointTable({ points, onOpen, onCompare }: { points: Point[]; onOpen?: (id: string) => void; onCompare?: (pair?: { fromSnapshotId: string; toSnapshotId: string }) => void }) {
  const [sort, setSort] = useState<ListSort>({ key: 'date', descending: true });
  const sorted = sortRecords(points, sort, (p, key) => key === 'date' ? p.date : key === 'net' ? p.complete ? moneySortValue(p.net_cents) : null : key === 'assets' ? moneySortValue(p.assets_cents) : moneySortValue(p.liabilities_cents), p => p.snapshot_id);
  return <table className="ui-table"><thead><tr><SortHeader field="date" label="盘点日期" sort={sort} onSort={setSort}/><SortHeader field="net" label="金融净资产" sort={sort} onSort={setSort}/><SortHeader field="assets" label="资产" sort={sort} onSort={setSort}/><SortHeader field="liabilities" label="负债" sort={sort} onSort={setSort}/><th>状态</th><th>备注</th><th>与上次比较</th></tr></thead><tbody>{sorted.map(p => <tr key={p.snapshot_id}>
    <td>{onOpen ? <button className="link-cell" onClick={() => onOpen(p.snapshot_id)}>{p.date}</button> : p.date}</td>
    <td>{p.complete ? signedMoney(p.net_cents) : <span className="muted" title="有账户金额未知，净资产无法确定">—</span>}</td><td>{money(p.assets_cents)}{!p.complete && <small className="muted"> 已知</small>}</td><td>{money(p.liabilities_cents)}{!p.complete && <small className="muted"> 已知</small>}</td>
    <td>{p.complete ? '完整' : `缺 ${p.missing} 个账户`}{p.has_unchanged && <small className="muted"> · 快速更新</small>}</td>
    <td>{onOpen ? (noteSummary(p.notes) ? <button className="link-cell" title="查看完整备注" onClick={() => onOpen(p.snapshot_id)}>{noteSummary(p.notes)}</button> : <span className="muted">—</span>) : noteSummary(p.notes) ?? ''}</td>
    <td>{p.change_cents ? `${changeText(p.change_cents)}${p.change_rate_hundredths !== null ? ' · ' + rateText(p.change_rate_hundredths) : ''}` : p.scope_changed ? '参与比较的账户有变化' : '—'}{p.compared_to && <small className="muted"> 对比 {p.compared_to}</small>}{onCompare && p.complete && (() => { const from = points.find(q => q.complete && q.date === p.compared_to); return from ? <> <button type="button" className="ui-link" onClick={() => onCompare({ fromSnapshotId: from.snapshot_id, toSnapshotId: p.snapshot_id })}>查看比较</button></> : null; })()}</td>
  </tr>)}</tbody></table>;
}

/** Shared with the overview hero, including keyboard browsing and unknown markers. */
export function NetChart({ points, label, generation }: { points: Point[]; label?: string; generation?: string }) {
  return <DualLineChart points={points} label={label} generation={generation} single={!!label}/>;
}

function AccountListing(props: Parameters<typeof Accounts>[0] & { mode: 'list' | 'group'; groups: AccountGroup[]; allAccounts: Account[]; summary: Summary }) {
  if (props.mode === 'list') return <Accounts {...props} quickPoints={props.summary.points} basis={props.summary}/>;
  const totals = accountGroupTotals(props.allAccounts, props.groups, props.summary.latest_entries ?? [], true);
  const partial = totals.some(g => g.partial), hidden = groupAmountsHidden();
  return <><p className="muted small">这次小计按 {props.summary.points.at(-1)?.date ?? '（暂无盘点）'} 的记录；账户归属按当前分组，小计不随搜索改变。每行区分这次填写、沿用旧金额和未列入本次的旧记录。</p>{totals.map(group => {
    const visible = props.accounts.filter(a => (props.groups.some(g => g.id === a.fields.group_id) ? a.fields.group_id : '') === group.id);
    return <section key={group.id || 'ungrouped'} className="account-group-section"><header className="account-group-head"><h3>{group.name}</h3><p>{hidden ? '金融金额已隐藏' : props.summary.points.length && (group.known > 0 || (!group.partial && !group.accounts.length)) ? <>资产 {money(group.assets_cents)} · 负债 {money(group.liabilities_cents)} · 净额 {signedMoney(group.net_cents)} · 占{partial ? '已知计入资产' : '计入资产'} {group.share_hundredths === null ? '—' : `${(group.share_hundredths / 100).toFixed(2)}%`}{group.partial ? ' · 仅已知部分（含未知或本次未涵盖账户）' : ''}</> : '金额未知，本次未涵盖或尚无已知金额'}</p></header>{visible.length ? <Accounts {...props} quickPoints={props.summary.points} basis={props.summary} accounts={visible} found={null}/> : <p className="muted small">{group.accounts.length ? '当前筛选条件下没有账户。' : '这个分组还没有账户。'}</p>}</section>;
  })}</>;
}

function Accounts({ basis, quickPoints = [], accounts, onEdit, onNew, found, onQuick, today }: { basis?: Summary; quickPoints?: Point[]; onQuick: (account: Account) => void; today: string; accounts: Account[]; onEdit: (a: Account) => void; onNew: () => void; found: number | null }) {
  const [sort, setSort] = useState<ListSort>({ key: 'name', descending: false });
  const sorted = sortRecords(accounts, sort, (a, key) => key === 'name' ? a.fields.name : key === 'kind' ? (a.fields.side === 'liability' ? '负债 · ' : '') + kindLabel(a.fields.kind) : key === 'counted' ? Number(a.fields.counted) : key === 'status' ? Number(!!a.fields.closed_on) : moneySortValue(accountBalanceView(a, basis?.points.at(-1)?.date, basis?.latest_entries).fact?.amount_cents), a => a.id);
  if (!accounts.length) return <div className="empty"><h2>当前范围没有账户</h2><p>可以切换上方账户范围，或添加新的账户。</p><button className="primary" onClick={onNew}>新增账户</button></div>;
  return <>{found !== null && <p className="muted small" role="status">找到 {found} 条</p>}<div className="table-scroll"><table className="ui-table wealth-accounts"><thead><tr><SortHeader field="name" label="账户" sort={sort} onSort={setSort}/><SortHeader field="kind" label="类型" sort={sort} onSort={setSort}/><SortHeader field="counted" label="计入净资产" sort={sort} onSort={setSort}/><SortHeader field="amount" label="最近盘点金额" sort={sort} onSort={setSort}/><SortHeader field="status" label="状态" sort={sort} onSort={setSort}/><th>操作</th></tr></thead><tbody>{(sort.key === 'status' ? sorted : [...sorted].sort((a,b) => Number(!!a.fields.closed_on)-Number(!!b.fields.closed_on))).map(a => <tr key={a.id} className={a.fields.closed_on ? 'closed' : undefined}>
    <td><button className="link-cell" onClick={() => onEdit(a)}>{a.fields.name}</button>{a.fields.institution && <small className="muted"> · {a.fields.institution}</small>}</td>
    <td>{a.fields.side === 'liability' ? '负债 · ' : ''}{kindLabel(a.fields.kind)}</td>
    <td>{a.fields.counted ? '计入' : '不计入'}</td>
    <td><AccountBalance account={a} today={today} summary={basis}/></td>
    <td>{a.fields.closed_on ? `${a.fields.closed_on} 停用` : `${a.fields.opened_on} 起`}</td><td>{quickAvailable(a, quickPoints, today) ? <button type="button" className="ui-btn" onClick={() => onQuick(a)}>更新此账户</button> : <span className="muted">请到盘点记录更正</span>}</td>
  </tr>)}</tbody></table></div></>;
}

function History({ points, onOpen, onCompare, onNew, canStart }: { points: Point[]; onOpen: (id: string) => void; onCompare?: (pair?: { fromSnapshotId: string; toSnapshotId: string }) => void; onNew: () => void; canStart: boolean }) {
  if (!points.length) return <div className="empty"><h2>还没有盘点</h2><p>每次盘点记录一个日期上各账户的余额与欠款。完整表示应盘账户都有金额；快速更新可能沿用旧值，不代表全部重新核对。</p><button className="primary" disabled={!canStart} onClick={onNew}>更新今天的余额</button></div>;
  return <><p className="muted small">完整表示应盘账户都有金额；快速更新可能沿用旧值，不代表全部重新核对。{onCompare && <> <button type="button" className="ui-link" onClick={() => onCompare()}>比较任意两次盘点 →</button></>}</p><div className="table-scroll"><PointTable points={points} onOpen={onOpen} onCompare={onCompare}/></div></>;
}

const blankAccount = (today: string): AccountFields => ({ name: '', institution: '', side: 'asset', kind: 'cash', counted: true, opened_on: today, closed_on: null, notes: '' });

function AccountDialog({ quickPoints = [], groups = [], onGroupsChanged, account, generation, today, onClose, onQuick }: { quickPoints?: Point[]; groups?: AccountGroup[]; onGroupsChanged?: () => void; onQuick: (account: Account) => void; account: Account | null; generation: string; today: string; onClose: (saved: boolean, createdName?: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fields, setFields] = useState<AccountFields>(account?.fields ?? blankAccount(today));
  const [createGroup, setCreateGroup] = useState(false), [groupName, setGroupName] = useState(''), [createdGroup, setCreatedGroup] = useState<AccountGroup | null>(null);
  const groupCreating = useRef(false);
  const availableGroups = createdGroup && !groups.some(g => g.id === createdGroup.id) ? [...groups, createdGroup] : groups;
  async function saveGroup() {
    if (groupCreating.current || busy || stuck || storedPending()) return;
    const problem = groupNameError(groupName); if (problem) { setNotice(problem); return; }
    groupCreating.current = true; setBusy(true); setNotice('');
    try { const g = await submit<AccountGroup>({ command: 'account_group_save', input: { request_id: crypto.randomUUID(), generation, id: null, expected_revision: null, name: groupName.trim() }, label: '新增账户分组' }); setCreatedGroup(g); setFields(f => ({ ...f, group_id: g.id })); setCreateGroup(false); setGroupName(''); onGroupsChanged?.(); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { groupCreating.current = false; setBusy(false); }
  }
  async function verifyGroup() {
    const request = storedPending(); if (!request || request.command !== 'account_group_save' || groupCreating.current) return;
    groupCreating.current = true; setBusy(true);
    try {
      const result = await resolvePending(request);
      if (result === 'saved') { const g = await submit<AccountGroup>(request); setCreatedGroup(g); setFields(f => ({ ...f, group_id: g.id })); setCreateGroup(false); setNotice('已确认分组已保存，账户输入仍保留。'); }
      else setNotice('分组没有保存，输入已保留，可以重新创建。');
      setStuck(false); onGroupsChanged?.();
    } catch (e) { setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { groupCreating.current = false; setBusy(false); }
  }
  const [countedChoice, setCountedChoice] = useState<boolean | null>(account?.fields.counted ?? null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('wealth-account-name')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof AccountFields>(k: K, v: AccountFields[K]) => setFields(f => ({ ...f, [k]: v }));
  async function save() {
    if (!fields.name.trim()) { setNotice('请填写账户名称。'); document.getElementById('wealth-account-name')?.focus(); return; }
    if (!validCurrency(currencyCode(fields.currency))) { setNotice("币种须为三位大写字母。"); return; }
    const normalized = { ...fields }; if (normalized.currency === "CNY") delete normalized.currency; if (!normalized.holding_mode) { delete normalized.holding_mode; delete normalized.holding_unit; } if(normalized.holding_unit==null)delete normalized.holding_unit;
    const input: AccountSave = { request_id: crypto.randomUUID(), generation, id: account?.id ?? null, expected_revision: account?.revision ?? null, fields: { ...normalized, name: fields.name.trim(), institution: fields.institution.trim() } };
    setBusy(true); setNotice('');
    try { await submit({ command: 'wealth_account_save', input, label: `账户 ${input.fields.name}` }); onClose(true, account ? undefined : input.fields.name); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="wealth-account-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">财富 · 账户</p><h2 id="wealth-account-heading">{account ? '编辑账户' : '新增账户'}</h2><p className="muted">只记名称与类型，不需要卡号、密码或登录信息。{account?.latest ? '已有盘点记录的账户不能删除，可填写停用日期。' : ''}</p></div><CloseButton type="button" aria-label="关闭账户表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{account && quickAvailable(account, quickPoints, today) && <button type="button" disabled={busy || stuck || currencyCode(fields.currency) !== currencyCode(account.fields.currency) || !!fields.holding_mode !== !!account.fields.holding_mode} onClick={() => onQuick(account)}>更新此账户</button>}{account && !account.latest && !stuck && <DeleteButton label="删除误建账户" disabled={busy} kind="account" id={account.id} revision={account.revision} generation={generation} name={`账户 ${account.fields.name}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存账户'}</button>}</div></header>
    {account && currencyCode(fields.currency) !== currencyCode(account.fields.currency) && <p className="notice">请先保存币种，再打开快速更新。</p>}
    {account && !!fields.holding_mode !== !!account.fields.holding_mode && <p className="notice">请先保存录入方式，再打开快速更新。</p>}
    <section className="form-block">
      <FormRow label="名称"><input id="wealth-account-name" aria-label="账户名称" maxLength={80} value={fields.name} disabled={busy || stuck} onChange={e => set('name', e.target.value)} placeholder="例如 招行储蓄卡"/></FormRow>
      <FormRow label="平台" hint="银行、券商等机构，可留空；不决定账户分组"><input aria-label="平台" maxLength={80} value={fields.institution} disabled={busy || stuck} onChange={e => set('institution', e.target.value)} placeholder="可留空"/></FormRow>
      <FormRow label="币种" hint={account?.has_entries ? '已有记录的账户不能更改币种，请新建账户并停用旧账户。' : '汇率手填，不联网；未列出的币种按两位小数处理。'}><input aria-label="账户币种" list="wealth-currencies" maxLength={3} value={currencyCode(fields.currency)} disabled={busy || stuck || !!account?.has_entries} onChange={e => set('currency', e.target.value.toUpperCase())}/><datalist id="wealth-currencies">{currencies.map(([code,name])=><option key={code} value={code}>{name}</option>)}</datalist></FormRow>
      <FormRow label="类型" hint={account ? '资产或负债建立后不能更改' : '选了类型就知道是资产还是负债：信用卡、贷款等是负债，盘点时填欠款金额'}><select aria-label="类型" value={fields.kind} disabled={busy || stuck} onChange={e => { const kind = e.target.value; if (!['property','vehicle'].includes(kind) && (fields.purchase_cents != null || fields.purchased_on || account?.fields.purchase_cents != null || account?.fields.purchased_on)) { setNotice('请先清空并保存购入价和购入日期，再更改类型'); return; } setNotice(''); setFields(f => ({...selectAccountKind(f, kind, countedChoice),...(!holdingSupported(kind)?{holding_mode:false,holding_unit:null}:{})})); }}>
        {(!account || fields.side === 'asset') && <optgroup label="资产">{assetKinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>}
        {(!account || fields.side === 'liability') && <optgroup label="负债">{liabilityKinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>}
      </select></FormRow>
      {accountKindHint(fields.kind) && <p className="muted small">{accountKindHint(fields.kind)}</p>}
      {account && fields.kind === 'property' && account.fields.kind !== 'property' && <p className="notice">以后盘点不再计入金融净资产；既有盘点保持原记录。</p>}
      <FormRow label="计入金融净资产" hint={fields.kind === 'property' ? '房产固定不计入' : fields.side === 'liability' ? '房贷、车贷等可关闭' : `此类型新建建议：${defaultAccountCounted(fields.kind) ? '计入' : '不计入'}`}><Switch label="计入金融净资产" value={fields.counted} disabled={busy || stuck || fields.kind === 'property'} onChange={v => { setCountedChoice(v); set('counted', v); }}/></FormRow>
      {holdingSupported(fields.kind) && <><FormRow label="按持仓记录" hint="通常直接填平台总余额就够了。想用份额和单价算金额时再开启；一个账户一个持仓，不记录交易成本或收益。"><Switch label="按持仓记录" value={!!fields.holding_mode} disabled={busy || stuck} onChange={value=>setFields(f=>({...f,holding_mode:value,...(!value?{holding_unit:null}:{})}))}/></FormRow>{fields.holding_mode && <FormRow label="持仓单位" hint="可留空，默认显示份；最多8字"><input aria-label="持仓单位" maxLength={8} value={fields.holding_unit??''} disabled={busy||stuck} onChange={e=>set('holding_unit',e.target.value||null)}/></FormRow>}</>}
      <FormRow label="分组" hint="只影响查看；未分组也可以正常盘点和规划"><select aria-label="账户分组" value={fields.group_id ?? ''} disabled={busy || stuck} onChange={e => { if (e.target.value === '__new__') setCreateGroup(true); else set('group_id', e.target.value || null); }}><option value="">未分组</option>{availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}<option value="__new__">新建分组…</option></select>{createGroup && <div className="account-group-create">{stuck && <button type="button" disabled={busy} onClick={() => void verifyGroup()}>核对分组结果</button>}<input aria-label="就地新建分组名称" value={groupName} maxLength={40} disabled={busy || stuck} onChange={e => setGroupName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveGroup(); } }}/><button type="button" disabled={busy || stuck || !groupName.trim()} onClick={() => void saveGroup()}>创建并选择</button><button type="button" disabled={busy || stuck} onClick={() => setCreateGroup(false)}>取消</button></div>}</FormRow>
      <FormRow label="启用日期" hint="此日之前的盘点不要求填写"><DateInput yearIntent="past" id="wealth-account-opened" value={fields.opened_on} max={today} disabled={busy || stuck} onChange={v => set('opened_on', v)}/></FormRow>
      {account && <FormRow label="停用日期" hint="停用后不再出现在之后的盘点里；有盘点记录的账户只能停用，不能删除。"><DateInput yearIntent="past" id="wealth-account-closed" value={fields.closed_on ?? ''} max={today} allowClear disabled={busy || stuck} onChange={v => set('closed_on', v || null)}/></FormRow>}
      {['property', 'vehicle'].includes(fields.kind) && <>
        <FormRow label="购入价" hint="可留空；仅用于显示估值涨跌，不参与净资产或规划计算"><CentInput label="购入价" value={fields.purchase_cents ?? ''} disabled={busy || stuck} onChange={v => set('purchase_cents', v || null)}/></FormRow>
        <FormRow label="购入日期" hint="可留空"><DateInput yearIntent="past" id="wealth-account-purchased" value={fields.purchased_on ?? ''} min="1900-01-01" max={today} allowClear disabled={busy || stuck} onChange={v => set('purchased_on', v || null)}/></FormRow>
      </>}
    </section>
    <section className="form-block form-notes"><label htmlFor="wealth-account-notes">备注</label><textarea id="wealth-account-notes" maxLength={10000} value={fields.notes} disabled={busy || stuck} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}

/** Two-step soft delete into 最近删除; the second click confirms. */
export function DeleteButton({ label, disabled, kind, id, revision, generation, name, onDone, onError, onBusyChange }: { onBusyChange?: (busy: boolean) => void; label: string; disabled: boolean; kind: TrashKind; id: string; revision: number; generation: string; name: string; onDone: () => void; onError: (message: string, stuck: boolean) => void }) {
  const [armed, setArmed] = useState(false), [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true); onBusyChange?.(true);
    try {
      await submit({ command: 'wealth_trash', input: { request_id: crypto.randomUUID(), generation, kind, id, expected_revision: revision, deleted: true }, label: '删除' + name });
      onDone();
      // A delete bumps the revision once; the undo restores exactly that state.
      offerUndo(`已删除「${name}」，已移入最近删除。`, () => submit<void>({ command: 'wealth_trash', input: { request_id: crypto.randomUUID(), generation, kind, id, expected_revision: revision + 1, deleted: false }, label: '恢复' + name }));
    }
    catch (e) { onError(e instanceof Error ? e.message : errorMessage(e), e instanceof Unresolved); setArmed(false); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return armed ? <button type="button" className="primary danger" disabled={disabled || busy} onClick={() => void remove()}>{busy ? '正在删除…' : '确认移入最近删除'}</button>
    : <button type="button" disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
}

type Row = CheckInRow;
/** 只读盘点详情（§5.2）：按稳定 snapshot ID 读取，浏览不写任何资料。 */
function SnapshotDetail({ id, onCorrect, onClose }: { id: string; onClose: () => void; onCorrect: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState('');
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  useEffect(() => {
    let live = true; setError(''); setSnapshot(null);
    Promise.all([invoke<Snapshot | null>('wealth_snapshot', { id }), invoke<Account[]>('wealth_accounts')])
      .then(([s, a]) => { if (live) { setAccounts(a); setSnapshot(s); } })
      .catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [id]);
  usePageBar('wealth', {});
  if (error) return <section className="stats-section wealth-section check-in" aria-labelledby="snapshot-detail-heading"><header className="check-in-header"><button className="back" onClick={onClose}><Icon name="back"/> 返回财富</button><div><h2 id="snapshot-detail-heading">盘点详情</h2></div></header><div role="alert"><p>盘点读取失败：{error}</p><button onClick={() => onClose()}>返回</button></div></section>;
  if (!snapshot || !accounts) return <section className="stats-section wealth-section check-in" aria-labelledby="snapshot-detail-heading"><header className="check-in-header"><button className="back" onClick={onClose}><Icon name="back"/> 返回财富</button><div><h2 id="snapshot-detail-heading">盘点详情</h2></div></header><p role="status" className="muted">正在读取盘点…</p></section>;
  const stateText = (state: string, amount: string | null) => amount === null ? '未知' : state === 'unchanged' ? '沿用' : '录入';
  return <section className="stats-section wealth-section check-in" aria-labelledby="snapshot-detail-heading">
    <header className="check-in-header"><button className="back" onClick={onClose}><Icon name="back"/> 返回财富</button><div><h2 id="snapshot-detail-heading">盘点详情</h2><p className="muted">只读查看，不改动任何资料。</p></div><div className="field check-in-date"><label>盘点日期</label><output>{snapshot.date}</output></div></header>
    {snapshot.entries.some(e => e.state === 'unchanged') && <p className="notice">快速更新 · 含沿用金额，没有未知账户时仍是完整盘点。</p>}
    {(['entered', 'unchanged', 'missing'] as const).map(state => {
      const entries = snapshot.entries.filter(entry => entry.state === state);
      if (!entries.length) return null;
      return <section key={state}><h3>{state === 'entered' ? '本次填写' : state === 'unchanged' ? '沿用' : '金额未知'}</h3><table className="ui-table check-in-table"><thead><tr><th>账户</th><th>记录金额</th><th>状态</th><th>计入</th></tr></thead><tbody>{entries.map(e => { const a = accounts.find(x => x.id === e.account_id); return <tr key={e.account_id}><td><strong>{a?.fields.name ?? e.account_id}</strong><small className="muted">{e.side === 'liability' ? '负债' : kindLabel(e.kind)}</small></td><td><CurrencyBalance unit={a?.fields.holding_mode?(a.fields.holding_unit??"份"):null} code={a?.fields.currency} fact={e} date={snapshot.date}/></td><td>{stateText(e.state, e.amount_cents)}</td><td>{e.counted ? '计入' : '不计入'}</td></tr>; })}</tbody></table></section>;
    })}
    <footer className="check-in-footer"><div><span>完整性</span><strong>{snapshot.missing.length === 0 ? '完整' : `缺 ${snapshot.missing.length} 个账户`}</strong></div>
      <div className="check-in-submit"><button className="primary" onClick={() => onCorrect(snapshot.id)}>更正这次盘点</button></div></footer>
    <section className="form-block form-notes snapshot-notes"><h3>备注</h3>{snapshot.notes.trim() ? <p className="notes" style={{whiteSpace:'pre-wrap'}}>{snapshot.notes}</p> : <p className="muted">未填写备注</p>}</section>
  </section>;
}
function CheckIn({ date: initial, today, onClose, expectedId, accountDialog }: { accountDialog?: (onDone: (saved: boolean) => void) => ReactNode; expectedId?: string; date: string; today: string; onClose: (saved: boolean, snapshot?: Snapshot) => void }) {
  const [date, setDate] = useState(initial);
  // The source's stable-ID guard holds only while its own date is being viewed:
  // once the user deliberately switches dates, this is a normal check-in again.
  const [pin, setPin] = useState(expectedId);
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState('');
  const [notes, setNotes] = useState(''), [notesDirty, setNotesDirty] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string,string>>({});
  const [closing, setClosing] = useState<ReadonlySet<string>>(() => new Set()), [adding, setAdding] = useState(false), [reads, setReads] = useState(0);
  const table = useRef<HTMLTableElement>(null);
  const focusedField = useRef<string | null>(null);
  const fromSaved = useRef(false);
  useEffect(() => {
    let live = true; setError(''); setDraft(null);
    invoke<Draft>('wealth_snapshot_draft', { date }).then(d => {
      if (!live) return;
      // A deleted source snapshot must not reopen as the same-day replacement
      // or as a brand-new check-in; the user returns and re-reads instead.
      if (pin && d.existing?.id !== pin) { setError('这条盘点已删除或变化，请返回后重新读取。'); return; }
      setDraft(d);
      setRates(Object.fromEntries(Object.entries(rateSuggestions(d)).map(([c,s])=>[c,s.rate])));
      // Notes belong to the snapshot of the viewed date; a new date starts empty.
      setNotes(d.existing?.notes ?? '');
      setNotesDirty(false);
      // Only values typed for a new check-in follow a date change. Amounts loaded
      // from a saved check-in never carry to another date unreviewed (17.4 #2).
      setRows(old => {
        const carry = fromSaved.current ? {} : old;
        fromSaved.current = !!d.existing;
        return Object.fromEntries(d.rows.map(r => {
          const saved = d.existing?.entries.find(e => e.account_id === r.account.id);
          return [r.account.id, saved ? { state: saved.state, cents: saved.amount_cents ?? '', original_minor: saved.original_minor, fx_rate_micro: saved.fx_rate_micro, quantity_e8:saved.quantity_e8,unit_price_e6:saved.unit_price_e6 } : carry[r.account.id] ?? { state: null, cents: '' }];
        }));
      });
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [date, pin, reads]);
  useEffect(() => setClosing(new Set()), [date]);
  const toggleClose = (id: string, on: boolean) => setClosing(old => { const next = new Set(old); if (on) next.add(id); else next.delete(id); return next; });
  const set = (id: string, row: Row) => {
    setRows(r => ({ ...r, [id]: { ...row, edited: true } }));
    setNotice('');
  };
  const setForeign = (id: string, code: string, original: string, rate: string) => {
    let cents = ''; try { if (original !== '') cents = convertCurrency(code, original, rate); } catch { /* missing/invalid rate blocks save */ }
    set(id, { state: original === '' ? null : 'entered', cents, original_minor: original || null, fx_rate_micro: rate || null });
  };
  const setHolding = (id: string, code: string, q: string, p: string, rate: string) => {
    let fact: CurrencyFact = {amount_cents:null}; try { fact=holdingFact(code,q,p,rate); } catch { /* component error or missing data blocks save */ }
    set(id,{state:q!==''&&p!==''?'entered':null,cents:fact.amount_cents??'',quantity_e8:q||null,unit_price_e6:p||null,original_minor:fact.original_minor,fx_rate_micro:fact.fx_rate_micro});
  };
  const changeRate = (code: string, rate: string) => {
    setRates(old => ({ ...old, [code]: rate }));
    for (const r of draft?.rows ?? []) if (currencyCode(r.account.fields.currency) === code && rows[r.account.id]?.edited && rows[r.account.id]?.state === 'entered') { const row=rows[r.account.id]; if(r.account.fields.holding_mode)setHolding(r.account.id,code,row.quantity_e8??'',row.unit_price_e6??'',rate);else setForeign(r.account.id,code,row.original_minor??'',rate); }
  };
  const all = draft?.rows ?? [], existing = draft?.existing ?? null;
  const open = all.filter(r => !closing.has(r.account.id));
  const unfilled = open.filter(r => !rows[r.account.id]?.state || rows[r.account.id].state === 'missing' || rows[r.account.id].cents === '');
  const totals = previewTotals(open.map(r => ({ side: r.account.fields.side, counted: existing?.entries.find(e => e.account_id === r.account.id)?.counted ?? r.account.fields.counted, cents: rows[r.account.id]?.state && rows[r.account.id].state !== 'missing' && rows[r.account.id].cents !== '' ? rows[r.account.id].cents : null })));
  const before = existing ? previewTotals(existing.entries.map(e => ({ side: e.side, counted: e.counted, cents: e.amount_cents }))) : null;
  function focusNext(from: HTMLElement) {
    const inputs = [...(table.current?.querySelectorAll<HTMLInputElement>('[data-amount-wrap] input') ?? [])];
    inputs[inputs.indexOf(from as HTMLInputElement) + 1]?.focus();
  }
  function locateNextUnfilled() {
    const scope = table.current?.closest('section.check-in');
    if (!scope) return;
    const targets = checkInUnfilledTargets(open.map(r => ({ id: r.account.id, name: r.account.fields.name, currency: currencyCode(r.account.fields.currency), holding_mode: !!r.account.fields.holding_mode })), rates, rows);
    const controls = [...scope.querySelectorAll<HTMLElement>('[data-check-in-field]')];
    const candidates = targets.map(target => ({ key: target.key, input: controls.find(control => control.dataset.checkInField === target.key)?.querySelector<HTMLInputElement>('input:not(:disabled)') })).filter(target => !!target.input);
    const key = nextUnfilledLabel(candidates.map(target => target.key), focusedField.current);
    candidates.find(target => target.key === key)?.input?.focus();
  }
  async function save() {
    if (!draft) return;
    if (unfilled.length) { setNotice(`还有 ${unfilled.length} 个账户未填写：填写本次金额，零余额请填 0。`); locateNextUnfilled(); return; }
    if ([...notes].length > 10000 || notes.includes('\0')) { setNotice('备注最多 10000 字，且不能含空字符。'); return; }
    const plain: SnapshotSave = { request_id: crypto.randomUUID(), generation: draft.generation, id: existing?.id ?? null, expected_revision: existing?.revision ?? null, date, notes, entries: open.map(r => snapshotEntryInput(r.account.id, rows[r.account.id])) };
    const input = applyClosing(plain, all.map(r => r.account), closing);
    setBusy(true); setNotice('');
    try { const snapshot = await submit<Snapshot>({ command: 'wealth_snapshot_save', input, label: closing.size ? `${date} 盘点并停用 ${closing.size} 个账户` : `${date} 盘点` }); onClose(true, snapshot); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  let hidden = false; try { hidden = localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; } catch { /* unavailable preference */ }
  const frozen = busy || stuck;
  return <section className="stats-section wealth-section check-in" aria-labelledby="check-in-heading" onFocusCapture={event => { if (event.target instanceof HTMLInputElement) focusedField.current = event.target.closest<HTMLElement>('[data-check-in-field]')?.dataset.checkInField ?? null; }}>
    <header className="check-in-header">
      <button className="back" disabled={busy} onClick={() => onClose(false)}><Icon name="back"/> 返回财富</button>
      <div><h2 id="check-in-heading">{date === today ? '更新今天的余额' : existing ? '更正过去的余额记录' : '补记过去的余额'}</h2><p className="muted">对照所选日期填写每个账户的余额或欠款，确定是零就填 0，不知道的金额不要填成零。余额没有变化时，点「与上次相同」即可确认。回车跳到下一行；填齐后保存，关闭即放弃未保存的输入。</p></div>
      <div className="field check-in-date"><label htmlFor="check-in-date">盘点日期</label>{switchTo ? <div className="check-in-date-switch" role="alert"><p>切换日期将丢弃当前备注修改。</p><button type="button" onClick={() => setSwitchTo(null)}>取消</button><button type="button" className="primary" onClick={() => { const target = switchTo; setSwitchTo(null); setNotesDirty(false); setPin(undefined); if (target) setDate(target); }}>确认切换</button></div> : null}<DateInput yearIntent="past" id="check-in-date" value={date} max={today} disabled={frozen || !!switchTo} onChange={v => { if (!v) return; if (notesDirty) { setSwitchTo(v); return; } setPin(undefined); setDate(v); }}/></div>
    </header>
    {existing && draft && <div className="notice">这一天已有盘点，保存会更正原记录，并影响它与前后两次盘点的比较。<DeleteButton label="删除这次盘点" disabled={frozen} kind="snapshot" id={existing.id} revision={existing.revision} generation={draft.generation} name={`${date} 盘点`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/></div>}
    {error ? <div role="alert"><p>盘点读取失败：{error}</p></div> : !draft ? <p role="status" className="muted">正在准备盘点…</p> : !all.length ? <div className="empty"><p>这一天没有需要填写余额的账户。可以添加账户，或检查已有账户的启用、停用日期。</p><button type="button" className="ui-btn" onClick={() => onClose(false)}>返回财富</button></div> : <>
      {open.some(r=>currencyCode(r.account.fields.currency)!=='CNY') && <section className="form-block"><h3>本次汇率</h3><p className="muted small">每单位原币兑换的人民币，只用于本次修改金额的账户；未改动的历史金额保留各自汇率。不联网取汇率。</p>{[...new Set(open.map(r=>currencyCode(r.account.fields.currency)).filter(c=>c!=='CNY'))].map(code=>{const suggestion=rateSuggestions(draft)[code];return <FormRow key={code} label={`${code} 汇率`} hint={suggestion?`${suggestion.date}记录的汇率；可修改。`:'没有历史汇率，请手动填写。'}><span data-check-in-field={`rate:${code}`}><CurrencyInput label={`${code} 汇率`} places={6} value={rates[code]??''} disabled={frozen} onChange={v=>changeRate(code,v)}/></span></FormRow>;})}</section>}
      <table ref={table} className="ui-table check-in-table"><thead><tr><th>账户</th><th>上次金额</th><th>本次金额</th><th>差额</th></tr></thead><tbody>{all.map(({ account: a, previous }) => {
        const row = rows[a.id] ?? { state: null, cents: '' };
        if (closing.has(a.id)) return <tr key={a.id} data-state="closing" className="check-in-closing"><td><s><strong>{a.fields.name}</strong></s><small className="muted">{kindLabel(a.fields.kind)}</small></td><td>{previous ? <CurrencyBalance unit={a.fields.holding_mode?(a.fields.holding_unit??"份"):null} code={a.fields.currency} fact={previous} date={previous.date}/> : <span className="muted">无</span>}</td><td colSpan={2}>已注销，从 {date} 起停用；余额视为已转出，不用填。 <button type="button" className="ui-link" disabled={frozen} onClick={() => toggleClose(a.id, false)}>撤销</button></td></tr>;
        const previousRow = previousCheckInRow(a, previous);
        const diff = row.state && row.state !== 'missing' && row.cents !== '' && previous ? (BigInt(row.cents) - BigInt(previous.amount_cents)).toString() : null;
        return <tr key={a.id} data-state={row.state ?? 'empty'}>
          <td><strong>{a.fields.name}</strong><small className="muted">{a.fields.side === 'liability' ? '负债 · 尚欠' : kindLabel(a.fields.kind)}{a.fields.counted ? '' : ' · 不计入'}</small>{draft && canCloseInCheckIn(draft, a) && <button type="button" className="ui-link check-in-close-link" disabled={frozen} onClick={() => toggleClose(a.id, true)}>已注销，从这次起停用</button>}{(existing?.entries.find(e=>e.account_id===a.id)??previous)?.amount_cents!=null && !!a.fields.holding_mode !== ((existing?.entries.find(e=>e.account_id===a.id)??previous)?.quantity_e8!=null) && <small className="notice">从这次开始按{a.fields.holding_mode?'持仓':'余额'}记录；未改动的历史金额保持原样。</small>}</td>
          <td>{previous ? <CurrencyBalance unit={a.fields.holding_mode?(a.fields.holding_unit??"份"):null} code={a.fields.currency} fact={previous} date={previous.date}/> : <span className="muted">无</span>}</td>
          <td onKeyDown={e => { if (e.target instanceof HTMLInputElement && enterJumpsAmount(e.key, e.nativeEvent.isComposing, true)) { e.preventDefault(); focusNext(e.target); } }}>
            <span data-amount-wrap data-check-in-field={a.fields.holding_mode ? undefined : `amount:${a.id}`}>{a.fields.holding_mode ? <div className="holding-check-in"><label data-check-in-field={`quantity:${a.id}`}>份额<HoldingInput label={`${a.fields.name} 份额`} places={8} value={row.quantity_e8??''} disabled={frozen} onChange={q=>setHolding(a.id,currencyCode(a.fields.currency),q,row.unit_price_e6??'',rates[currencyCode(a.fields.currency)]??'')}/></label>{previous?.quantity_e8 != null && !row.quantity_e8 && <button type="button" className="ui-link" disabled={frozen} onClick={() => setHolding(a.id,currencyCode(a.fields.currency),previous.quantity_e8!,row.unit_price_e6??'',rates[currencyCode(a.fields.currency)]??'')}>沿用上次份额</button>}<label data-check-in-field={`price:${a.id}`}>单价（{currencyCode(a.fields.currency)}）<HoldingInput label={`${a.fields.name} 单价`} places={6} value={row.unit_price_e6??''} disabled={frozen} onChange={p=>setHolding(a.id,currencyCode(a.fields.currency),row.quantity_e8??'',p,rates[currencyCode(a.fields.currency)]??'')}/></label><small className="muted">{previous?.unit_price_e6!=null?(hidden?'上次单价 ••••':`上次单价 ${rateLabel(previous.unit_price_e6)} ${currencyCode(a.fields.currency)}，仅供参考`):'没有上次单价，手动填写。'}</small><output>{row.cents?(hidden?'••••':`= ${money(row.cents)}`):'请填写份额、单价及所需汇率'}</output></div> : currencyCode(a.fields.currency)==='CNY' ? <CentInput label={`${a.fields.name} 本次金额`} value={row.cents} disabled={frozen} placeholder="0.00" onChange={v => set(a.id, { state: v === '' ? null : 'entered', cents: v })}/> : <><label>{currencyCode(a.fields.currency)} 原币金额<CurrencyInput label={`${a.fields.name} 原币金额`} places={currencyDecimals(currencyCode(a.fields.currency))} value={row.original_minor??''} disabled={frozen} onChange={v=>setForeign(a.id,currencyCode(a.fields.currency),v,rates[currencyCode(a.fields.currency)]??'')}/></label><small className="muted">{hidden && row.cents ? '••••' : row.cents ? <>≈ {money(row.cents)} · 汇率 {row.fx_rate_micro ? rateLabel(row.fx_rate_micro) : '待填'}</> : '请填写原币金额与大于0的汇率'}</small></>}</span>
            {previousRow && <button type="button" className="ui-link check-in-same" disabled={frozen} aria-label={`确认${a.fields.name}与上次相同`} title="确认这次金额与上次相同；外币汇率、份额和单价也保留上次记录，可再修改。" onClick={() => { if (!frozen) set(a.id, previousRow); }}>与上次相同</button>}
          </td>
          <td>{diff === null ? <span className="muted">—</span> : diff === '0' ? '持平' : changeText(diff)}</td>
        </tr>; })}</tbody></table>
      <p><button type="button" className="ui-btn" disabled={frozen} onClick={() => setAdding(true)}>+ 新增账户</button></p>
      <section className="form-block form-notes check-in-notes"><label htmlFor="check-in-notes">本次盘点备注（可选）</label><textarea id="check-in-notes" rows={3} maxLength={10000} placeholder="记录这次盘点的背景，例如大额购买、账户调整；备注不参与金额计算" value={notes} disabled={frozen} onChange={e => { setNotes(e.target.value); setNotesDirty(true); }}/></section>
      <footer className="check-in-footer">
        <div><span>金融资产{totals.missing || unfilled.length ? "（已填小计）" : ""}</span><strong>{money(totals.assets)}</strong></div><div><span>负债{totals.missing || unfilled.length ? "（已填小计）" : ""}</span><strong>{money(totals.liabilities)}</strong></div>
        <div><span>金融净资产{totals.missing || unfilled.length ? '（待填写）' : ''}</span><strong>{totals.missing || unfilled.length ? "—" : signedMoney(totals.net)}</strong>{before && <small className="muted">原记录 {signedMoney(before.net)}</small>}</div>
        <div className="check-in-submit">{unfilled.length > 0 && <><span className="muted">还有 {unfilled.length} 个账户未填写</span><button type="button" className="ui-btn" disabled={frozen} onClick={locateNextUnfilled}>定位下一处未填</button></>}{stuck ? <button type="button" onClick={() => onClose(false)}>返回，稍后核对</button> : <button className="primary" disabled={frozen} onClick={() => void save()}>{busy ? '保存中…' : date === today ? '保存今天的余额' : existing ? '保存更正' : '保存这次余额'}</button>}</div>
      </footer>
    </>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {adding && accountDialog?.(saved => { setAdding(false); if (saved) setReads(n => n + 1); })}
  </section>;
}
