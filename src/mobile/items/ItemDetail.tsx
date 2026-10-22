import { useEffect, useRef, useState } from 'react';
import './date.css';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, type AssetRecord, type Photo, type SaveAsset } from '../../asset';
import { defaultPreferences } from '../../preferences';
import { NOT_SET, UNKNOWN, dateText, dayLabel, moneyText, optionalText, unitMoneyText } from '../format';
import { PhotoView } from '../../Photos';
import { materialArt } from '../../materials';
import { allowReminders } from '../../NotificationNotice';
import { stateLabel, kindLabel, type LifecycleAction } from '../../lifecycle';
import { maintenanceDraft, maintenanceKinds, type MaintenanceDraft } from '../../maintenance';
import { warrantyDraft, warrantyKinds, statusLabel, warrantySummaryText, type WarrantyDraft, type Warranty } from '../../warranty';
import { saleFields, incompleteCostReason, type SaleDraft } from '../../sales';
import { submit } from '../../wealth';
import type { Pending } from '../../wealth';
import type { TaxonomySnapshot } from '../../taxonomy';
import type { PageProps } from '../routes';
import { useNav, useReveal } from '../nav-context';
import { useSession } from '../session';
import { Button, Card, DeleteSheet, DateField, EmptyState, ErrorState, FormGroup, ListGroup, ListRow, Loading, Metric, MetricGrid, MoneyField, NavBar, Notice, SelectField, Sheet, Switch, TextAreaField, TextField } from '../ui';
import { decimalFromMinor, detailGoal, detailLifecycleInput, detailMaintenanceInput, detailSaleInput, detailWarrantyInput, minorFromDecimal } from './detail-model';
import { Glyph, type GlyphName } from './glyphs';
import { PhotoThumbs, PhotoViewer } from './PhotoViewer';
import './detail.css';

type Context = { record: AssetRecord; generation: string };
type Editor = Context & (
  { kind: 'warranty'; id?: string; fields: WarrantyDraft; photos: Photo[] } |
  { kind: 'maintenance'; id?: string; fields: MaintenanceDraft; photos: Photo[] } |
  { kind: 'sale'; draft: SaleDraft } |
  { kind: 'lifecycle'; action: LifecycleAction } |
  { kind: 'delete'; recordId?: string; recordKind?: 'maintenance' | 'warranty' }
);

