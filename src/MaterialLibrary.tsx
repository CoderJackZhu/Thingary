import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { pendingUpload, uploadAndResolve, uploadKey, type PendingUpload } from './material-upload';
import { filterMaterials, materialCategories, type MaterialEntry, type MaterialSource } from './materials';
import { usePageBar } from './topbar';

// Shared thumbnail: renders the managed preview from the material library.
export function MaterialThumb({ id, alt, generation, onSelect, disabled = false }: { id: string; alt: string; generation: string; onSelect?: () => void; disabled?: boolean }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true, url = '';
    setSrc(''); setError('');
    void invoke<ArrayBuffer>('material_preview', { id, generation }).then(bytes => {
      if (live) { url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); setSrc(url); }
    }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id, generation, attempt]);
  const content = src ? <img className="material-thumb-image" src={src} alt={alt} onError={() => { setSrc(''); setError('图片无法显示'); }}/> : <span className="material-thumb-placeholder">{error ? '读取失败' : '正在读取…'}</span>;
  return <>{onSelect ? <button type="button" className="material-tile" disabled={disabled || !src} aria-label={alt} onClick={onSelect}>{content}</button> : content}
    {error && <span className="material-thumb-error" role="alert"><span title={error}>图片读取失败</span><button type="button" disabled={disabled} aria-label={'重新读取：' + alt} onClick={() => setAttempt(n => n + 1)}>重试</button></span>}</>;
}

