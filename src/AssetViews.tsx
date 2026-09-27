import type { TaxonomySnapshot } from './taxonomy';
import { useState } from 'react';
import type { AssetRecord, Page, Photo } from './asset';
import { localDay, money } from './asset';
import { maintenanceKinds } from './maintenance';
import { statusLabel, warrantyKinds, warrantySummaryText } from './warranty';
import type { Warranty } from './warranty';
import type { SaleDraft } from './sales';
import { stateLabel, kindLabel } from './lifecycle';
import type { LifecycleAction } from './lifecycle';
import { Cover, Gallery, PhotoPreview, PhotoView } from './Photos';
import { Timeline } from './Timeline';

function MaintenancePhotos({ photos, generation }: { photos: Photo[]; generation: string }) {
  const [preview, setPreview] = useState<Photo | null>(null);
  return <><div className="photo-strip">{photos.map(photo => <button className="photo-tile" key={photo.id} aria-label={'预览维护图片 ' + photo.name} onClick={() => setPreview(photo)}><PhotoView photo={photo} generation={generation}/><span className="photo-name">{photo.name}</span></button>)}</div>{preview && <PhotoPreview photo={preview} generation={generation} onClose={() => setPreview(null)}/>}</>;
}

function WarrantyPhotos({ photos, generation }: { photos: Photo[]; generation: string }) {
  const [preview, setPreview] = useState<Photo | null>(null);
  return <><div className="photo-strip">{photos.map(photo => <button className="photo-tile" key={photo.id} aria-label={'预览保障图片 ' + photo.name} onClick={() => setPreview(photo)}><PhotoView photo={photo} generation={generation}/><span className="photo-name">{photo.name}</span></button>)}</div>{preview && <PhotoPreview photo={preview} generation={generation} onClose={() => setPreview(null)}/>}</>;
}

function warrantyRange(item: Warranty) {
  const start = item.fields.start_date ?? '起日期未知';
  const end = item.fields.end_date ?? '止日期未知';
  return `${start} – ${end}`;
}
function warrantyLine(item: Warranty) {
  const parts = [warrantyRange(item), statusLabel[item.status]];
  if (item.remaining_days !== null) parts.push(`剩余 ${item.remaining_days} 天`);
  return parts.join(' · ');
}

const iconPaths = {items:'M3 6.5 10 3l7 3.5v8L10 18l-7-3.5z M3 6.5l7 3.5 7-3.5M10 10v8M6.5 4.7l7 3.5',overview:'M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z',circle:'M16 10a6 6 0 1 1-12 0 6 6 0 1 1 12 0M7 10l2 2 4-4',archive:'M3 4h14v4H3zM4 8v9h12V8M8 11h4',arrow:'M3 10h13M12 6l4 4-4 4',heart:'M10 17 3.5 10.5C-1 5.5 5 0 10 6c5-6 11-.5 6.5 4.5Z',clock:'M17 10a7 7 0 1 1-14 0 7 7 0 1 1 14 0M10 6v4l3 2',chart:'M4 15v-4M10 15V4M16 15V8',trash:'M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6',settings:'M3 5h14M3 15h14M6 3v4M14 13v4M3 10h14M11 8v4',search:'M13 8a5 5 0 1 1-10 0 5 5 0 1 1 10 0M12 12l5 5',plus:'M10 4v12M4 10h12',list:'M7 5h10M7 10h10M7 15h10M3 5h.1M3 10h.1M3 15h.1',grid:'M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z',close:'M5 5l10 10M15 5 5 15',back:'M16 10H4M8 6l-4 4 4 4',image:'M3 3h14v14H3zM3 14l5-5 4 4 2-2 3 3M13 6h.1',expand:'M11 3h6v6M17 3l-7 7M7 3H3v14h14v-4',chevron:'M7 4l6 6-6 6',sort:'M7 4v12M4 13l3 3 3-3M14 16V4M11 7l3-3 3 3',edit:'m4 13 9-9 3 3-9 9-4 1z',sun:'M10 7a3 3 0 1 0 0 6 3 3 0 1 0 0-6M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4',moon:'M17 11.8A7.2 7.2 0 0 1 8.2 3 7.2 7.2 0 1 0 17 11.8Z'} as const;
export function Icon({ name }: { name: keyof typeof iconPaths | 'system' }) {
  if (name === 'sun') return <svg className="ui-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="10" r="3.55" fill="currentColor" stroke="none"/><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M15.8 4.2l-1.5 1.5M5.7 14.3l-1.5 1.5"/></svg>;
  if (name === 'system') return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.3a7.7 7.7 0 0 0 0 15.4Z" fill="#fff"/><path d="M10 2.3a7.7 7.7 0 0 1 0 15.4Z" fill="#202329"/><circle cx="10" cy="10" r="7.7" fill="none" stroke="currentColor" strokeWidth="1.1"/></svg>;
  return <svg className="ui-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} fill={name === 'moon' ? 'currentColor' : 'none'} strokeWidth={name === 'moon' ? 0.6 : undefined}/></svg>;
}

