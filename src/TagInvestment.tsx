// U17 · 标签投入分析子视图（物品区域的只读分析，产品设计 D23）。
// 汇总与占比分母始终取响应整体；搜索只过滤明细；金额展示沿用 U16 格式。
// TagInvestment 负责数据获取（requestTagView + 票据）；TagInvestmentBody 是
// 纯展示组件，供渲染测试直接以内存 DTO 夹具断言（Review R1）。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { HeaderSlot } from './HeaderSlot';
import { Info } from './FormControls';
import { maintenanceCellText, maintenanceSummaryText, missingNotice, percentBar, percentText, purchaseSummaryText, requestTagView, visibleItems } from './tag-investment';
import type { AnalysisViewState, TagInvestmentView, TagScope } from './tag-investment';

export type { AnalysisViewState } from './tag-investment';

const stateText: Record<string, string> = { active: '使用中', retired: '已退役', sold: '已售出' };

export function TagInvestment({ state, version, onScope, onSearch, onMore, onOpenAsset, onBackToList, onFocused }: {
  state: AnalysisViewState;
  version: unknown;
  onScope: (scope: TagScope) => void;
  onSearch: (value: string) => void;
  onMore: () => void;
  onOpenAsset: (id: string) => void;
  onBackToList: () => void;
  onFocused: () => void;
}) {
  const [view, setView] = useState<TagInvestmentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const ticket = useRef(0);
  // 从详情返回：物品行仍在集合则恢复其焦点，否则到明细标题；不强制塞回已移出的行。
  useEffect(() => {
    if (!state.focusAsset || loading || !view) return;
    const row = document.getElementById('tag-item-' + state.focusAsset);
    (row ?? document.getElementById('tag-list-heading'))?.focus({ preventScroll: true });
    onFocused();
  }, [state.focusAsset, loading, view]);
  useEffect(() => {
    const t = ++ticket.current;
    setLoading(true);
    setError('');
    void requestTagView(
      (labelId, scope) => invoke<TagInvestmentView>('tag_investment_view', { query: { label_id: labelId, scope } }),
      () => t === ticket.current,
      state.labelId,
      state.scope,
    ).then(outcome => {
      if (outcome.state === 'applied') { setView(outcome.view); setLoading(false); }
      else if (outcome.state === 'failed') { setView(null); setError(outcome.message); setLoading(false); }
      // late：旧票据结果原样丢弃，新请求管理自己的加载状态。
    });
  }, [state.labelId, state.scope, version, attempt]);
  return <TagInvestmentBody state={state} view={view} loading={loading} error={error} onRetry={() => setAttempt(a => a + 1)} onScope={onScope} onSearch={onSearch} onMore={onMore} onOpenAsset={onOpenAsset} onBackToList={onBackToList} />;
}