export function MaterialLibrary({ generation, onNotice, onBusyChange, search, onSearch }: { generation: string; onNotice: (message: string) => void; onBusyChange: (busy: boolean) => void; search: string; onSearch: (value: string) => void;  }) {
  const [entries, setEntries] = useState<MaterialEntry[] | null>(null);
  const [source, setSource] = useState<MaterialSource>('icon');
  const [category, setCategory] = useState('全部');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  function readRecovery() {
    try { setPending(pendingUpload(localStorage)); setRecoveryReady(true); setRecoveryError(''); }
    catch { setRecoveryError('上传核对记录无法读取，请恢复本机存储后重试。'); }
  }
  useEffect(readRecovery, []);
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => { onBusyChange(busy || !!pending || !!confirming || !!recoveryError); return () => onBusyChange(false); }, [busy, pending, confirming, recoveryError, onBusyChange]);
  // The topbar carries 添加图片 and 搜索素材; this page keeps filter state only.
  usePageBar('settings', {
    primary: { label: '添加图片', plus: true, disabled: busy || !!pending || !generation || !recoveryReady, run: () => void upload() },
    newRecord: { label: '添加图片', disabled: busy || !!pending || !generation || !recoveryReady, run: () => void upload() },
    search: { key: 'materials', placeholder: '搜索素材' },
  });
  const shownEntries = entries ? filterMaterials(entries, source, category, search, []) : null;
  const reload = useCallback(() => {
    setError('');
    invoke<MaterialEntry[]>('list_materials').then(list => setEntries(list)).catch(e => { setEntries(null); setError(errorMessage(e)); });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  function completed(entry: MaterialEntry | null) {
    localStorage.removeItem(uploadKey);
    setPending(null);
    if (entry) { setSource('custom'); setCategory('全部'); onSearch(''); }
    onNotice(entry ? `已上传素材「${entry.name}」。` : '核对完成：没有保存素材，可重新上传。');
    reload();
  }
  async function resolveUpload() {
    if (lock.current || !pending) return;
    lock.current = true; setBusy(true);
    try {
      // A restored dataset cannot receive or finish an old upload.
      if (pending.generation !== generation) {
        localStorage.removeItem(uploadKey); setPending(null);
        onNotice('资料已切换，旧上传不会写入当前资料。'); return;
      }
      completed(await invoke<MaterialEntry | null>('material_upload_result', pending));
    } catch (e) { onNotice(errorMessage(e) + ' 原操作已保留，请继续核对。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function upload() {
    if (lock.current || pending || !generation || !recoveryReady) return;
    lock.current = true; setBusy(true);
    const next = { request: crypto.randomUUID(), generation };
    let persisted = false;
    try {
      localStorage.setItem(uploadKey, JSON.stringify(next));
      persisted = true; setPending(next);
      completed(await uploadAndResolve(next,
        p => invoke<MaterialEntry>('add_material', p),
        p => invoke<MaterialEntry | null>('material_upload_result', p)));
    } catch (e) { onNotice(persisted ? errorMessage(e) + ' 上传结果未确认；请先核对，勿重复上传。' : '无法保存上传核对记录，尚未开始上传。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function remove(id: string, name: string) {
    if (lock.current || pending || !recoveryReady) return;
    lock.current = true;
    setBusy(true); setConfirming(null);
    try {
      setEntries(await invoke<MaterialEntry[]>('remove_material', { id, generation }));
      onNotice(`已删除素材「${name}」。已保存物品的图片不受影响。`);
    } catch (e) { onNotice(errorMessage(e)); reload(); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="materials-section" aria-labelledby="materials-heading">
    <section className="card">
      <h2 id="materials-heading">素材库</h2>
      <p className="muted">新增或编辑物品时，点击物品名称旁的图标即可选择。内置素材为示意图，非实物照片；也可以上传自己的图片作为素材。</p>
      <div className="material-library-actions">
        <span className="muted small">JPEG、PNG、HEIC、WebP · 每张 20 MiB。上传后随档案保存在本机。</span>
      </div>
      <div className="picker-sources" role="group" aria-label="素材类型">{([['icon','图标'],['dimensional','立体图标'],['custom','我的图片']] as const).map(([id,label]) => <button type="button" key={id} aria-pressed={source === id} onClick={() => { setSource(id); setCategory('全部'); }}>{label}</button>)}</div>
      <div className="picker-filters">{source !== 'custom' && <div className="picker-categories" role="group" aria-label="素材分类">{materialCategories.map(name => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>}</div>
      {entries && shownEntries && shownEntries.length > 0 && <p className="muted small" role="status">{search.trim() ? `找到 ${shownEntries.length} 条素材` : `${shownEntries.length} 个素材`}</p>}
      {entries && shownEntries && !shownEntries.length && <p className="picker-empty">当前条件下没有找到记录。{search.trim() && <button type="button" onClick={() => onSearch('')}>清除搜索</button>}</p>}
      {recoveryError && <div role="alert">{recoveryError}<button type="button" onClick={readRecovery}>重新读取核对记录</button></div>}
      {pending && <div className="confirm" role="status"><p>有一笔素材上传结果待核对。</p><button type="button" disabled={busy || !generation} onClick={() => void resolveUpload()}>{pending.generation === generation ? '核对上传结果' : '关闭旧资料上传提示'}</button></div>}
      {error ? <div role="alert" className="confirm"><p>{error}</p><button type="button" onClick={reload}>重新读取</button></div> : entries ? <div className="material-library-grid">
        {(shownEntries ?? []).map(entry => <div className="material-card" key={entry.id}>
          <MaterialThumb id={entry.id} generation={generation} alt={entry.builtin ? `${entry.name}示意图（非实物照片）` : entry.name}/>
          <span className="material-card-name" title={entry.name}>{entry.name}</span>
          <span className="material-card-kind">{entry.builtin ? '内置示意图' : '自定义'}</span>
          {!entry.builtin && (confirming === entry.id
            ? <div className="material-card-actions"><span>删除后不可恢复，已保存物品不受影响。</span><button type="button" className="primary danger" disabled={busy || !!pending || !recoveryReady} onClick={() => void remove(entry.id, entry.name)}>确认删除</button><button type="button" disabled={busy || !!pending || !recoveryReady} onClick={() => setConfirming(null)}>保留</button></div>
            : <div className="material-card-actions"><button type="button" disabled={busy || !!pending || !recoveryReady} onClick={() => setConfirming(entry.id)}>删除</button></div>)}
        </div>)}
      </div> : <p className="muted" role="status">正在读取素材…</p>}
    </section>
  </section>;
}
