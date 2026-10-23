import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info } from './FormControls';
import { HeaderSlot } from './HeaderSlot';
import { PlanningGoalOccurrences } from './PlanningGoalOccurrences';
import { PlanningBasicGoals } from './PlanningBasicGoals';
import { PlanningSetupDialog } from './PlanningSetup';
import { PlanningCurrentReportDialog } from './PlanningCurrentReportDialog';
import { currentReportInput } from './planning-report/current-adapter';
import type { ReportInputV1 } from './planning-report/model';
import { buildBasicCapabilities } from './plan-basic';
import { nativePlanningFollowupPortV1 } from './planning-followup-port';
import type { PlanningFollowupPortV1 } from './planning-followup-contract';
import './planning-followup-ui/planning-followup-ui.css';
import { usePlanningSources } from './planning-basic-data';
import { modeOf } from './planning-basic-view';
import { ready } from './review';
import { usePageBar } from './topbar';
import { refocusHeading } from './topbar-model';
import { useRestored } from './undo';
import { storedPending } from './wealth';
import { usePendingReceipt } from './WealthPage';
import './wealth.css';
import './planning.css';

import type { PlanningView } from './planning-view';
import { t } from './i18n.ts';
export type { PlanningView } from './planning-view';

export type PlanningTab = 'goals' | 'savings';

