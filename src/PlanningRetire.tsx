import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import type { Income, PlanReview, ProfileState } from './plan';
import { buildRetireCalc, routeCompare } from './plan-retire-calc';
import type { RetireCalc } from './plan-retire-calc';
import { RetireOverview, useValueMode, yuan } from './RetireOverview';
import { RetireSidebar } from './RetireSidebar';
import { RiskLab } from './RiskLab';
import type { Account, Snapshot, Summary } from './wealth';
import './planning.css';
import './retire.css';

/** 退休与 FIRE 的数据与计算：目标卡片和详情页共用，结果不存库。 */
export function useRetirePlan(today: string, review: PlanReview, incomes: Income[]) {
  const [state, setState] = useState<ProfileState | null>(null), [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    (async () => {
      const [profile, catalog] = await Promise.all([invoke<ProfileState>('plan_profile'), invoke<Account[]>('wealth_accounts')]);
      const summary = await invoke<Summary>('wealth_summary');
      const latest = [...summary.points].reverse().find(p => p.complete);
      const snap = latest ? await invoke<Snapshot | null>('wealth_snapshot', { id: latest.snapshot_id }) : null;
      if (live) { setState(profile); setAccounts(catalog); setSnapshot(snap); }
    })().catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);

  const saved = state?.saved ?? null;
  const calc = useMemo(() => (saved && snapshot !== undefined ? buildRetireCalc(saved, snapshot, review, incomes, today) : null), [saved, snapshot, incomes, review, today]);
  // 各路线并排：编辑路线时才算，不在每次渲染里算。
  const compare = () => (saved && snapshot !== undefined ? routeCompare(saved, snapshot, review, incomes, today) : null);
  return { state, snapshot, accounts, error, calc, compare, reload: () => setRetry(n => n + 1) };
}
export type RetirePlan = ReturnType<typeof useRetirePlan>;

/** 退休与 FIRE 详情：概览（左）＋计划输入（右），与「假设分析」两个页签。全部用「今天的钱」，名义值可切换。 */
export function RetireDetail({ plan, today, onEditingChange, onPending, initialEditing = false }: { initialEditing?: boolean; plan: RetirePlan; today: string; onEditingChange: (v: boolean) => void; onPending: () => void }) {
  const { state, snapshot, error, calc, reload } = plan;
  const [mode, setMode] = useValueMode(), [tab, setTab] = useState<'overview' | 'lab'>('overview');
  if (error) return <article className="ui-card ui-content" role="alert"><p>退休估算读取失败：{error}</p><button onClick={reload}>重新读取</button></article>;
  if (!state || snapshot === undefined) return <p role="status" className="muted">正在读取…</p>;
  if (!state.saved || !calc) return <div className="empty"><span className="empty-mark">¥</span><h2>先填写个人资料</h2><p>退休与财务自由的估算需要出生年月和养老金资料。请先到「养老金」页签填写个人资料。</p></div>;
  const ready = isReady(calc);
  return <div className="rd-detail">
    <div className="rd-tabs" role="group" aria-label="退休页签"><button type="button" aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>概览</button><button type="button" aria-pressed={tab === 'lab'} onClick={() => setTab('lab')}>假设分析</button></div>
    {tab === 'lab' ? (ready ? <RiskLab calc={calc} today={today}/> : <Missing calc={calc}/>) : <div className="rd-grid">
      {ready ? <>
        <div className="rd-main"><RetireOverview calc={calc} mode={mode} onMode={setMode}/>
          {calc.emergency?.below && <p className="notice" role="status">当前可支配资产不足 {calc.r.emergency_months} 个月支出（{yuan(calc.spend ?? 0)}/月），低于应急金线。</p>}</div></> : <Missing calc={calc}/>}
      <RetireSidebar calc={calc} state={state} compare={plan.compare} reload={reload} onEditingChange={onEditingChange} onPending={onPending} initial={initialEditing ? 'spend' : null}/>
    </div>}
  </div>;
}

export type ReadyCalc = RetireCalc & { plan: NonNullable<RetireCalc['plan']>; proj: NonNullable<RetireCalc['proj']>; out: NonNullable<RetireCalc['out']>; assets: number };
export const isReady = (calc: RetireCalc): calc is ReadyCalc => !!calc.plan && !!calc.proj && !!calc.out && calc.assets !== null;

function Missing({ calc }: { calc: RetireCalc }) {
  return <article className="ui-card ui-content" aria-label="待补齐资料"><div className="ui-section-head"><h3>退休与财务自由</h3></div>
    {calc.missing.map(m => <p key={m} className="notice" role="status">{m}</p>)}<p className="muted small">补齐后这里会出现判词、轨迹图、覆盖情况和假设分析。右侧可以先填写退休月预算与假设。</p></article>;
}