export function TagInvestmentBody({ state, view, loading, error, onRetry, onScope, onSearch, onMore, onOpenAsset, onBackToList }: {
  state: AnalysisViewState;
  view: TagInvestmentView | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onScope: (scope: TagScope) => void;
  onSearch: (value: string) => void;
  onMore: () => void;
  onOpenAsset: (id: string) => void;
  onBackToList: () => void;
}) {
  const label = view?.label.name ?? state.labelName;
  const complete = view?.totals.complete_investment_cents != null;
  const knownOnly = view != null && !complete && view.totals.has_known_investment;
  const notice = view ? missingNotice(view.totals, view.counts.excluded) : null;
  const { rows, matched } = view ? visibleItems(view, state.search, state.shown) : { rows: [], matched: 0 };
  const shownRows = Math.min(state.shown, matched);
  const scopeButton = (key: TagScope, text: string) => (
    <button type="button" aria-pressed={state.scope === key} onClick={() => onScope(key)}>{text}</button>
  );
  return <section className="tag-investment" aria-label="标签投入分析">
    <HeaderSlot>
      <div className="segmented tag-scope" role="group" aria-label="投入统计范围">
        {scopeButton('all', '历史全部')}
        {scopeButton('held', '当前持有')}
      </div>
      <Info text="按标签汇总物品整个生命周期的购入与有效维护，售出回收单列；不含最近删除，已设置“不计入统计”的物品只计件数。" />
    </HeaderSlot>
    <HeaderSlot target="page-header-meta">{view && <span className="num">{view.counts.included} 件</span>}</HeaderSlot>
    {error ? <div className="ui-card"><div className="ui-pad"><div className="ui-error" role="alert"><span>「{label}」投入读取失败：{error}</span><button type="button" className="ui-btn sm" onClick={onRetry}>重试</button></div><p className="muted small">已保留标签与范围，未展示部分汇总。</p></div></div>
      : loading || !view ? <div className="ui-card"><div className="ui-pad ui-skel" role="status" aria-label="正在读取标签投入"><i style={{ width: '30%' }} /><i style={{ width: '80%' }} /><i style={{ width: '65%' }} /><i style={{ width: '72%' }} /></div></div>
        : view.counts.included === 0 ? (
          <div className="ui-card"><div className="ui-empty">
            <span className="empty-mark" aria-hidden="true">▧</span>
            {view.counts.excluded > 0
              ? <><strong>{view.counts.excluded} 件物品均设置了不计入统计</strong><p>它们仍在标签中，但不参与本页的投入与占比。可回物品列表处理「不计入统计」开关。</p><button type="button" className="ui-btn" onClick={onBackToList}>返回物品列表</button></>
              : state.scope === 'held'
                ? <><strong>这个标签下没有当前持有的物品</strong><p>切换到历史全部可查看完整投入。</p><button type="button" className="ui-btn" onClick={() => onScope('all')}>查看历史全部</button></>
                : <><strong>这个标签下还没有物品</strong><p>给物品设置「{label}」标签后，这里会汇总它的购入、维护与售出回收。</p><button type="button" className="ui-btn" onClick={onBackToList}>返回物品列表</button></>}
          </div></div>
        ) : <>
          <div className="ui-card"><div className="ui-metrics" style={{ '--n': 3 } as CSSProperties}>
            <div>
              <span className="ui-label">{complete ? '累计投入' : knownOnly ? '已知累计投入' : '累计投入'}</span>
              <span className="ui-value">{complete ? money(view.totals.complete_investment_cents) : knownOnly ? money(view.totals.known_investment_cents) : '待补录'}</span>
              <span className="ui-note num">购入 {purchaseSummaryText(view.totals)} · 维护 {maintenanceSummaryText(view.totals)}</span>
            </div>
            <div>
              <span className="ui-label">售出回收</span>
              <span className="ui-value">{money(view.totals.sale_proceeds_cents)}</span>
              <span className="ui-note">{state.scope === 'held' ? '当前持有范围回收为零' : '有效售出的回收，不抵扣累计投入'}</span>
            </div>
            <div>
              <span className="ui-label">{view.totals.complete_net_cents != null ? '净投入' : knownOnly ? '已知净投入' : '净投入'}</span>
              <span className="ui-value">{view.totals.complete_net_cents != null ? money(view.totals.complete_net_cents) : knownOnly ? money(view.totals.known_net_cents) : '待补录'}</span>
              <span className="ui-note">{knownOnly ? '仍有金额待补录 · ' : ''}使用中 {view.counts.active} · 退役 {view.counts.retired}{state.scope === 'all' ? ` · 已售出 ${view.counts.sold}` : ''}</span>
            </div>
          </div></div>
          {notice && <div className="tag-notice" role="status">{notice}</div>}
          <div className="ui-card">
            <div className="ui-section-head"><h2 id="tag-list-heading" tabIndex={-1}>物品投入明细</h2><span className="ui-aside">占标签范围内全部投入</span></div>
            {matched === 0 ? <div className="ui-empty"><strong>没有匹配「{state.search.trim()}」的物品</strong><p>搜索只过滤下方明细，汇总和占比仍覆盖全部 {view.counts.included} 件。<button type="button" className="ui-link" onClick={() => onSearch('')}>清除搜索</button></p></div>
              : <table className="ui-table tag-table">
                <thead><tr><th scope="col">物品 / 状态</th><th scope="col" className="r col-buy">购入</th><th scope="col" className="r col-maint">维护</th><th scope="col" className="r">累计投入</th><th scope="col" className="r">占比</th></tr></thead>
                <tbody>
                  {rows.map(item => {
                    const percent = complete ? percentText(view.totals.known_investment_cents, item.known_investment_cents) : null;
                    const bar = complete ? percentBar(view.totals.known_investment_cents, item.known_investment_cents) : null;
                    const investment = item.complete_investment_cents != null
                      ? money(item.complete_investment_cents)
                      : item.has_known_investment ? `已知 ${money(item.known_investment_cents)} · 待补录` : '待补录';
                    const maintenance = maintenanceCellText(item);
                    return <tr key={item.id}>
                      <td>
                        <button type="button" id={'tag-item-' + item.id} className="tag-item-link" onClick={() => onOpenAsset(item.id)}>
                          <strong>{item.name}</strong>
                          <span className="ui-state" data-state={item.lifecycle_state}>{stateText[item.lifecycle_state] ?? item.lifecycle_state}</span>
                        </button>
                        <span className="tag-item-sub num">购入 {item.purchase_cents != null ? money(item.purchase_cents) : '待补充'} · 维护 {maintenance}</span>
                      </td>
                      <td className="r num col-buy">{item.purchase_cents != null ? money(item.purchase_cents) : <span className="muted">待补录</span>}</td>
                      <td className="r num col-maint">{maintenance}</td>
                      <td className="r num">{investment}</td>
                      <td className="r">
                        {percent != null
                          ? <span className="tag-pct num"><span>{percent}</span>{bar != null && <span className="tag-bar" aria-hidden="true"><i style={{ width: `${bar}%` }} /></span>}</span>
                          : <span className="muted" title={view.totals.known_investment_cents === '0' ? '尚无正金额投入' : '存在金额待补录，占比不可用'}>—</span>}
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>}
            <div className="ui-card-foot tag-foot">
              <span>已显示 {shownRows} / 共 {matched} 件{state.search.trim() ? `（搜索匹配，汇总仍为全部 ${view.counts.included} 件）` : ''}</span>
              {shownRows < matched && <button type="button" className="ui-btn sm" onClick={onMore}>加载更多</button>}
            </div>
          </div>
        </>}
  </section>;
}