export function PlanningPage({ today, onTab, onEditingChange, focus = null, onFocusDone, view: controlledView, onViewChange, navigationBlocked = false, onNavigationBlocked, followupPort: injectedPort }: { focus?: 'budget' | 'profile' | null; onFocusDone: () => void; today: string; onTab: (tab: PlanningTab) => void; onEditingChange: (value: boolean) => void; followupPort?: PlanningFollowupPortV1; view?: PlanningView; onViewChange?: (view: PlanningView) => void; navigationBlocked?: boolean; onNavigationBlocked?: () => void }) {
  const nativePort = useMemo(() => nativePlanningFollowupPortV1(), []);
  const followupPort = injectedPort ?? nativePort;
  const { load, reload } = usePlanningSources(today);
  const [localView, setLocalView] = useState<PlanningView>('goals');
  const view = controlledView ?? localView;
  const setView = (next: PlanningView) => { setLocalView(next); onViewChange?.(next); };
  const [viewNotice, setViewNotice] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [setup, setSetup] = useState<{ step: number; editMode: boolean; completionId?: string } | null>(null);
  const [goalEditing, setGoalEditing] = useState(false);
  const [occurrenceEditing, setOccurrenceEditing] = useState(false);
  const [currentReport, setCurrentReport] = useState<{ generation: string; report: ReportInputV1 } | null>(null);
  const [reportError, setReportError] = useState('');
  const reportOpener = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  useRestored(() => { setView('goals'); setViewNotice(''); setAdvancedOpen(false); setCurrentReport(null); setReportError(''); reload(); });
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  const [receiptEpoch, setReceiptEpoch] = useState(0);
  async function verifyOriginalReceipt() {
    const request = storedPending()?.input.request_id;
    await verify();
    if (request && !storedPending()) setReceiptEpoch(n => n + 1);
  }
  useEffect(() => { onEditingChange(!!pending || busy || !!setup || goalEditing || occurrenceEditing || !!currentReport); return () => onEditingChange(false); }, [pending, busy, setup, goalEditing, occurrenceEditing, currentReport, onEditingChange]);

  const sources = load.status === 'ready' ? load.sources : null;
  const saved = sources && sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  useEffect(() => {
    if (currentReport && sources && (!sources.modules.planning || sources.generation !== currentReport.generation)) setCurrentReport(null);
  }, [sources, currentReport]);
  const viewGeneration = useRef(sources?.generation);
  useEffect(() => {
    if (sources && (viewGeneration.current !== sources.generation || !sources.modules.planning)) {
      viewGeneration.current = sources.generation; setView('goals'); setViewNotice(''); setAdvancedOpen(false);
    }
  }, [sources?.generation, sources?.modules.planning]);
  useEffect(() => () => onViewChange?.('goals'), [onViewChange]);
  useEffect(() => { if (focus) setView('goals'); }, [focus]);
  const viewBlocked = navigationBlocked || !!pending || busy || goalEditing || occurrenceEditing || !!setup || !!currentReport;
  const changeView = (next: PlanningView, focusId?: string) => {
    if (next === view) return;
    if (viewBlocked) {
      if (onNavigationBlocked) onNavigationBlocked();
      else setViewNotice(pending ? t('上次「{label}」的保存结果未确认，请使用页面上方的核对入口后再切换规划视图。', { label: pending.label }) : t('「目标」中的编辑或待确认操作尚未完成，请先关闭表单或处理本页提示，再切换规划视图。'));
      return;
    }
    if (next === 'detail' && !saved?.profile.retire.basic) return;
    setViewNotice(''); setView(next);
    requestAnimationFrame(() => {
      const target = document.getElementById(focusId ?? 'page-heading') ?? document.getElementById('page-heading');
      if (focusId) target?.scrollIntoView({ block: 'start' });
      target?.focus();
    });
  };
  const reportBlocked = !sources || !saved?.profile.retire.basic || !sources.modules.planning || !!pending || busy || goalEditing || occurrenceEditing || !!setup || !!currentReport;
  const openCurrentReport = (from: HTMLElement) => {
    if (reportBlocked || !sources) return;
    reportOpener.current = from; setReportError('');
    try { setCurrentReport({ generation: sources.generation, report: currentReportInput(sources, buildBasicCapabilities(sources), today) }); }
    catch (error) { setReportError(error instanceof Error ? error.message : t('报告生成失败，请重新读取规划。')); }
  };
  const closeCurrentReport = () => {
    setCurrentReport(null);
    requestAnimationFrame(() => { if (reportOpener.current?.isConnected && !reportOpener.current.matches(':disabled')) reportOpener.current.focus(); else refocusHeading(); });
  };
  const mode = modeOf(saved);
  usePageBar('planning', { primary: { label: saved?.profile.retire.basic ? t('调整条件') : t('开始设置'), disabled: !sources || sources.profile.status !== 'ready' || !!pending || busy || goalEditing || occurrenceEditing || !!setup || !!currentReport, run: () => openSetup(0, undefined, !!saved?.profile.retire.basic) } });
  // WebKit does not focus a button on click, so the caller passes the clicked element; the heading is the last resort.
  const openSetup = (step = 0, from?: HTMLElement | null, editMode = false, completionId?: string) => { opener.current = from ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null); setSetup({ step, completionId, editMode: editMode || step >= 4 }); };
  const closeSetup = (ok: boolean) => { setSetup(null); setPending(storedPending()); if (ok) reload(); requestAnimationFrame(() => { const back = opener.current?.isConnected ? opener.current : document.getElementById('plan-budget-entry'); if (back) back.focus(); else refocusHeading(); }); };

  const onPending = useCallback(() => setPending(storedPending()), [setPending]);

  return <section className="stats-section wealth-section planning-section" aria-label={t('规划')}>
    {pending && <div className="notice" role="status">{t('上次「{label}」的保存结果未确认。', { label: pending.label })}{pending.command === 'financial_import_commit' ? <span>{t('请到设置的数据管理核对上次金融导入结果。')}</span> : <button disabled={busy} onClick={() => void verifyOriginalReceipt()}>{t('核对结果')}</button>}</div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <HeaderSlot target="page-header-tabs"><div className="page-tabs" role="group" aria-label={t('规划视图')}>
      <button type="button" aria-pressed={view === 'goals'} onClick={() => changeView('goals')}>{t('目标')}</button>
      <button type="button" aria-pressed={view === 'detail'} disabled={!saved?.profile.retire.basic} title={!saved?.profile.retire.basic ? t('完成目标设置后可查看') : undefined} onClick={() => changeView('detail')}>{t('测算详情')}</button>
      <button type="button" aria-pressed={view === 'trial'} onClick={() => changeView('trial')}>{t('试算')}</button>
    </div></HeaderSlot>
    <HeaderSlot><div className="wealth-toolbar">
      <Info text={t('按你的条件，估算为目标月份每月需要准备多少资金。都是估算，条件随时可以改。')}/>
    </div></HeaderSlot>
    {viewNotice && <p className="notice" role="status">{viewNotice}</p>}
    {reportError && <p className="notice" role="alert">{reportError}</p>}
    {load.status === 'error' ? <article className="ui-card ui-content" role="alert"><p>{t('规划读取失败：{message}', { message: load.message })}</p><button onClick={reload}>{t('重新读取')}</button></article>
      : !sources ? <p role="status" className="muted">{t('正在读取规划…')}</p>
      : <><PlanningBasicGoals key={sources.generation + ":" + sources.write_version + ":" + receiptEpoch} sources={sources} mode={mode} today={today} reload={reload} onPending={onPending} onEditingChange={setGoalEditing} onGoto={onTab} openSetup={openSetup} focus={focus === 'budget'} onFocusDone={onFocusDone} assumptionsPort={followupPort} onReport={openCurrentReport} reportDisabled={reportBlocked} view={view} onViewChange={changeView} entryBlocked={viewBlocked || sources.profile.status !== 'ready' || !sources.modules.planning} advancedOpen={advancedOpen} onAdvancedOpenChange={setAdvancedOpen}/>{view === 'goals' && <PlanningGoalOccurrences key={sources.generation + ":occurrences:" + sources.write_version + ":" + receiptEpoch} sources={sources} today={today} reload={reload} onPending={onPending} onEditingChange={setOccurrenceEditing} blocked={!!pending || busy || goalEditing || !!setup || !!currentReport}/>}</>}

    {setup && sources && <PlanningSetupDialog key={sources.generation} completionId={setup.completionId} sources={sources} snapshot={ready(sources.snapshot) ?? null} accounts={ready(sources.accounts) ?? []} today={today} reload={reload} onPending={onPending} onClose={ok => { closeSetup(ok); if (ok) onTab('goals'); }} initialStep={setup.step} editMode={setup.editMode} assumptionsPort={followupPort}/>}
    {currentReport && (!sources || sources.modules.planning && sources.generation === currentReport.generation) && <PlanningCurrentReportDialog report={currentReport.report} onClose={closeCurrentReport}/>}
  </section>;
}