export function AssetOverview({ page, filtered }: { page: Page; filtered: boolean }) {
  const counted=page.items.filter(r=>!r.preferences?.exclude.total);
  const held = counted.filter(r => r.lifecycle?.state !== 'sold');
  const known = held.filter(r => r.asset.price_cents !== null);
  const total = known.reduce((sum, r) => sum + BigInt(r.asset.price_cents!), 0n);
  const unknown = held.length - known.length;
  return <div className="asset-overview" aria-label="当前结果概览">
    <div><span>{filtered ? '筛选结果 · 本页持有' : '本页当前持有'}</span><strong>{held.length}<small>件物品</small></strong><p>使用中 {held.filter(r => (r.lifecycle?.state ?? 'active') === 'active').length} · 已退役 {held.filter(r => r.lifecycle?.state === 'retired').length}</p></div>
    <div><span>本页持有物购入金额</span><strong>{known.length ? money(total.toString()) : held.length ? '待补充' : money('0')}</strong><p>{unknown ? `${unknown} 件金额未知，未计入 · ` : ''}不含已售出</p></div>
    <div><span>本页已售出</span><strong>{counted.length - held.length}<small>件物品</small></strong><p>档案与来历仍然保留</p></div>
  </div>;
}

export function AssetFacts({ record, today, taxonomy, compact = false }: { record: AssetRecord; today: string; taxonomy: TaxonomySnapshot | null; compact?: boolean }) {
  const c = record.costs;
  const perUse=record.preferences?.cost_mode==='per_use',unitCost=perUse?record.per_use_cents??null:c.daily_cents;
  return <><div className="holding-cost"><span>{perUse?'单次使用成本':record.sale ? '售出后净日均成本' : '日均持有成本'}</span><strong>{money(unitCost)}{unitCost !== null && <small> / {perUse?'次':'天'}</small>}</strong><p>{perUse?`已记录 ${record.preferences?.use_count??0} 次使用`:compact ? (record.sale ? '净生命周期成本 ÷ 持有天数' : '购入与已记录维护费用 ÷ 持有天数') : c.held_days === null ? '补全购入日期后计算持有天数' : `${record.sale ? '截至售出日持有' : '已与你相伴'} ${c.held_days} 天`}</p></div>
    {compact ? <dl className="facts"><dt>购入金额</dt><dd>{money(record.asset.price_cents)}</dd><dt>购入日期</dt><dd>{record.asset.purchase_date || '待补充'}</dd><dt>持有时长</dt><dd>{c.held_days === null ? '待补充' : `${c.held_days.toLocaleString('zh-CN')} 天`}</dd><dt>维护投入</dt><dd>{money(c.known_maintenance_cents)}</dd></dl> : <dl className="facts"><dt>购入金额</dt><dd>{money(record.asset.price_cents)}</dd><dt>维护投入</dt><dd>{money(c.known_maintenance_cents)}</dd><dt>总投入</dt><dd>{money(c.total_investment_cents)}</dd><dt>持有时长</dt><dd>{c.held_days === null ? '待补充' : `${c.held_days.toLocaleString('zh-CN')} 天`}</dd></dl>}
    {record.sale && <p className="sale-net">净生命周期成本 {money(c.net_cost_cents)}</p>}{c.unknown_maintenance_count > 0 && <p className="muted small">有 {c.unknown_maintenance_count} 条维护费用待补录，精确总成本与日均成本暂不显示。</p>}
    {(record.warranty_summary?.total ?? 0) > 0 && <p className="muted small">保障：{warrantySummaryText(record.warranty_summary)}</p>}</>;
}

