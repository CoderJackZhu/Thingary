import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { CloseButton } from './CloseButton';
import { searchDebounceMs, searchFilterList, searchKindLabel, searchKindOrder, searchPageSize, searchScopeText } from './search';
import type { SearchItem, SearchResults, SearchSession } from './search';
import type { SourceTarget } from './source';
import { t } from './i18n.ts';
import { keepTabInDialog } from './search-focus';
/**
 * 居中的“搜索全部资料”面板（§6.1）。关键词停止约 200ms 或中文组合输入结束
 * 后查询；空关键词不查询；再次打开保留本轮关键词、类型、分页与滚动；
 * Esc 关闭并回到触发位置。
 */
export function SearchPanel({ session, onSessionChange, onClose, generation, modulesOn, onOpenSource }: { session: SearchSession; onSessionChange: (next: SearchSession) => void; onClose: () => void; generation: string; modulesOn: (kind: SearchItem['kind']) => boolean; onOpenSource: (target: SourceTarget) => void }) {
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sourceNotice, setSourceNotice] = useState('');
  const [opening, setOpening] = useState(false);
  const composing = useRef(false);
  const ticket = useRef(0);
  const openTicket = useRef(0);
  const openLock = useRef(false);
  const live = useRef(true);
  const opener = useRef<HTMLElement | null>(null);
  const moduleKey = searchKindOrder.map(kind => modulesOn(kind) ? '1' : '0').join('');
  const context = JSON.stringify([generation, session.keyword, session.typeFilter, session.offset, moduleKey]);
  const latestContext = useRef(context);
  latestContext.current = context;
  useEffect(() => {
    live.current = true;
    opener.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => { live.current = false; ticket.current++; openTicket.current++; dialog?.close(); };
  }, []);

  function invalidate() {
    ticket.current++;
    openTicket.current++;
    openLock.current = false;
    setOpening(false);
  }

  // Every request belongs to the displayed query and the mounted panel.
  useEffect(() => {
    invalidate();
    const keyword = session.keyword.trim();
    setResults(null); setError(''); setLoading(false); setActive(-1);
    if (!keyword || isComposing) return;
    if ([...keyword].length > 200 || keyword.includes('\0')) {
      setError(keyword.includes('\0') ? t('关键词不能包含空字符。') : t('关键词最多 200 个字符，请缩短后重新搜索。'));
      return;
    }
    const my = ++ticket.current;
    setLoading(true);
    const current = () => live.current && ticket.current === my && latestContext.current === context;
    const timer = window.setTimeout(() => {
      invoke<SearchResults>('search_all', { input: { keyword, type_filter: session.typeFilter, offset: session.offset, limit: searchPageSize, generation, revision: session.revision } })
        .then(r => {
          if (!current()) return;
          onSessionChange({ ...session, revision: r.revision, offset: r.offset, scrollTop: r.offset === session.offset ? session.scrollTop : 0 });
          setResults(r); setActive(-1); setLoading(false);
        })
        .catch(e => { if (!current()) return; setResults(null); setError(errorMessage(e)); setLoading(false); });
    }, searchDebounceMs);
    return () => { window.clearTimeout(timer); ticket.current++; };
  }, [context, isComposing, refresh]);
  useEffect(() => {
    if (results && listRef.current) listRef.current.scrollTop = session.scrollTop;
  }, [results]);

  function close() {
    if (!live.current) return;
    live.current = false;
    invalidate();
    onClose();
    const previous = opener.current;
    const target = previous && previous !== document.body && !dialogRef.current?.contains(previous)
      ? previous
      : document.querySelector<HTMLElement>('.global-search-open');
    requestAnimationFrame(() => target?.isConnected && target.focus());
  }
  function setKeyword(value: string) {
    invalidate(); setSourceNotice('');
    onSessionChange({ ...session, keyword: value, offset: 0, scrollTop: 0 });
  }
  function setFilter(value: string) {
    invalidate(); setSourceNotice('');
    onSessionChange({ ...session, typeFilter: value, offset: 0, scrollTop: 0 });
  }
  function retry() {
    invalidate();
    onSessionChange({ ...session, offset: 0, scrollTop: 0 });
    setRefresh(n => n + 1);
  }
  function page(delta: number) {
    const next = session.offset + delta * searchPageSize;
    if (next < 0 || (results && next >= results.total)) return;
    invalidate(); setSourceNotice('');
    onSessionChange({ ...session, offset: next, scrollTop: 0 });
    listRef.current?.focus();
  }
  async function open(item: SearchItem) {
    if (!live.current || composing.current || openLock.current || loading) return;
    openLock.current = true; setOpening(true);
    const my = ++openTicket.current;
    const current = () => live.current && openTicket.current === my && latestContext.current === context;
    try {
      await invoke('validate_source', { target: item.target, generation });
      if (!current()) return;
      close();
      onOpenSource(item.target);
    } catch (e) {
      if (!current()) return;
      setSourceNotice(errorMessage(e));
      retry();
    } finally {
      if (openTicket.current === my) { openLock.current = false; setOpening(false); }
    }
  }
  const filters = searchFilterList(results?.type_counts ?? null, modulesOn);
  const items = results?.items ?? [];
  const totalPages = results ? Math.max(1, Math.ceil(results.total / searchPageSize)) : 1;
  const currentPage = Math.floor(session.offset / searchPageSize) + 1;

  function move(delta: number) {
    if (!items.length) return;
    const next = Math.min(items.length - 1, Math.max(0, active + delta));
    focusResult(next);
  }
  function focusResult(next: number) {
    if (!items[next]) return;
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    listRef.current?.children[next]?.querySelector('button')?.focus();
  }
  return <dialog ref={dialogRef} className="global-search" aria-modal="true" aria-label={t('搜索全部资料')}
    onKeyDown={e => { if (keepTabInDialog(dialogRef.current, e)) e.stopPropagation(); }}
    onCancel={e => { e.preventDefault(); if (!composing.current) close(); }}
    onClick={e => {
      if (e.target !== e.currentTarget) return;
      const bounds = e.currentTarget.getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) close();
    }}>
      <header>
        <h2>{t('搜索全部资料')}</h2>
        <p className="muted">{t('仅搜索当前资料库已开启模块')}</p>
        <CloseButton type="button" className="icon-button" aria-label={t('关闭搜索')} onClick={close}/>
      </header>
      <input ref={inputRef} className="global-search-input" aria-label={t('搜索全部资料')} placeholder={t('输入关键词，查找任何模块里的记录')} value={session.keyword}
        onChange={e => setKeyword(e.target.value)}
        onCompositionStart={() => { composing.current = true; invalidate(); setIsComposing(true); }}
        onCompositionEnd={e => { composing.current = false; setKeyword(e.currentTarget.value); setIsComposing(false); }}
        onKeyDown={e => {
          // IME 组合输入期间 Enter 属于候选确认，不打开结果（B02）。
          if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
          else if (e.key === 'Enter' && active >= 0 && items[active]) { e.preventDefault(); void open(items[active]); }
        }}/>
      {session.keyword.trim() && <div className="global-search-filters" role="group" aria-label={t('类型筛选')}>
        {filters.map(f => <button key={f.value} type="button" aria-pressed={session.typeFilter === f.value} onClick={() => setFilter(f.value)}>{f.label}{f.count !== null && ` ${f.count}`}</button>)}
      </div>}
      {sourceNotice && <p className="global-search-state" role="alert">{sourceNotice}</p>}
      {!session.keyword.trim() ? <div className="global-search-empty">
        <p>{t('输入关键词开始搜索；英文字母不区分大小写，按字面子串匹配。')}</p>
        <details className="global-search-scope"><summary>{t('查看搜索范围')}</summary><p>{searchScopeText}</p></details>
      </div>
      : loading ? <p role="status" className="muted global-search-state">{t('正在搜索…')}</p>
      : error ? <div className="global-search-state" role="alert"><p>{t('搜索失败，{error}', { error })}</p><button type="button" onClick={retry}>{t('重新搜索')}</button></div>
      : !results || !results.total ? <p className="muted global-search-state">{t('没有找到匹配的记录。')}</p>
      : <>
        <p className="muted global-search-count" role="status">{t('找到 {total} 条', { total: results.total })}</p>
        <ul ref={listRef} className="global-search-results" tabIndex={-1} aria-label={t('搜索结果')} onScroll={e => onSessionChange({ ...session, scrollTop: e.currentTarget.scrollTop })} onKeyDown={e => {
          if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.defaultPrevented) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
          else if (e.key === 'Home') { e.preventDefault(); focusResult(0); }
          else if (e.key === 'End') { e.preventDefault(); focusResult(items.length - 1); }
          else if (e.key === 'Enter' && items[active]) { e.preventDefault(); void open(items[active]); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }}>
          {items.map((item, i) => <li key={item.id}>
            <button type="button" tabIndex={i === Math.max(0, active) ? 0 : -1} disabled={opening} className={'global-search-item' + (i === active ? ' active' : '')} onClick={() => void open(item)} onFocus={() => setActive(i)}
              onKeyDown={e => { if (e.key === 'Enter' && !composing.current && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); void open(item); } }}>
              <span className="kind">{searchKindLabel(item.kind)}</span>
              <span className="title">{item.title}{item.date && <small className="muted"> · {item.date}</small>}{item.status && <small className="muted"> · {item.status}</small>}</span>
              <span className="context"><b>{item.matched_field}</b>{item.context}</span>
            </button>
          </li>)}
        </ul>
        {results.total > searchPageSize && <nav className="global-search-pagination" aria-label={t('搜索结果分页')}>
          <button type="button" disabled={session.offset === 0} onClick={() => page(-1)}>{t('上一页')}</button>
          <span>{t('第 {currentPage} / {totalPages} 页', { currentPage, totalPages })}</span>
          <button type="button" disabled={session.offset + searchPageSize >= results.total} onClick={() => page(1)}>{t('下一页')}</button>
        </nav>}
      </>}
    </dialog>;
}
