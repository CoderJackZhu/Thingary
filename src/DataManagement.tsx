import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import {Icon} from './AssetViews';
import { AutoBackup } from './AutoBackup';

type Summary = { hash: string; created_at: string; schema: number; assets: number; deleted_assets: number; wishes: number; maintenances: number; warranties: number; accounts: number; snapshots: number; expenses: number; plans: number; payments: number; virtual_assets: number; files: number };
type Inspected = { path: string; name: string; summary: Summary };
type Note = { line: number; name: string; reason: string };
type CsvPreview = { path: string; name: string; preview: { hash: string; valid: number; invalid: Note[]; duplicates: Note[]; new_categories: string[]; new_channels: string[] } };
type Task = { kind: 'idle' } | { kind: 'running'; label: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

/** Drafts and pending requests belong to one dataset generation; after a restore they can never apply. */
export function localWorkKeys() {
  const keys: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('thingary.') && k !== 'thingary.theme') keys.push(k); } } catch { /* storage unavailable: nothing to clear */ }
  return keys;
}

export function DataManagement({ generation, blocked, demo, onTrash, onBusyChange, onImported }: { generation: string | null; blocked: boolean; demo: boolean; onTrash: () => void; onBusyChange: (busy: boolean) => void; onImported: () => void }) {
  const [task, setTask] = useState<Task>({ kind: 'idle' }), [candidate, setCandidate] = useState<Inspected | null>(null);
  const [sheet, setSheet] = useState<CsvPreview | null>(null), [withDuplicates, setWithDuplicates] = useState(false), [importId, setImportId] = useState('');
  const busy = task.kind === 'running';
  useEffect(() => { onBusyChange(busy || !!candidate || !!sheet); return () => onBusyChange(false); }, [busy, candidate, sheet, onBusyChange]);
  async function saveTemplate() {
    setTask({ kind: 'running', label: '正在保存导入模板…' });
    try {
      const path = await invoke<string | null>('save_csv_template');
      setTask(path ? { kind: 'done', text: `模板已保存到 ${path}。按表头填写后，用「选择表格…」导入。` } : { kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '模板未保存：' + errorMessage(e) }); }
  }
  async function inspectCsv() {
    setCandidate(null); setSheet(null); setTask({ kind: 'running', label: '正在检查表格，当前资料不会改变…' });
    try {
      const found = await invoke<CsvPreview | null>('inspect_csv_import');
      setSheet(found); setWithDuplicates(false); setImportId(crypto.randomUUID()); setTask({ kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '这个表格不能导入，当前资料未改变：' + errorMessage(e) }); }
  }
  async function commitCsv() {
    if (!sheet || !generation) return;
    setTask({ kind: 'running', label: '正在导入…' });
    try {
      const done = await invoke<{ imported: number; skipped_duplicates: number; invalid: number }>('commit_csv_import', { path: sheet.path, input: { request_id: importId, generation, hash: sheet.preview.hash, include_duplicates: withDuplicates } });
      setSheet(null);
      setTask({ kind: 'done', text: `已导入 ${done.imported} 件物品` + (done.skipped_duplicates ? `，跳过疑似重复 ${done.skipped_duplicates} 行` : '') + (done.invalid ? `，${done.invalid} 行无效未导入` : '') + '。' });
      onImported();
    } catch (e) { setTask({ kind: 'error', text: '导入未完成，当前资料保持原样：' + errorMessage(e) }); }
  }
  async function backup() {
    setCandidate(null); setTask({ kind: 'running', label: '正在生成并校验完整备份…' });
    try {
      const done = await invoke<{ name: string; folder: string } | null>('create_backup');
      setTask(done ? { kind: 'done', text: `已保存并校验「${done.name}」，位于 ${done.folder}。` } : { kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '备份未完成，当前资料未改变：' + errorMessage(e) }); }
  }
  async function exportCsv() {
    setCandidate(null); setTask({ kind: 'running', label: '正在导出物品表…' });
    try {
      const done = await invoke<{ name: string; folder: string; rows: number } | null>('export_csv');
      setTask(done ? { kind: 'done', text: `已导出「${done.name}」共 ${done.rows} 件物品，位于 ${done.folder}。` } : { kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '导出未完成：' + errorMessage(e) }); }
  }
  async function exportFinance(kind: 'wealth' | 'expenses' | 'recurring', label: string) {
    setCandidate(null); setTask({ kind: 'running', label: `正在导出${label}…` });
    try {
      const done = await invoke<{ name: string; folder: string; rows: number } | null>('export_finance_csv', { kind });
      setTask(done ? { kind: 'done', text: `已导出「${done.name}」共 ${done.rows} 行，位于 ${done.folder}。` } : { kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '导出未完成：' + errorMessage(e) }); }
  }
  async function inspect() {
    setCandidate(null); setTask({ kind: 'running', label: '正在检查备份，当前资料不会改变…' });
    try {
      const found = await invoke<Inspected | null>('inspect_backup');
      setCandidate(found); setTask({ kind: 'idle' });
    } catch (e) { setTask({ kind: 'error', text: '这个备份不能用于恢复，当前资料未改变：' + errorMessage(e) }); }
  }
  async function inspectAuto(name: string) {
    setCandidate(null); setTask({ kind: 'running', label: '正在检查自动备份，当前资料不会改变…' });
    try {
      setCandidate(await invoke<Inspected>('inspect_auto_backup', { name })); setTask({ kind: 'idle' });
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
  return <section className="ui-card ui-content data-management" aria-labelledby="data-heading">
    <div className="data-heading"><div><p className="eyebrow">本地资料</p><h2 id="data-heading">资料管理</h2></div><span>仅保存在这台 Mac</span></div>
    <p className="data-intro">{demo ? '当前是独立样例库。切换到“我的资料”后可备份、恢复与导出。' : '给资料留一份完整备份，也可导出表格或找回误删记录。'}</p>
    <div className="data-actions">
      <div className="data-action"><span className="data-action-icon"><Icon name="archive"/></span><div className="data-action-copy"><h3>完整备份</h3><p>保存物品、心愿和图片等全部资料。</p></div><button disabled={busy || blocked || demo} onClick={() => void backup()}>备份…</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="back"/></span><div className="data-action-copy"><h3>从备份恢复</h3><p>先检查文件，再确认是否替换当前资料。</p></div><button disabled={busy || blocked || demo || !generation} onClick={() => void inspect()}>选择…</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="list"/></span><div className="data-action-copy"><h3>导出物品表（CSV）</h3><p>生成可阅读的表格，未知值留空。</p></div><button disabled={busy || blocked || demo} onClick={() => void exportCsv()}>导出…</button></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="list"/></span><div className="data-action-copy"><h3>导出财富表（CSV）</h3><p>盘点记录、重要支出、周期费用，各一份可阅读的表格；不能用于恢复。</p></div><span className="data-action-buttons"><button disabled={busy || blocked || demo} onClick={() => void exportFinance('wealth', '盘点记录')}>盘点记录…</button><button disabled={busy || blocked || demo} onClick={() => void exportFinance('expenses', '重要支出')}>重要支出…</button><button disabled={busy || blocked || demo} onClick={() => void exportFinance('recurring', '周期费用')}>周期费用…</button></span></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="list"/></span><div className="data-action-copy"><h3>导入物品表（CSV）</h3><p>把已有表格搬进来，只新增、不覆盖；导入前先预览。</p></div><span className="data-action-buttons"><button disabled={busy || demo} onClick={() => void saveTemplate()}>下载模板…</button><button disabled={busy || blocked || demo || !generation} onClick={() => void inspectCsv()}>选择表格…</button></span></div>
      <div className="data-action"><span className="data-action-icon"><Icon name="trash"/></span><div className="data-action-copy"><h3>最近删除</h3><p>找回误删的物品、维护、保障、盘点、账户、支出与周期费用。</p></div><button id="settings-open-trash" disabled={busy || blocked} onClick={onTrash}>打开</button></div>
    </div>
    <AutoBackup generation={generation} demo={demo} blocked={blocked} busy={busy} candidateOpen={!!candidate} onInspect={name => void inspectAuto(name)}/>
    <details className="data-explainer"><summary>备份、导出导入和最近删除有什么区别？</summary><p>完整备份包含物品、维护、保障、心愿、分类渠道、素材、最近删除及托管原图，可用于恢复。恢复前会检查所选备份，并保护当前资料。</p><p>自动备份在资料有改动后自动生成，保留最近 7 份，放在本机资料目录旁；与手动备份格式相同，都可用于恢复。CSV 只包含未删除物品的可读数据，不含图片、维护、保障或心愿，不能用于恢复；以 = + - @ 开头的文字会加上保护字符。最近删除仅用于找回误删记录。</p><p>导入物品表只新增物品，不修改或合并已有物品；只有名称必填，状态为已退役须填退役日期，已售出须填售出日期与售价。导出的物品表也可以直接导入。整体搬家或回到以前请用完整备份。</p></details>
    {blocked && <p className="notice">请先处理正在编辑或待核对的内容，再进行备份或恢复。</p>}
    {task.kind === 'running' && <p role="status" className="notice">{task.label}</p>}
    {task.kind === 'done' && <p role="status" className="notice">{task.text}</p>}
    {task.kind === 'error' && <p role="alert" className="notice error">{task.text}</p>}
    {sheet && <CsvConfirm sheet={sheet} busy={busy} withDuplicates={withDuplicates} onDuplicates={setWithDuplicates} onCancel={() => setSheet(null)} onConfirm={() => void commitCsv()}/>}
    {candidate && <div className="confirm" role="alert">
      <strong>用「{candidate.name}」替换当前全部资料？</strong>
      <p>备份时间 {new Date(candidate.summary.created_at).toLocaleString('zh-CN')} · 格式版本 {candidate.summary.schema}</p>
      <p>物品 {candidate.summary.assets} 件（其中最近删除 {candidate.summary.deleted_assets}）· 心愿 {candidate.summary.wishes} 条 · 维护 {candidate.summary.maintenances} 条 · 保障 {candidate.summary.warranties} 份 · 账户 {candidate.summary.accounts} 个 · 盘点 {candidate.summary.snapshots} 次 · 支出 {candidate.summary.expenses} 笔 · 周期计划 {candidate.summary.plans} 项 · 周期付款 {candidate.summary.payments} 条 · 虚拟资产 {candidate.summary.virtual_assets} 件 · 原图 {candidate.summary.files} 个</p>
      <p className="muted">检查已通过。当前资料会先保存保护副本，失败时保持原样。{pending > 0 && `本机还有 ${pending} 份属于当前资料的草稿或待核对操作，恢复后将作废。`}</p>
      <div className="actions"><button disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="primary danger" disabled={busy} onClick={() => void restore()}>确认替换当前资料</button></div>
    </div>}
  </section>;
}

function NoteList({ title, notes }: { title: string; notes: Note[] }) {
  if (!notes.length) return null;
  return <details className="csv-notes"><summary>{title} {notes.length} 行</summary><ul>{notes.slice(0, 50).map(n => <li key={n.line}>第 {n.line} 行{n.name && `「${n.name}」`}：{n.reason}</li>)}{notes.length > 50 && <li>还有 {notes.length - 50} 行未列出。</li>}</ul></details>;
}

function CsvConfirm({ sheet, busy, withDuplicates, onDuplicates, onCancel, onConfirm }: { sheet: CsvPreview; busy: boolean; withDuplicates: boolean; onDuplicates: (v: boolean) => void; onCancel: () => void; onConfirm: () => void }) {
  const p = sheet.preview, count = p.valid - (withDuplicates ? 0 : p.duplicates.length);
  return <div className="confirm" role="alert">
    <strong>从「{sheet.name}」导入 {count} 件物品？</strong>
    <p>可导入 {p.valid} 行{p.invalid.length > 0 && `，${p.invalid.length} 行有问题不会导入`}{p.duplicates.length > 0 && `，其中 ${p.duplicates.length} 行疑似重复`}。只新增物品，不修改已有资料。</p>
    {p.new_categories.length > 0 && <p>将新建分类：{p.new_categories.join('、')}</p>}
    {p.new_channels.length > 0 && <p>将新建购买渠道：{p.new_channels.join('、')}</p>}
    <NoteList title="有问题的行" notes={p.invalid}/>
    <NoteList title="疑似重复（名称、购入日期和购入价与已有物品相同）" notes={p.duplicates}/>
    {p.duplicates.length > 0 && <label className="csv-duplicates"><input type="checkbox" checked={withDuplicates} disabled={busy} onChange={e => onDuplicates(e.target.checked)}/>疑似重复的行也导入</label>}
    <p className="muted">全部成功才写入；失败时资料保持原样。</p>
    <div className="actions"><button disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy || count === 0} onClick={onConfirm}>{count === 0 ? '没有可导入的行' : `导入 ${count} 件`}</button></div>
  </div>;
}