export function AssetDetail({ record, generation, today, taxonomy, onEdit, onDelete, onLifecycle, onSale, onMaintenance, onWarranty, onTrashMaintenance, onTrashWarranty, onOpenWish }: { onOpenWish?: (id: string) => void; taxonomy: TaxonomySnapshot | null; record: AssetRecord; generation: string; today: string; onEdit: () => void; onDelete: () => void; onLifecycle: (action: LifecycleAction) => void; onSale: (mode: SaleDraft['mode']) => void; onMaintenance: (id?: string) => void; onWarranty: (id?: string) => void; onTrashMaintenance: (id: string) => void; onTrashWarranty: (id: string) => void }) {
  const warranties = record.warranties ?? [];
  return <><header className="asset-hero"><Cover record={record} generation={generation} taxonomy={taxonomy} large/><div className="hero-copy"><div className="hero-meta">{taxonomy?.categories.find(c => c.id === record.classification?.category_id)?.name ?? '未分类'} · <span className="pill" data-state={record.lifecycle?.state ?? 'active'}>{stateLabel(record)}</span></div>{record.label_name&&<span className="pill">{record.label_name}</span>}{(record.warranty_summary.active_count+record.warranty_summary.expiring_count)>0&&<span className="pill">保障中</span>}<h2 id="detail-heading" tabIndex={-1}>{record.asset.name}</h2><p className="muted">{[record.details.brand, record.details.model].filter(Boolean).join(' · ') || '一件物品，一段日常'}</p>{record.origin_wishlist && <p className="muted origin-wish">来自心愿「{record.origin_wishlist.name}」 · {record.origin_wishlist.estimated_price_cents === null ? '预计价格未知' : '预计 ' + money(record.origin_wishlist.estimated_price_cents)} · 加入 {localDay(new Date(record.origin_wishlist.created_at))}{onOpenWish && <button type="button" onClick={() => onOpenWish(record.origin_wishlist!.id)}>查看原心愿</button>}</p>}<div className="hero-actions"><button onClick={onEdit}>编辑资料 <kbd>⌘E</kbd></button><button onClick={() => onMaintenance()}>新增维护</button><button onClick={() => onWarranty()}>添加保障</button>{record.lifecycle?.state !== 'sold' && <button onClick={() => onLifecycle({type:'append',kind:record.lifecycle?.state === 'retired' ? 'activate' : 'retire',date:today,notes:''})}>{record.lifecycle?.state === 'retired' ? '重新启用' : '标记退役'}</button>}{!record.sale && <button onClick={() => onSale('sell')}>标记售出</button>}</div></div></header>
    <div className="detail-columns"><div className="detail-primary">
      <article className="detail-section ownership-card"><h3>持有与成本</h3><AssetFacts record={record} today={today} taxonomy={taxonomy}/><p className="muted small">{record.preferences?.cost_mode==='per_use'?'总投入除以已记录次数；售出后使用净成本。':'按自然日计算，包含购入当天；售出后截止到售出日。'}</p>{record.preferences?.goal.mode==='cost'&&<p>目标单位成本：{money(record.preferences.goal.cents)}</p>}{record.preferences?.goal.mode==='date'&&<p>目标日期：{record.preferences.goal.date}</p>}</article>
      <article className="detail-section"><h3>购买资料</h3><dl className="facts"><dt>购入日期</dt><dd>{record.asset.purchase_date || '待补充'}</dd><dt>购买渠道</dt><dd>{taxonomy?.channels.find(c => c.id === record.classification?.channel_id)?.name ?? '未记录'}</dd><dt>品牌</dt><dd>{record.details.brand || '待补充'}</dd><dt>型号</dt><dd>{record.details.model || '待补充'}</dd><dt>序列号</dt><dd>{record.details.serial_number || '待补充'}</dd></dl></article>
      <article className="detail-section"><h3>关于这件物品</h3><p className="notes">{record.details.notes || '还没有备注。记下购买的缘由，或使用中的小细节。'}</p></article>
    </div><div className="detail-secondary">
    <article className="detail-section"><div className="section-heading"><h3>物品时间轴</h3><span>最新记录在前</span></div><Timeline assetId={record.asset.id} version={record} onCorrect={e => onLifecycle({type:'correct_date',event_id:e.id.slice('lifecycle:'.length),date:e.date ?? today})}/></article>
    {record.sale && <article className="detail-section sale-record"><div className="section-heading"><h3>售出记录</h3><span>持有天数已截止到售出日</span></div><dl className="facts"><dt>售出日期</dt><dd>{record.sale.fields.date}</dd><dt>实际售价</dt><dd>{money(record.sale.fields.price_cents)}</dd><dt>出售平台</dt><dd>{record.sale.fields.platform || '未记录'}</dd><dt>买家</dt><dd>{record.sale.fields.buyer || '未记录'}</dd><dt>备注</dt><dd className="notes">{record.sale.fields.notes || '未记录'}</dd></dl><div className="actions"><button onClick={() => onSale('correct')}>修改售出记录</button><button onClick={() => onSale('revoke')}>撤销误记售出…</button></div><p className="muted small">真实卖出后又买回，请使用“新增物品”建立另一份档案，保留这次处置记录。</p></article>}
    <article className="detail-section warranty-history"><div className="section-heading"><h3>保障档案</h3><span>{warrantySummaryText(record.warranty_summary ?? { status: 'none', total: 0, active_count: 0, expiring_count: 0, upcoming_count: 0, expired_count: 0, pending_count: 0 })}</span></div>{warranties.length ? <ol>{warranties.map(item => <li key={item.id}><div><strong>{warrantyKinds.find(([k]) => k === item.fields.kind)?.[1] ?? '保障'}{item.fields.provider && ` · ${item.fields.provider}`}</strong><span className="muted">{warrantyLine(item)}</span>{item.fields.notes && <p className="notes">{item.fields.notes}</p>}<WarrantyPhotos photos={item.photos} generation={generation}/></div><div className="record-actions"><button onClick={() => onWarranty(item.id)}>更正</button><button className="danger" onClick={() => onTrashWarranty(item.id)}>删除…</button></div></li>)}</ol> : <p className="muted">还没有保障记录。厂家保修、延保或 AppleCare 都可以分别添加。</p>}</article>
    <article className="detail-section maintenance-history"><div className="section-heading"><h3>维护档案</h3><span>{record.maintenances.length} 条 · 已知费用 {money(record.costs.known_maintenance_cents)}</span></div>{record.maintenances.length ? <ol>{record.maintenances.map(item=><li key={item.id}><div><strong>{item.fields.title || maintenanceKinds.find(([k])=>k===item.fields.kind)?.[1] || '维护'}</strong><span className="muted">{item.fields.date || '日期未知'} · {money(item.fields.cost_cents)}{item.fields.provider && ` · ${item.fields.provider}`}</span>{item.fields.description && <p className="notes">{item.fields.description}</p>}<MaintenancePhotos photos={item.photos} generation={generation}/></div><div className="record-actions"><button onClick={()=>onMaintenance(item.id)}>更正</button><button className="danger" onClick={()=>onTrashMaintenance(item.id)}>删除…</button></div></li>)}</ol>:<p className="muted">还没有维护记录。</p>}</article>
    <article className="detail-section"><div className="section-heading"><h3>图片附件</h3><span>{record.photos.length} 张</span></div><Gallery record={record} generation={generation} showHeading={false}/></article>
    </div></div>
    <footer className="detail-footer"><details className="archive-meta"><summary>档案信息</summary><dl className="facts"><dt>建档时间</dt><dd>{record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '旧记录未提供'}</dd><dt>修改时间</dt><dd>{record.updated_at ? new Date(record.updated_at).toLocaleString('zh-CN') : '旧记录未提供'}</dd><dt>档案编号</dt><dd><code>{record.asset.id}</code></dd><dt>保存版本</dt><dd>{record.asset.revision}</dd></dl></details><button className="danger" onClick={onDelete}>移入最近删除…</button></footer>
  </>;
}
