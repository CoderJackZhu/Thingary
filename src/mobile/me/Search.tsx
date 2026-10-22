import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { allModules } from '../../modules';
import { emptySearchSession, searchDebounceMs, searchFilterList, searchKindLabel, searchKindModule, searchPageSize, searchScopeText } from '../../search';
import type { SearchItem, SearchResults, SearchSession } from '../../search';
import { readGate } from '../home/read';
import { useModules } from '../modules-context';
import { useNav } from '../nav-context';
import { Button, ChipRow, EmptyState, ErrorState, ListGroup, ListRow, Loading, NavBar, LargeTitle, Notice, SearchField } from '../ui';
import type { PageProps } from '../routes';
import { keywordError } from './model';
import { openRoute, targetRoute } from './shared';
import './me.css';
import { t } from '../../i18n.ts';
// 再次打开保留本轮关键词、类型与分页，不落盘（与桌面搜索面板一致）；资料库或模块开关变化时清空。
let memory: { key: string; session: SearchSession } | null = null;

/** 搜索全部资料: the desktop `search_all` query (keyword, type filter, 30 per page); a result opens its record. */
export default function Search(_props: PageProps) {
  const nav = useNav(), { modules: runtime } = useModules();
  const modules = runtime ?? allModules;
  const modulesOn = (kind: SearchItem['kind']) => { const owner = searchKindModule(kind); return owner === null || modules[owner]; };
  const moduleKey = ['wishlist', 'wealth', 'expenses', 'recurring', 'virtual', 'timeline', 'stats'].map(key => (modules as Record<string, boolean>)[key] ? '1' : '0').join('');
  const [generation, setGeneration] = useState<string | null>(null), [genError, setGenError] = useState('');
  const [session, setSession] = useState<SearchSession>(emptySearchSession());
  const [results, setResults] = useState<SearchResults | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [composing, setComposing] = useState(false), [refresh, setRefresh] = useState(0), [opening, setOpening] = useState(false);
  const ticket = useRef(0), openLock = useRef(false), live = useRef(true), input = useRef<HTMLInputElement>(null);

  useEffect(() => { live.current = true; return () => { live.current = false; ticket.current++; }; }, []);
  useEffect(() => {
    readGate().then(gate => {
      const key = gate.counts.generation + moduleKey;
      setGeneration(gate.counts.generation);
      setSession(memory?.key === key ? memory.session : emptySearchSession());
    }).catch(cause => setGenError(errorMessage(cause)));
  }, [moduleKey]);
  useEffect(() => { if (generation) memory = { key: generation + moduleKey, session }; }, [generation, moduleKey, session]);
  useEffect(() => { if (generation) input.current?.focus({ preventScroll: true }); }, [generation]);

  const context = JSON.stringify([generation, session.keyword, session.typeFilter, session.offset, moduleKey]);
  useEffect(() => {
    ticket.current++;
    const keyword = session.keyword.trim();
    setResults(null); setError(''); setLoading(false);
    if (!generation || !keyword || composing) return;
    const bad = keywordError(keyword);
    if (bad) { setError(bad); return; }
    const mine = ++ticket.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      invoke<SearchResults>('search_all', { input: { keyword, type_filter: session.typeFilter, offset: session.offset, limit: searchPageSize, generation, revision: session.revision } })
        .then(found => {
          if (!live.current || ticket.current !== mine) return;
          setSession(current => ({ ...current, revision: found.revision, offset: found.offset }));
          setResults(found); setLoading(false);
        })
        .catch(cause => { if (!live.current || ticket.current !== mine) return; setResults(null); setError(errorMessage(cause)); setLoading(false); });
    }, searchDebounceMs);
    return () => { window.clearTimeout(timer); ticket.current++; };
  }, [context, composing, refresh]);

  const setKeyword = (keyword: string) => { setNotice(''); setSession(current => ({ ...current, keyword, offset: 0 })); };
  const setFilter = (typeFilter: string) => { setNotice(''); setSession(current => ({ ...current, typeFilter, offset: 0 })); };
  const turn = (delta: number) => {
    const next = session.offset + delta * searchPageSize;
    if (next < 0 || (results && next >= results.total)) return;
    setNotice(''); setSession(current => ({ ...current, offset: next }));
    window.scrollTo(0, 0);
  };
  async function open(item: SearchItem) {
    if (!generation || openLock.current || composing || loading) return;
    openLock.current = true; setOpening(true);
    try {
      // The record may have been deleted since the search ran: validate by stable ID first.
      await invoke('validate_source', { target: item.target, generation });
      if (!live.current) return;
      const target = targetRoute(item.target);
      openRoute(nav, target.route, target.params);
    } catch (cause) {
      if (!live.current) return;
      setNotice(errorMessage(cause)); setRefresh(n => n + 1);
    } finally { openLock.current = false; if (live.current) setOpening(false); }
  }

  const keyword = session.keyword.trim();
  const filters = searchFilterList(results?.type_counts ?? null, modulesOn);
  const totalPages = results ? Math.max(1, Math.ceil(results.total / searchPageSize)) : 1, pageNo = Math.floor(session.offset / searchPageSize) + 1;
  return <div className="m-page">
    <NavBar/>
    <LargeTitle title={t('搜索全部资料')} subtitle={t('仅搜索当前资料库已开启的模块')}/>
    <SearchField subject={t('全部资料')} inputRef={input} value={session.keyword} disabled={!generation}
      onChange={setKeyword}
      onCompositionStart={() => { ticket.current++; setComposing(true); }}
      onCompositionEnd={event => { setKeyword(event.currentTarget.value); setComposing(false); }}/>
    {keyword && <ChipRow label={t('类型筛选')} items={filters.map(item => ({ id: item.value, label: item.count === null ? item.label : `${item.label} ${item.count}` }))} value={session.typeFilter} onChange={setFilter}/>}
    {genError ? <ErrorState title={t('资料库读取失败')} message={genError} onRetry={() => window.location.reload()}/>
      : notice ? <Notice tone="danger">{notice}</Notice> : null}
    {!keyword ? <><EmptyState icon="user" title={t('输入关键词开始搜索')} message={t('英文字母不区分大小写，按字面子串匹配。')}/><details className="me-details"><summary>{t('查看搜索范围')}</summary><p>{searchScopeText}</p></details></>
      : loading ? <Loading label={t('正在搜索…')}/>
      : error ? <ErrorState title={t('搜索失败')} message={error} onRetry={() => setRefresh(n => n + 1)}/>
      : !results || !results.total ? <EmptyState icon="user" title={t('没有找到匹配的记录')} message={t('换个关键词，或在类型里选「全部」再试。')}/>
      : <>
        <p className="me-count" role="status">{t('找到 {total} 条', { total: results.total })}</p>
        <ListGroup title={t('搜索结果')}>{results.items.map(item => <ListRow key={item.id} icon={<span className="me-kind">{searchKindLabel(item.kind).slice(0, 2)}</span>} tone="accent" disabled={opening}
          title={item.title} subtitle={`${[searchKindLabel(item.kind), item.date, item.status].filter(Boolean).join(' · ')}\n${item.matched_field}：${item.context}`} onClick={() => void open(item)}/>)}</ListGroup>
        {results.total > searchPageSize && <nav className="me-pager" aria-label={t('搜索结果分页')}><Button disabled={session.offset === 0} onClick={() => turn(-1)}>{t('上一页')}</Button><span>{t('第 {pageNo} / {totalPages} 页', { pageNo, totalPages })}</span><Button disabled={session.offset + searchPageSize >= results.total} onClick={() => turn(1)}>{t('下一页')}</Button></nav>}
      </>}
  </div>;
}
