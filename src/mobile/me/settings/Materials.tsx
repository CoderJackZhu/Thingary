import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../../asset';
import { MaterialThumb } from '../../../MaterialLibrary';
import { pendingUpload, uploadAndResolve, uploadKey } from '../../../material-upload';
import type { PendingUpload } from '../../../material-upload';
import { filterMaterials, materialCategories } from '../../../materials';
import type { MaterialEntry, MaterialSource } from '../../../materials';
import { readGate } from '../../home/read';
import { Button, ChipRow, DeleteSheet, EmptyState, ErrorState, Loading, Notice, SearchField, SegmentedControl } from '../../ui';
import { SettingsShell } from './Shell';
import { t } from '../../../i18n.ts';
const sources: { id: MaterialSource; label: string }[] = [{ id: 'icon', label: t('图标') }, { id: 'dimensional', label: t('立体图标') }, { id: 'custom', label: t('我的图片') }];

/** 素材库: built-in icons and the person's own pictures (`list_materials`, `add_material`, `remove_material`) with the upload receipt recovery. */
export default function MaterialsPage() {
  const [generation, setGeneration] = useState(''), [entries, setEntries] = useState<MaterialEntry[] | null>(null), [error, setError] = useState('');
  const [source, setSource] = useState<MaterialSource>('icon'), [category, setCategory] = useState(t('全部')), [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [confirming, setConfirming] = useState<MaterialEntry | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null), [recoveryError, setRecoveryError] = useState('');
  const lock = useRef(false);
  const readRecovery = () => { try { setPending(pendingUpload(localStorage)); setRecoveryError(''); } catch { setRecoveryError(t('上传核对记录无法读取，请恢复本机存储后重试。')); } };
  const reload = useCallback(() => {
    setError('');
    invoke<MaterialEntry[]>('list_materials').then(setEntries).catch(cause => { setEntries(null); setError(errorMessage(cause)); });
  }, []);
  useEffect(() => { readRecovery(); reload(); readGate().then(gate => setGeneration(gate.counts.generation)).catch(cause => setError(errorMessage(cause))); }, [reload]);
  const completed = (entry: MaterialEntry | null) => {
    try { localStorage.removeItem(uploadKey); } catch { /* the receipt stays and is checked next time */ }
    setPending(null);
    if (entry) { setSource('custom'); setCategory(t('全部')); setSearch(''); }
    setNotice(entry ? t('已上传素材「{name}」。', { name: entry.name }) : t('核对完成：没有保存素材，可重新上传。'));
    reload();
  };
  async function upload() {
    if (lock.current || pending || !generation || recoveryError) return;
    lock.current = true; setBusy(true); setNotice('');
    const next = { request: crypto.randomUUID(), generation };
    let persisted = false;
    try {
      localStorage.setItem(uploadKey, JSON.stringify(next)); persisted = true; setPending(next);
      completed(await uploadAndResolve(next, p => invoke<MaterialEntry>('add_material', p), p => invoke<MaterialEntry | null>('material_upload_result', p)));
    } catch (cause) { setNotice(persisted ? errorMessage(cause) + t(' 上传结果未确认；请先核对，勿重复上传。') : t('无法保存上传核对记录，尚未开始上传。')); }
    finally { lock.current = false; setBusy(false); }
  }
  async function resolveUpload() {
    if (lock.current || !pending) return;
    lock.current = true; setBusy(true);
    try {
      if (pending.generation !== generation) { localStorage.removeItem(uploadKey); setPending(null); setNotice(t('资料已切换，旧上传不会写入当前资料。')); return; }
      completed(await invoke<MaterialEntry | null>('material_upload_result', pending));
    } catch (cause) { setNotice(errorMessage(cause) + t(' 原操作已保留，请继续核对。')); }
    finally { lock.current = false; setBusy(false); }
  }
  async function remove(entry: MaterialEntry) {
    if (lock.current || pending) return;
    lock.current = true; setBusy(true); setConfirming(null);
    try { setEntries(await invoke<MaterialEntry[]>('remove_material', { id: entry.id, generation })); setNotice(t('已删除素材「{name}」。已保存物品的图片不受影响。', { name: entry.name })); }
    catch (cause) { setNotice(errorMessage(cause)); reload(); }
    finally { lock.current = false; setBusy(false); }
  }
  const shown = entries ? filterMaterials(entries, source, category, search, []) : null;
  const locked = busy || !!pending || !!recoveryError || !generation;
  return <SettingsShell title={t('素材库')} lead={t('新增或编辑物品时，点物品名称旁的图标即可选择。内置素材为示意图，非实物照片；也可以上传自己的图片。')}>
    <SegmentedControl label={t('素材类型')} items={sources} value={source} onChange={next => { setSource(next); setCategory(t('全部')); }}/>
    {source !== 'custom' && <ChipRow label={t('素材分类')} items={materialCategories.map(name => ({ id: name, label: name }))} value={category} onChange={setCategory}/>}
    <SearchField subject={t('素材')} value={search} onChange={setSearch}/>
    <Button variant="primary" block disabled={locked} onClick={() => void upload()}>{busy ? t('请稍候…') : t('添加图片')}</Button>
    <p className="m-group-footer">{t('JPEG、PNG、HEIC、WebP · 每张 20 MiB。上传后随档案保存在本机。')}</p>
    {recoveryError && <Notice tone="danger">{recoveryError} <Button variant="plain" onClick={readRecovery}>{t('重新读取核对记录')}</Button></Notice>}
    {pending && <Notice>{t('有一笔素材上传结果待核对。')} <Button variant="plain" disabled={busy || !generation} onClick={() => void resolveUpload()}>{pending.generation === generation ? t('核对上传结果') : t('关闭旧资料上传提示')}</Button></Notice>}
    {notice && <Notice tone="positive">{notice}</Notice>}
    {error ? <ErrorState title={t('素材读取失败')} message={error} onRetry={reload}/> : !entries || !shown ? <Loading label={t('正在读取素材…')}/>
      : !shown.length ? <EmptyState icon="user" title={t('当前条件下没有素材')} message={source === 'custom' ? t('点「添加图片」上传自己的图片。') : t('换一个分类或清除搜索。')} action={search ? <Button onClick={() => setSearch('')}>{t('清除搜索')}</Button> : undefined}/>
      : <div className="me-material-grid" aria-label={t('{length} 个素材', { length: shown.length })}>{shown.map(entry => <div className="m-card me-material" key={entry.id}>
        <MaterialThumb id={entry.id} generation={generation} alt={entry.builtin ? t('{name}示意图（非实物照片）', { name: entry.name }) : entry.name}/>
        <span className="me-material-name">{entry.name}</span><span className="me-material-kind">{entry.builtin ? t('内置示意图') : t('自定义')}</span>
        {!entry.builtin && <Button variant="plain" disabled={locked} onClick={() => setConfirming(entry)}>{t('删除')}</Button>}
      </div>)}</div>}
    {confirming && <DeleteSheet name={confirming.name} recoverable={false} busy={busy} onClose={() => setConfirming(null)} onConfirm={() => void remove(confirming)}><p className="m-confirm-text">{t('删除后不能恢复，已保存物品的图片不受影响。')}</p></DeleteSheet>}
  </SettingsShell>;
}
