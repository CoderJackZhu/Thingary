import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import {Icon} from './AssetViews';

type Summary = { hash: string; created_at: string; schema: number; assets: number; deleted_assets: number; wishes: number; maintenances: number; warranties: number; files: number };
type Inspected = { path: string; name: string; summary: Summary };
type Task = { kind: 'idle' } | { kind: 'running'; label: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

/** Drafts and pending requests belong to one dataset generation; after a restore they can never apply. */
export function localWorkKeys() {
  const keys: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('possio.') && k !== 'possio.theme') keys.push(k); } } catch { /* storage unavailable: nothing to clear */ }
  return keys;
}

export function DataManagement({ generation, blocked, demo, onTrash }: { generation: string | null; blocked: boolean; demo: boolean; onTrash: () => void }) {
  const [task, setTask] = useState<Task>({ kind: 'idle' }), [candidate, setCandidate] = useState<Inspected | null>(null);
  const busy = task.kind === 'running';
  async function backup() {
    setCandidate(null); setTask({ kind: 'running', label: '正在生成并校验完整备份…' });
    try {
      const done = await invoke<{ name: string; folder: string } | null>('create_backup');
      setTask(done ? { kind: 'done', text: `已保存并校验「${done.name}」，位于 ${done.folder}。` } : { kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '备份未完成，当前资料未改变：' + errorMessage(e) }); }
  }
  async function exportCsv() {
    setCandidate(null); setTask({ kind: 'running', label: '正在导出资产表…' });
    try {
      const done = await invoke<{ name: string; folder: string; rows: number } | null>('export_csv');
      setTask(done ? { kind: 'done', text: `已导出「${done.name}」共 ${done.rows} 件物品，位于 ${done.folder}。` } : { kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '导出未完成：' + errorMessage(e) }); }
  }
  async function inspect() {
    setCandidate(null); setTask({ kind: 'running', label: '正在检查备份，当前资料不会改变…' });
    try {
      const found = await invoke<Inspected | null>('inspect_backup');
      setCandidate(found); setTask({ kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '这个备份不能用于恢复，当前资料未改变：' + errorMessage(e) }); }
  }
  async function restore() {
    if (!candidate || !generation) return;
    setTask({ kind: 'running', label: '正在恢复：先保护当前资料，再整体切换…' });
    try {
      await invoke<string>('restore_backup', { path: candidate.path, hash: candidate.summary.hash, generation });
      for (const key of localWorkKeys()) { try { localStorage.removeItem(key); } catch { /* reload still invalidates by generation */ } }
      location.reload();
    } catch (e) { setCandidate(null); setTask({ kind: 'error', text: '恢复未完成，当前资料保持原样：' + errorMessage(e) }); }
  }
  // Only real drafts and pending requests are worth warning about; every non-theme key is still cleared.
  const pending = localWorkKeys().filter(k => /draft|request|abandon|upload/.test(k)).length;
  return <section className="card data-management" aria-labelledby="data-heading">
    <div className="data-heading"><div><p className="eyebrow">本地资料</p><h2 id="data-heading">资料管理</h2></div><span>仅保存在这台 Mac</span></div>
    <p className="data-intro">{demo ? '当前是独立样例库。切换到“我的资料”后可备份、恢复与导出。' : '给资料留一份完整备份，也可导出表格或找回误删记录。'}</p>
    <div className="data-actions">
      <div className="data-action"><span className="data-action-icon"><Icon name="archive"/></span><div className="data-action-copy"><h3>完整备份</h3><p>保存物品、心愿和图片等全部资料。</p></div><button disabled={busy || blocked || demo} onClick={() => void backup()}>备份…</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="back"/></span><div className="data-action-copy"><h3>从备份恢复</h3><p>先检查文件，再确认是否替换当前资料。</p></div><button disabled={busy || blocked || demo || !generation} onClick={() => void inspect()}>选择…</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="list"/></span><div className="data-action-copy"><h3>导出资产表（CSV）</h3><p>生成可阅读的表格，未知值留空。</p></div><button disabled={busy || blocked || demo} onClick={() => void exportCsv()}>导出…</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="trash"/></span><div className="data-action-copy"><h3>最近删除</h3><p>找回误删的物品、维护与保障。</p></div><button disabled={busy || blocked} onClick={onTrash}>打开</button></div>
    </div>
    <details className="data-explainer"><summary>备份、导出和最近删除有什么区别？</summary><p>完整备份包含物品、维护、保障、心愿、分类渠道、素材、最近删除及托管原图，可用于恢复。恢复前会检查所选备份，并保护当前资料。</p><p>CSV 只包含未删除物品的可读数据，不含图片、维护、保障或心愿，不能用于恢复；以 = + - @ 开头的文字会加上保护字符。最近删除仅用于找回误删记录。</p></details>
    {blocked && <p className="notice">请先处理正在编辑或待核对的内容，再进行备份或恢复。</p>}
    {task.kind === 'running' && <p role="status" className="notice">{task.label}</p>}
    {task.kind === 'done' && <p role="status" className="notice">{task.text}</p>}
    {task.kind === 'error' && <p role="alert" className="notice error">{task.text}</p>}
    {candidate && <div className="confirm" role="alert">
      <strong>用「{candidate.name}」替换当前全部资料？</strong>
      <p>备份时间 {new Date(candidate.summary.created_at).toLocaleString('zh-CN')} · 格式版本 {candidate.summary.schema}</p>
      <p>物品 {candidate.summary.assets} 件（其中最近删除 {candidate.summary.deleted_assets}）· 心愿 {candidate.summary.wishes} 条 · 维护 {candidate.summary.maintenances} 条 · 保障 {candidate.summary.warranties} 份 · 原图 {candidate.summary.files} 个</p>
      <p className="muted">检查已通过。当前资料会先保存保护副本，失败时保持原样。{pending > 0 && `本机还有 ${pending} 份属于当前资料的草稿或待核对操作，恢复后将作废。`}</p>
      <div className="actions"><button disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="danger" disabled={busy} onClick={() => void restore()}>确认替换当前资料</button></div>
    </div>}
  </section>;
}