export default function ItemDetail({ params }: PageProps) {
  const nav = useNav(), reveal = useReveal(), session = useSession();
  const [context, setContext] = useState<(Context & { taxonomy: TaxonomySnapshot }) | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [photoError, setPhotoError] = useState('');
  const [revision, setRevision] = useState(0), [editor, setEditor] = useState<Editor | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const camera = useRef<HTMLInputElement>(null), album = useRef<HTMLInputElement>(null);
  const lock = useRef(false), id = typeof params.id === 'string' ? params.id : '';
  const generation = session.data?.summary.generation;
  const disabled = session.navBlocked || lock.current;
  useEffect(() => {
    let live = true; setLoading(true); setError(''); setContext(null);
    (async () => {
      if (!id) return;
      const before = await invoke<TaxonomySnapshot & { generation: string }>('taxonomy_snapshot');
      const record = await invoke<AssetRecord | null>('read_asset', { id });
      const after = await invoke<{ generation: string }>('taxonomy_snapshot');
      if (before.generation !== after.generation) throw new Error('资料库已切换，请重新读取物品。');
      if (live && record && !record.deleted) { setContext({ record, generation: before.generation, taxonomy: before }); }
    })().catch(cause => { if (live) setError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, reveal, revision, generation, session.settled]);
  useEffect(() => { if (session.settled) { setEditor(null); if(session.settled.command.startsWith('change_'))session.setNotice?.('已确认物品记录保存，请核对最新档案。'); } }, [session.settled]);
  function closeEditor() { if (!session.navBlocked && !lock.current) { setEditor(null); setNotice(''); setPhotoError(''); } }
  function openWarranty(warranty?: Warranty) {
    if (!context || disabled) return;
    setNotice(''); setPhotoError(''); setEditor({ ...context, kind: 'warranty', id: warranty?.id, fields: warrantyDraft(context.record, warranty?.id), photos: warranty?.photos ?? [] });
  }
  function openMaintenance(maintenanceId?: string) {
    if (!context || disabled) return;
    setNotice(''); setPhotoError(''); setEditor({ ...context, kind: 'maintenance', id: maintenanceId, fields: maintenanceDraft(context.record, maintenanceId), photos: context.record.maintenances.find(m => m.id === maintenanceId)?.photos ?? [] });
  }
  function openSale(mode: SaleDraft['mode']) {
    if (!context || disabled) return;
    const fields = saleFields(context.record, session.today);
    setNotice(''); setEditor({ ...context, kind: 'sale', draft: { ...context, mode, fields, original: fields, pending: null } });
  }
  async function write(pending: Pending | { command: 'save_asset'; input: SaveAsset; label: string }, after?: () => void) {
    if (lock.current || session.navBlocked) return;
    lock.current = true; session.setBusy(true); setNotice('');
    try {
      const record = await submit<AssetRecord>(pending);
      setEditor(null); if (record?.asset) setContext(current => current ? { ...current, record } : current);
      setRevision(value => value + 1); session.reload();
      // Navigation is released by the session render after this call; delete stays visible as an empty state.
      after?.();
    } catch (cause) { setNotice(errorMessage(cause)); }
    finally { session.refreshPending(); session.setBusy(false); lock.current = false; }
  }
  async function saveEditor() {
    if (!editor || disabled || photoError) return;
    try {
      if (editor.kind === 'warranty') await write({ command: 'change_warranty', input: detailWarrantyInput(editor.record, editor.generation, editor.fields, editor.id), label: '物品保障' });
      if (editor.kind === 'maintenance') await write({ command: 'change_maintenance', input: detailMaintenanceInput(editor.record, editor.generation, editor.fields, session.today, editor.id), label: '物品维护' });
      if (editor.kind === 'sale') await write({ command: 'change_sale', input: detailSaleInput(editor.draft, session.today), label: '物品售出' });
      if (editor.kind === 'lifecycle') await write({ command: 'change_lifecycle', input: detailLifecycleInput(editor.record, editor.generation, editor.action, session.today), label: '物品状态' });
      if (editor.kind === 'delete') {
        const base = { request_id: crypto.randomUUID(), generation: editor.generation, asset_id: editor.record.asset.id, expected_revision: editor.record.asset.revision, deleted: true };
        if (editor.recordId && editor.recordKind) await write({ command: 'change_record_trash', input: { ...base, record_id: editor.recordId, kind: editor.recordKind }, label: '删除物品记录' });
        else await write({ command: 'change_trash', input: base, label: '删除物品' });
      }
    } catch (cause) { setNotice(errorMessage(cause)); }
  }
  async function toggleReminder(warranty: Warranty, enabled: boolean) {
    if (!context || disabled) return;
    if (enabled && !warranty.fields.end_date) { openWarranty(warranty); setNotice('先补充保障结束日期，再启用到期通知。'); return; }
    try {
      if (enabled) {
        lock.current = true; session.setBusy(true);
        try { await allowReminders(); } finally { lock.current = false; session.setBusy(false); }
      }
      await write({ command: 'change_warranty', input: detailWarrantyInput(context.record, context.generation, { ...warrantyDraft(context.record, warranty.id), reminder: enabled ? { date: warranty.fields.end_date!, notes: '' } : null }, warranty.id), label: '保障到期提醒' });
    } catch (cause) { setNotice(errorMessage(cause)); }
  }
  async function togglePin(pinned: boolean) {
    if (!context || disabled) return;
    const { record } = context;
    const input: SaveAsset = { base: { request_id: crypto.randomUUID(), generation: context.generation, asset_id: record.asset.id, expected_revision: record.asset.revision, name: record.asset.name, price_cents: record.asset.price_cents, purchase_date: record.asset.purchase_date }, details: record.details, photos: { ids: record.photos.map(p => p.id), cover_id: record.cover_id }, classification: record.classification, options: { preferences: { ...(record.preferences ?? defaultPreferences()), pinned } } };
    await write({ command: 'save_asset', input, label: pinned ? '置顶物品' : '取消置顶物品' });
  }
  async function addPhoto(files: FileList | null) {
    if (!files?.length || !editor || (editor.kind !== 'warranty' && editor.kind !== 'maintenance') || disabled) return;
    const selectedFiles = Array.from(files);
    if (selectedFiles.length + editor.fields.photo_ids.length > 20) { setPhotoError('每条记录最多保存 20 张图片。'); return; }
    if (selectedFiles.some(file => file.size > 20 * 1024 * 1024)) { setPhotoError('每张图片不得超过 20 MiB。'); return; }
    lock.current = true; session.setBusy(true); setPhotoError('');
    try {
      for (const file of selectedFiles) {
        const selected = await invoke<Photo>('import_photo_bytes', { generation: editor.generation, name: file.name || '拍摄的凭证.jpg', bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
        setEditor(current => {
          if (current?.kind === 'warranty') return { ...current, photos: [...current.photos, selected], fields: { ...current.fields, photo_ids: [...current.fields.photo_ids, selected.id] } };
          if (current?.kind === 'maintenance') return { ...current, photos: [...current.photos, selected], fields: { ...current.fields, photo_ids: [...current.fields.photo_ids, selected.id] } };
          return current;
        });
      }
      setNotice('图片已准备好，保存记录后生效。');
    } catch (cause) { setPhotoError(errorMessage(cause) + ' 已准备好的图片保留，请重试或明确不使用未读取的图片。'); }
    finally { session.setBusy(false); lock.current = false; }
  }
  const record = context?.record, goal = record ? detailGoal(record) : null;
  const title = editor?.kind === 'warranty' ? `${editor.id ? '更正' : '添加'}保障` : editor?.kind === 'maintenance' ? `${editor.id ? '更正' : '添加'}维护` : editor?.kind === 'sale' ? editor.draft.mode === 'sell' ? '记录售出' : editor.draft.mode === 'correct' ? '更正售出' : '撤销售出' : editor?.kind === 'lifecycle' ? editor.action.type === 'append' ? kindLabel(editor.action.kind) : '更正状态日期' : '';
  const deleteName = (current: Extract<Editor, { kind: 'delete' }>) => {
    if (!current.recordId) return current.record.asset.name;
    if (current.recordKind === 'maintenance') return current.record.maintenances.find(m => m.id === current.recordId)?.fields.title || '维护记录';
    const kind = current.record.warranties.find(w => w.id === current.recordId)?.fields.kind;
    return `${warrantyKinds.find(([id]) => id === kind)?.[1] ?? ''}保障`;
  };
  const coverPhoto = record?.photos.find(p => p.id === record.cover_id), attachments = record?.photos.filter(p => p.id !== record.cover_id) ?? [];
  const category = record ? context?.taxonomy.categories.find(c => c.id === record.classification?.category_id)?.name ?? '未分类' : '';
  const channel = record ? context?.taxonomy.channels.find(c => c.id === record.classification?.channel_id)?.name : undefined;
  const brandModel = record ? [record.details.brand, record.details.model].filter(Boolean).join(' / ') : '';
  const retired = record?.lifecycle?.state === 'retired', sold = record?.lifecycle?.state === 'sold';
  const actions: { key: string; icon: GlyphName; label: string; onClick: () => void }[] = record && context ? [
    { key: 'maintenance', icon: 'wrench', label: '记维护', onClick: () => openMaintenance() },
    { key: 'warranty', icon: 'shieldPlus', label: '加保障', onClick: () => openWarranty() },
    record.sale ? { key: 'sale', icon: 'sell', label: '更正售出', onClick: () => openSale('correct') } : { key: 'sale', icon: 'sell', label: '记录售出', onClick: () => openSale('sell') },
    ...(sold ? [] : [{ key: 'lifecycle', icon: retired ? 'undo' : 'archive', label: retired ? '撤销退役' : '退役', onClick: () => setEditor({ ...context, kind: 'lifecycle', action: { type: 'append', kind: retired ? 'activate' : 'retire', date: session.today, notes: '' } }) } as const]),
  ] : [];
  return <div className="m-page mi-detail">
    <NavBar right={record ? <><button type="button" className="m-navbar-button mi-nav-icon mi-nav-danger" aria-label="删除物品" disabled={disabled} onClick={() => setEditor({ ...context!, kind: 'delete' })}><Glyph name="trash" size={22}/></button><button type="button" className="m-navbar-button mi-nav-icon" aria-label="编辑" disabled={disabled} onClick={() => nav.push('items.edit', { id })}><Glyph name="pencil" size={22}/></button></> : undefined}/>
    {typeof params.notice === 'string' && params.notice && <Notice tone="positive">{params.notice}</Notice>}
    {loading ? <Loading/> : error ? <ErrorState message={error} onRetry={() => setRevision(value => value + 1)}/> : !record || !context ? <EmptyState title="找不到这件物品" message="物品可能已移入最近删除。" action={<Button onClick={() => nav.pop()}>返回物品</Button>}/> : <>
      <header className="mi-head"><span className="mi-head-icon">{coverPhoto ? <PhotoView photo={coverPhoto} generation={context.generation} compact/> : <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt('icon-box'))} alt="默认物品图标"/>}</span><div className="mi-head-text"><h1>{record.asset.name}</h1><p className="mi-meta">{category} · {stateLabel(record)} · {warrantySummaryText(record.warranty_summary)}</p></div></header>
      <MetricGrid><Metric label={record.preferences?.cost_mode === 'per_use' ? '单次使用成本' : record.sale ? '售出后净日均成本' : '日均成本'} value={unitMoneyText(record.preferences?.cost_mode === 'per_use' ? record.per_use_cents ?? null : record.costs.daily_cents)} sub={record.preferences?.cost_mode === 'per_use' ? `已使用 ${record.preferences.use_count} 次` : '按自然日，含购入当天'}/><Metric label={record.sale ? '截至售出日持有' : '已持有'} value={record.costs.held_days === null ? UNKNOWN : `${record.costs.held_days.toLocaleString('zh-CN')} 天`} unknown={record.costs.held_days === null}/></MetricGrid>
      <div className="mi-actions" role="group" aria-label="物品操作">{actions.map(action => <button key={action.key} type="button" className="mi-action" disabled={disabled} onClick={action.onClick}><Glyph name={action.icon} size={22}/><span>{action.label}</span></button>)}</div>
      {goal && <Card className="mi-goal" label="目标进度"><strong>{record.preferences?.goal.mode === 'cost' ? `目标 ${unitMoneyText(record.preferences.goal.cents)} / ${record.preferences.cost_mode === 'per_use' ? '次' : '天'}` : record.preferences?.goal.mode === 'date' ? `目标 ${record.preferences.goal.date}` : ''}</strong><p>{goal.progress ? `${(goal.progress.hundredths / 100).toFixed(2)}%` : '进度未知'}</p>{goal.progress && <progress aria-label="目标进度" max={10000} value={goal.progress.hundredths}/>}<p>{goal.frozen ? `退役后目标停止，停在 ${dayLabel(goal.frozen, session.today)}` : record.sale ? '按售出日结算' : goal.progress ? goal.progress.hundredths === 10000 ? '目标已达成' : `还需 ${goal.progress.remaining} ${goal.progress.unit}${goal.progress.reached_date ? ` · 预计 ${dayLabel(goal.progress.reached_date, session.today)}` : ''}；新增维护会推迟达成。` : '补全购入金额、日期及维护费用后计算。'}</p></Card>}
      {incompleteCostReason(record) && <Notice>{incompleteCostReason(record)}</Notice>}
      <ListGroup title="详情"><ListRow title="购入价" value={moneyText(record.asset.price_cents)} unknown={record.asset.price_cents === null}/><ListRow title="购入日期" value={dateText(record.asset.purchase_date)} unknown={!record.asset.purchase_date}/>{channel && <ListRow title="购买渠道" value={channel}/>}{brandModel && <ListRow title="品牌 / 型号" value={brandModel}/>}{record.details.serial_number && <ListRow title="序列号" value={record.details.serial_number}/>}<ListRow title="已知维护投入" value={moneyText(record.costs.known_maintenance_cents)}/><ListRow title="总投入" value={moneyText(record.costs.total_investment_cents)} unknown={record.costs.total_investment_cents === null}/>{record.sale && <ListRow title="售出后净成本" value={moneyText(record.costs.net_cost_cents)} unknown={record.costs.net_cost_cents === null}/>}{record.origin_wishlist && <ListRow title="来源心愿" value={record.origin_wishlist.name} onClick={() => nav.push('wishes.detail', { id: record.origin_wishlist!.id })}/>}<ListRow title="置顶" trailing={<Switch label="置顶" checked={!!record.preferences?.pinned} disabled={disabled} onChange={pinned => void togglePin(pinned)}/>}/></ListGroup>
      <ListGroup title="备注"><p className="mi-note">{optionalText(record.details.notes)}</p><div className="mi-note-photos"><PhotoThumbs photos={attachments} generation={context.generation} onOpen={setPhoto} onAdd={() => nav.push('items.edit', { id })} addDisabled={disabled}/></div></ListGroup>
      <ListGroup title="保障" action={<Button variant="plain" disabled={disabled} onClick={() => openWarranty()}>+ 添加</Button>}>
        {record.warranties.length ? record.warranties.map(w => <div key={w.id}><ListRow title={<>{warrantyKinds.find(([kind]) => kind === w.fields.kind)?.[1]} · {statusLabel[w.status]}</>} subtitle={`${w.fields.provider ? w.fields.provider + ' · ' : ''}${w.fields.start_date ? dayLabel(w.fields.start_date, session.today) : '开始日期未知'} — ${w.fields.end_date ? dayLabel(w.fields.end_date, session.today) : '结束日期未知'}${w.remaining_days !== null ? ` · 剩 ${w.remaining_days} 天` : ''}`} onClick={() => openWarranty(w)}/><ListRow title="到期通知" trailing={<Switch label={`${warrantyKinds.find(([kind]) => kind === w.fields.kind)?.[1]}到期通知`} checked={!!w.reminder} disabled={disabled} onChange={enabled => void toggleReminder(w, enabled)}/>}/>{w.fields.notes && <p className="mi-record-note">{w.fields.notes}</p>}<Attachments photos={w.photos} generation={context.generation} onOpen={setPhoto}/></div>) : <ListRow title="暂无保障记录" subtitle="未知日期不会被视为保障中"/>}
      </ListGroup>
      <ListGroup title="维护记录" action={<Button variant="plain" disabled={disabled} onClick={() => openMaintenance()}>+ 添加</Button>}>
        {record.maintenances.length ? record.maintenances.map(m => <div key={m.id}><ListRow title={m.fields.title} subtitle={`${m.fields.date ? dayLabel(m.fields.date, session.today) : '日期未知'} · ${maintenanceKinds.find(([kind]) => kind === m.fields.kind)?.[1]}${m.fields.provider ? ' · ' + m.fields.provider : ''}`} value={moneyText(m.fields.cost_cents)} unknown={m.fields.cost_cents === null} onClick={() => openMaintenance(m.id)}/>{m.fields.description && <p className="mi-record-note">{m.fields.description}</p>}<Attachments photos={m.photos} generation={context.generation} onOpen={setPhoto}/></div>) : <ListRow title="暂无维护记录" subtitle="维修、保养、换件与配件费用都会计入投入"/>}
      </ListGroup>
      {record.sale && <ListGroup title="售出记录"><ListRow title="售价" value={moneyText(record.sale.fields.price_cents)}/><ListRow title="售出日期" value={record.sale.fields.date}/><ListRow title="平台与买家" value={[record.sale.fields.platform, record.sale.fields.buyer].filter(Boolean).join(' · ') || NOT_SET}/>{record.sale.fields.notes && <p className="mi-note">{record.sale.fields.notes}</p>}<ListRow title="更正售出" onClick={() => openSale('correct')}/><ListRow title="撤销误记售出" onClick={() => openSale('revoke')}/></ListGroup>}
      {!!record.lifecycle?.events.length && <ListGroup title="状态记录">{record.lifecycle.events.map(event => <ListRow key={event.id} title={kindLabel(event.kind)} subtitle={event.notes} value={dayLabel(event.date, session.today)} onClick={() => setEditor({ ...context, kind: 'lifecycle', action: { type: 'correct_date', event_id: event.id, date: event.date } })}/>)}</ListGroup>}
    </>}
    {notice && !editor && <Notice tone="danger">{notice}</Notice>}
    {editor?.kind === 'delete' && <DeleteSheet name={deleteName(editor)} busy={disabled} error={notice} onClose={closeEditor} onConfirm={() => void saveEditor()}>{!editor.recordId && <p className="m-confirm-text">保障、维护记录和图片会一起移入。</p>}</DeleteSheet>}
    {editor && editor.kind !== 'delete' && <Sheet title={title} doneLabel="取消" onClose={closeEditor}>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {editor.kind === 'warranty' && <FormGroup><SelectField label="保障类型" value={editor.fields.kind} options={warrantyKinds.map(([id, label]) => ({ id, label }))} onChange={value => setEditor({ ...editor, fields: { ...editor.fields, kind: value as WarrantyDraft['kind'] } })}/><TextField label="提供方" value={editor.fields.provider} onChange={provider => setEditor({ ...editor, fields: { ...editor.fields, provider } })}/><DateField label="开始日期" allowClear value={editor.fields.start} onChange={start => setEditor({ ...editor, fields: { ...editor.fields, start } })}/><DateField label="结束日期" allowClear value={editor.fields.end} onChange={end => setEditor({ ...editor, fields: { ...editor.fields, end } })}/><TextAreaField label="保障备注" value={editor.fields.notes} onChange={notes => setEditor({ ...editor, fields: { ...editor.fields, notes } })}/><ListRow title="启用到期通知" subtitle="所选日期上午 9:00 通知" trailing={<Switch label="启用保障到期通知" checked={!!editor.fields.reminder} onChange={enabled => { setEditor({ ...editor, fields: { ...editor.fields, reminder: enabled ? { date: editor.fields.end, notes: '' } : null } }); if (enabled) void allowReminders().catch(cause => setNotice(errorMessage(cause))); }}/>}/>{editor.fields.reminder && <><DateField label="提醒日期" value={editor.fields.reminder.date} max={editor.fields.end || undefined} onChange={date => setEditor({ ...editor, fields: { ...editor.fields, reminder: { ...editor.fields.reminder!, date } } })}/><TextField label="提醒备注" value={editor.fields.reminder.notes} onChange={notes => setEditor({ ...editor, fields: { ...editor.fields, reminder: { ...editor.fields.reminder!, notes } } })}/></>}</FormGroup>}
      {editor.kind === 'maintenance' && <FormGroup><SelectField label="维护类型" value={editor.fields.kind} options={maintenanceKinds.map(([id, label]) => ({ id, label }))} onChange={kind => setEditor({ ...editor, fields: { ...editor.fields, kind: kind as MaintenanceDraft['kind'] } })}/><TextField label="维护标题" value={editor.fields.title} onChange={title => setEditor({ ...editor, fields: { ...editor.fields, title } })}/><MoneyField label="维护费用" value={minorFromDecimal(editor.fields.cost)} hint="留空表示未知；免费请填 0" onChange={cost => setEditor({ ...editor, fields: { ...editor.fields, cost: decimalFromMinor(cost) } })}/><DateField label="维护日期" allowClear max={session.today} value={editor.fields.date ?? ''} onChange={date => setEditor({ ...editor, fields: { ...editor.fields, date: date || null } })}/><TextField label="服务方" value={editor.fields.provider} onChange={provider => setEditor({ ...editor, fields: { ...editor.fields, provider } })}/><TextAreaField label="维护说明" value={editor.fields.description} onChange={description => setEditor({ ...editor, fields: { ...editor.fields, description } })}/></FormGroup>}
      {(editor.kind === 'maintenance' || editor.kind === 'warranty') && <><Attachments photos={editor.photos.filter(p => editor.fields.photo_ids.includes(p.id))} generation={editor.generation} onOpen={setPhoto}/><Button disabled={disabled} onClick={() => camera.current?.click()}>拍摄凭证</Button><Button disabled={disabled} onClick={() => album.current?.click()}>从相册添加凭证（可多选）</Button><input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={event => { void addPhoto(event.target.files); event.target.value = ''; }}/><input ref={album} type="file" accept="image/*" multiple hidden onChange={event => { void addPhoto(event.target.files); event.target.value = ''; }}/>{editor.photos.filter(p => editor.fields.photo_ids.includes(p.id)).map(p => <Button key={p.id} onClick={() => { if (editor.kind === 'warranty') setEditor({ ...editor, fields: { ...editor.fields, photo_ids: editor.fields.photo_ids.filter(value => value !== p.id) } }); else setEditor({ ...editor, fields: { ...editor.fields, photo_ids: editor.fields.photo_ids.filter(value => value !== p.id) } }); }}>移除 {p.name}</Button>)}</>}
      {editor.kind === 'sale' && (editor.draft.mode === 'revoke' ? <Notice>仅用于撤销误记售出，会恢复售出前的状态。真实购回请另建物品档案。</Notice> : <FormGroup><DateField label="售出日期" value={editor.draft.fields.date} max={session.today} onChange={date => setEditor({ ...editor, draft: { ...editor.draft, fields: { ...editor.draft.fields, date } } })}/><MoneyField label="实际售价" value={minorFromDecimal(editor.draft.fields.price)} hint="售价为零请填写 0" onChange={price => setEditor({ ...editor, draft: { ...editor.draft, fields: { ...editor.draft.fields, price: decimalFromMinor(price) } } })}/><TextField label="售出平台" value={editor.draft.fields.platform} onChange={platform => setEditor({ ...editor, draft: { ...editor.draft, fields: { ...editor.draft.fields, platform } } })}/><TextField label="买家" value={editor.draft.fields.buyer} onChange={buyer => setEditor({ ...editor, draft: { ...editor.draft, fields: { ...editor.draft.fields, buyer } } })}/><TextAreaField label="售出备注" value={editor.draft.fields.notes} onChange={notes => setEditor({ ...editor, draft: { ...editor.draft, fields: { ...editor.draft.fields, notes } } })}/></FormGroup>)}
      {editor.kind === 'lifecycle' && <FormGroup><DateField label="动作日期" max={session.today} value={editor.action.date} onChange={date => setEditor({ ...editor, action: { ...editor.action, date } })}/>{editor.action.type === 'append' && <TextAreaField label="状态备注" value={editor.action.notes} onChange={notes => setEditor({ ...editor, action: { ...editor.action as Extract<LifecycleAction, { type: 'append' }>, notes } })}/>}<Notice>状态日期保留在记录中，退役后目标停止推进。</Notice></FormGroup>}
      {notice && <Notice tone="danger">{notice}</Notice>}{photoError && <><ErrorState title="凭证未全部读取" message={photoError}/><Button onClick={() => setPhotoError('')}>不使用未读取的图片</Button></>}
      <div className="mi-form-actions"><Button variant="primary" disabled={disabled || !!photoError} onClick={() => void saveEditor()}>保存</Button></div>
      {(editor.kind === 'warranty' || editor.kind === 'maintenance') && editor.id && <Button variant="danger" disabled={disabled} onClick={() => setEditor({ ...editor, kind: 'delete', recordId: editor.id, recordKind: editor.kind })}>删除这条记录</Button>}
      {editor.kind === 'lifecycle' && editor.action.type === 'correct_date' && <Button variant="danger" disabled={disabled} onClick={() => { try { const input = detailLifecycleInput(editor.record, editor.generation, editor.action, session.today, true); void write({ command: 'change_lifecycle', input, label: '撤销误记状态' }); } catch (cause) { setNotice(errorMessage(cause)); } }}>撤销误记状态</Button>}
      </fieldset>
    </Sheet>}
    {photo && context && <PhotoViewer photo={photo} generation={context.generation} onClose={() => setPhoto(null)}/>}
  </div>;
}
function Attachments({ photos, generation, onOpen }: { photos: Photo[]; generation: string; onOpen: (photo: Photo) => void }) {
  return photos.length ? <div className="mi-photo-strip" aria-label="图片附件">{photos.map(p => <button key={p.id} aria-label={'预览 ' + p.name} onClick={() => onOpen(p)}><PhotoView photo={p} generation={generation} compact/></button>)}</div> : null;
}
