import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../asset';
import type { WishlistFilter, WishlistItem, WishlistPage, WishlistQuery } from '../../wishlist';
import { useNav, useReveal } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, ChipRow, Card, EmptyState, ErrorState, Fab, Icon, LargeTitle, Loading, Notice, SearchField, Sheet, SwipeRow } from '../ui';
import { cardView, defaultDescending, filterItems, hasMore, initialQuery, isFiltered, mergePages, overdueBanner, sortItems, sortLabel, summaryParts } from './model';
import { StatePill, ReceiptCards, WishIcon, useReceipts, useTaxonomy } from './parts';
import { DecisionSheet } from './DetailSheets';
import { dropChange, loadList, loadMore, reconsiderChange, submitOp } from './service';
import './wishes.css';

type Totals = Record<'all' | 'considering' | 'purchased' | 'dropped', number>;

/** 物品标签下的「心愿」：筛选、预计价格合计、卡片列表；沿用电脑端的排序与分页规则（一页 100 条，加载更多续读）。 */
export default function WishList(_: PageProps) {
  const nav = useNav(), reveal = useReveal(), { today, setBusy } = useSession();
  const taxonomy = useTaxonomy();
  const [query, setQuery] = useState<WishlistQuery>(initialQuery), [page, setPage] = useState<WishlistPage | null>(null), [items, setItems] = useState<WishlistItem[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null), [considering, setConsidering] = useState<number | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [moreBusy, setMoreBusy] = useState(false), [moreError, setMoreError] = useState('');
  const [searchText, setSearchText] = useState(''), [sortOpen, setSortOpen] = useState(false), [tick, setTick] = useState(0);
  const [deciding, setDeciding] = useState<{ kind: 'drop' | 'reconsider'; item: WishlistItem } | null>(null), [decideBusy, setDecideBusy] = useState(false), [decideError, setDecideError] = useState(''), [notice, setNotice] = useState('');
  const ticket = useRef(0);
  const receipts = useReceipts(page?.generation ?? taxonomy.data?.generation ?? null, () => setTick(n => n + 1));

  // 搜索词停顿后才发起读取。
  useEffect(() => { const timer = setTimeout(() => setQuery(q => q.search === searchText ? q : { ...q, search: searchText, offset: 0 }), 300); return () => clearTimeout(timer); }, [searchText]);
  useEffect(() => {
    const mine = ++ticket.current;
    setLoading(true); setError(''); setMoreError('');
    loadList(query).then(result => {
      if (mine !== ticket.current) return;
      setPage(result.page); setItems(result.page.items); setTotals(result.totals); setConsidering(result.considering);
    }).catch(cause => { if (mine === ticket.current) setError(errorMessage(cause)); })
      .finally(() => { if (mine === ticket.current) setLoading(false); });
  }, [query, reveal, tick]);

  async function more() {
    if (!page || moreBusy) return;
    const mine = ticket.current; setMoreBusy(true); setMoreError(''); setBusy(true);
    try {
      const next = await loadMore(query, items.length);
      if (mine === ticket.current) { setItems(old => mergePages(old, next.items)); setPage(next); }
    } catch (cause) { setMoreError(errorMessage(cause)); }
    finally { setMoreBusy(false); setBusy(false); }
  }
  async function decide(note: string) {
    if (!deciding || !page || decideBusy) return;
    const { kind, item } = deciding, change = (kind === 'drop' ? dropChange : reconsiderChange)(item, page.generation, note, crypto.randomUUID());
    setDecideBusy(true); setBusy(true); setDecideError('');
    try {
      const outcome = await submitOp({ kind: 'decision', label: kind === 'drop' ? '不再考虑' : '重新考虑', input: change });
      if (outcome.status === 'saved') { setDeciding(null); setNotice(kind === 'drop' ? `已记录「${item.fields.name}」为不再考虑；档案与图片都保留着。` : `「${item.fields.name}」已回到考虑中。`); setTick(n => n + 1); }
      else { setDecideError(outcome.message); if (outcome.status === 'unknown') { setDeciding(null); receipts.refresh(); } }
    } finally { setDecideBusy(false); setBusy(false); }
  }
  const adjust = (part: Partial<WishlistQuery>) => setQuery(q => ({ ...q, ...part, offset: 0 }));
  const blocked = receipts.all.length > 0;
  const add = () => nav.push('wishes.edit', {});
  const open = (id: string) => nav.push('wishes.detail', { id });
  const categories = taxonomy.data?.categories ?? null;
  const banner = overdueBanner(items, today);
  const summary = page && totals && totals.all > 0 ? summaryParts(page, considering) : null;
  const count = (id: WishlistFilter) => totals ? String(id === 'considering' ? considering ?? totals.considering : totals[id]) : '';
  const filtered = isFiltered(query);

  return <div className="m-page">
    <LargeTitle title="心愿" segments/>
    <Fab label="添加心愿" disabled={blocked || !taxonomy.data} onClick={add}/>
    <div className="w-stack">
      <ReceiptCards ops={receipts.all} busy={receipts.busy} notice={receipts.notice} onResolve={op => void receipts.resolve(op)}/>
      {notice && <Notice tone="positive">{notice}</Notice>}
      <SearchField subject="心愿" value={searchText} onChange={setSearchText}/>
      <div className="w-filter" role="group" aria-label="心愿状态">
        {filterItems.map(item => <button key={item.id} type="button" aria-pressed={query.filter === item.id} onClick={() => adjust({ filter: item.id })}>{item.label}<small>{count(item.id)}</small></button>)}
      </div>
      {error ? <ErrorState title="心愿读取失败" message={error} onRetry={() => setTick(n => n + 1)}/> : !page ? <Loading label="正在读取心愿…"/> : <>
        {summary && <Card className="w-summary" label="心愿合计">
          <span className="w-summary-line">{summary.count} · 预计价格合计</span>
          <strong className={`w-summary-amount${summary.allUnknown ? ' m-unknown' : ''}`}>{summary.amount}{summary.unknown && <small>{summary.unknown}</small>}</strong>
          {summary.legacy && <span className="w-summary-line">{summary.legacy}，不计入合计</span>}
          <p className="w-foot">这只是想法的预计价格，不是已发生的支出，也不是资金承诺。</p>
        </Card>}
        {banner && <button type="button" className="w-banner" onClick={() => open(banner.id)}>
          <span className="w-banner-icon"><Icon name="calendar" size={20}/></span>
          <span className="w-banner-main"><strong>{banner.title}</strong><span>{banner.text}</span></span><Icon name="chevronRight" size={18}/>
        </button>}
        {items.length === 0 && !loading ? (filtered
          ? <EmptyState icon="box" title="当前条件下没有找到记录" message={query.filter === 'purchased' ? '记录购入的心愿会保留在这里。' : '换个筛选或关键词试试。'} action={<Button onClick={() => { setQuery(initialQuery); setSearchText(''); }}>清除筛选</Button>}/>
          : <EmptyState icon="box" title="记下第一件想要的物品" message="名称之外都可以留空，之后再决定。" action={<Button variant="primary" disabled={blocked || !taxonomy.data} onClick={add}>添加心愿</Button>}/>) : <>
          <div className="w-head"><h2>{filterItems.find(item => item.id === query.filter)?.label}心愿</h2><button type="button" className="w-sort" onClick={() => setSortOpen(true)}>{sortLabel(query.sort, query.descending)}<Icon name="sort" size={16}/></button></div>
          <ul className="w-list" aria-busy={loading}>
            {items.map(item => { const view = cardView(item, today, categories); const swipe = item.decision_state === 'considering' ? { label: '不再考虑', icon: 'close' as const, onAction: () => { setDecideError(''); setDeciding({ kind: 'drop', item }); } } : item.decision_state === 'dropped' ? { label: '重新考虑', icon: 'refresh' as const, onAction: () => { setDecideError(''); setDeciding({ kind: 'reconsider', item }); } } : null;
              const card = <button type="button" className="m-card w-card" onClick={() => open(item.id)}>
                <span className="w-card-top"><WishIcon photo={view.cover} generation={page.generation}/>
                  <span className="w-card-main"><span className="w-card-name">{view.name}</span>
                    <span className="w-card-tags"><StatePill tone={view.tone}>{view.state}</StatePill>{view.category && <span>{view.category}</span>}{view.pinned && <span className="w-pill w-pill-neutral">置顶</span>}</span></span>
                  <span className="w-card-price">{view.price ? <b>{view.price}</b> : <b className="m-unknown">价格未知</b>}<small>预计价格</small></span></span>
                {view.reason && <span className="w-card-reason">{view.reason}</span>}
                <span className="w-card-meta"><span>加入 {view.added}</span><i aria-hidden="true"/><span>{view.plan}</span>{view.overdue && <span className="w-pill w-pill-warn">计划日期已过</span>}</span>
              </button>;
              return <li key={item.id}>{swipe && !blocked ? <SwipeRow label={`${view.name} 操作`} actions={[swipe]}>{card}</SwipeRow> : card}</li>; })}
          </ul>
          <div className="w-more"><span>已显示 {items.length} / {page.total} 条</span>
            {moreError && <Notice tone="danger">{moreError}</Notice>}
            {hasMore(items.length, page.total) && <Button disabled={moreBusy} onClick={() => void more()}>{moreBusy ? '正在读取…' : '加载更多'}</Button>}
            <p className="w-foot">未设置的价格与日期始终排在已知值之后；历史待核实不计入考虑中合计。</p></div>
        </>}
      </>}
    </div>
    {deciding && <DecisionSheet kind={deciding.kind} item={deciding.item} busy={decideBusy} error={decideError} onSubmit={note => void decide(note)} onClose={() => setDeciding(null)}/>}
    {sortOpen && <Sheet title="排序" onClose={() => setSortOpen(false)}>
      <div className="w-sheet-stack">
        <ChipRow label="排序依据" items={sortItems} value={query.sort} onChange={id => adjust({ sort: id as WishlistQuery['sort'], descending: defaultDescending(id as WishlistQuery['sort']) })}/>
        <ChipRow label="排序方向" items={[{ id: 'desc', label: '降序' }, { id: 'asc', label: '升序' }]} value={query.descending ? 'desc' : 'asc'} onChange={id => adjust({ descending: id === 'desc' })}/>
        <p>置顶的心愿始终排在最前。</p>
      </div>
    </Sheet>}
  </div>;
}
