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
import { goalProgress } from './preferences';

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

const iconPaths = {items:'M3 6.5 10 3l7 3.5v8L10 18l-7-3.5z M3 6.5l7 3.5 7-3.5M10 10v8M6.5 4.7l7 3.5',overview:'M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z',circle:'M16 10a6 6 0 1 1-12 0 6 6 0 1 1 12 0M7 10l2 2 4-4',archive:'M3 4h14v4H3zM4 8v9h12V8M8 11h4',arrow:'M3 10h13M12 6l4 4-4 4',heart:'M10 17 3.5 10.5C-1 5.5 5 0 10 6c5-6 11-.5 6.5 4.5Z',clock:'M17 10a7 7 0 1 1-14 0 7 7 0 1 1 14 0M10 6v4l3 2',chart:'M4 15v-4M10 15V4M16 15V8',wallet:'M3 6h14v11H3zM3 6l10-3v3M17 10h-4a1.5 1.5 0 0 0 0 3h4',receipt:'M5 2.5h10v15l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3zM8 7h4M8 10h4M8 13h2',repeat:'M4 9a6 6 0 0 1 10.4-4.1L16 6.5M16 3v3.5h-3.5M16 11a6 6 0 0 1-10.4 4.1L4 13.5M4 17v-3.5h3.5',trash:'M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6',settings:'M3 5h14M3 15h14M6 3v4M14 13v4M3 10h14M11 8v4',search:'M13 8a5 5 0 1 1-10 0 5 5 0 1 1 10 0M12 12l5 5',plus:'M10 4v12M4 10h12',list:'M7 5h10M7 10h10M7 15h10M3 5h.1M3 10h.1M3 15h.1',grid:'M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM12 12h5v5h-5z',close:'M5 5l10 10M15 5 5 15',back:'M16 10H4M8 6l-4 4 4 4',image:'M3 3h14v14H3zM3 14l5-5 4 4 2-2 3 3M13 6h.1',expand:'M11 3h6v6M17 3l-7 7M7 3H3v14h14v-4',chevron:'M7 4l6 6-6 6',sort:'M7 4v12M4 13l3 3 3-3M14 16V4M11 7l3-3 3 3',edit:'m4 13 9-9 3 3-9 9-4 1z',sun:'M10 7a3 3 0 1 0 0 6 3 3 0 1 0 0-6M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4',shield:'M10 2.5 16 5v5c0 3.6-2.6 6.4-6 7.5-3.4-1.1-6-3.9-6-7.5V5zM7.3 10l1.9 1.9 3.6-3.8',select:'M6.5 6.5h10v10h-10zM3.5 13.5v-10h10M9 11.5l1.8 1.8 3.4-3.6',cloud:'M6 15.5h8.2a3.3 3.3 0 0 0 .5-6.6A4.8 4.8 0 0 0 5.4 8.4 3.6 3.6 0 0 0 6 15.5Z',moon:'M17 11.8A7.2 7.2 0 0 1 8.2 3 7.2 7.2 0 1 0 17 11.8Z'} as const;
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

export function AssetFacts({ record }: { record: AssetRecord }) {
  const c = record.costs;
  const perUse=record.preferences?.cost_mode==='per_use',unitCost=perUse?record.per_use_cents??null:c.daily_cents;
  return <><div className="holding-cost"><span>{perUse?'单次使用成本':record.sale ? '售出后净日均成本' : '日均持有成本'}</span><strong>{money(unitCost)}{unitCost !== null && <small> / {perUse?'次':'天'}</small>}</strong><p>{perUse?`已记录 ${record.preferences?.use_count??0} 次使用`:record.sale ? '净生命周期成本 ÷ 持有天数' : '购入与已记录维护费用 ÷ 持有天数'}</p></div>
    <dl className="facts"><dt>购入金额</dt><dd>{money(record.asset.price_cents)}</dd><dt>购入日期</dt><dd>{record.asset.purchase_date || '待补充'}</dd><dt>持有时长</dt><dd>{heldText(c.held_days)}</dd><dt>维护投入</dt><dd>{money(c.known_maintenance_cents)}</dd></dl>
    {record.sale && <p className="sale-net">净生命周期成本 {money(c.net_cost_cents)}</p>}{c.unknown_maintenance_count > 0 && <p className="muted small">有 {c.unknown_maintenance_count} 条维护费用待补录，精确总成本与日均成本暂不显示。</p>}
    {(record.warranty_summary?.total ?? 0) > 0 && <p className="muted small">保障：{warrantySummaryText(record.warranty_summary)}</p>}</>;
}

const heldText = (days: number | null) => days === null ? '待补充' : `${days.toLocaleString('zh-CN')} 天`;

// Detail hero card: unit cost beside held days (use count for per-use), then the goal.
function CostHeadline({ record }: { record: AssetRecord }) {
  const c = record.costs, perUse = record.preferences?.cost_mode === 'per_use', unitCost = perUse ? record.per_use_cents ?? null : c.daily_cents;
  return <section className="hero-cost" aria-label="持有与成本"><div className="holding-cost holding-split"><div><span>{perUse?'单次使用成本':record.sale ? '售出后净日均成本' : '日均持有成本'}</span><strong>{money(unitCost)}{unitCost !== null && <small> / {perUse?'次':'天'}</small>}</strong></div><div><span>{perUse ? '使用次数' : record.sale ? '截至售出日持有' : '持有天数'}</span><strong>{perUse ? (record.preferences?.use_count ?? 0).toLocaleString('zh-CN') : c.held_days === null ? '待补充' : c.held_days.toLocaleString('zh-CN')}{(perUse || c.held_days !== null) && <small> {perUse ? '次' : '天'}</small>}</strong></div></div><GoalCard record={record}/></section>;
}

function EmptySection({ title, action, onAdd }: { title: string; action: string; onAdd: () => void }) {
  return <article className="detail-section detail-empty"><h3>{title}</h3><span className="muted">还没有记录</span><button onClick={onAdd}>{action}</button></article>;
}

function GoalCard({ record }: { record: AssetRecord }) {
  const p = record.preferences, c = record.costs;
  if (!p || p.goal.mode === 'none') return null;
  const perUse = p.cost_mode === 'per_use', cost = record.sale ? c.net_cost_cents : c.total_investment_cents;
  const g = c.unknown_maintenance_count > 0 ? null : goalProgress(p, cost, c.held_days, record.asset.purchase_date);
  const unitCost = perUse ? record.per_use_cents ?? null : c.daily_cents, per = perUse ? '次' : '天';
  const head = p.goal.mode === 'cost' ? <><span>目标{perUse ? '单次' : '日均'}成本</span><strong>{money(p.goal.cents)}<small> / {per}</small></strong></> : <><span>目标日期</span><strong>{p.goal.date}</strong></>;
  const done = g?.hundredths === 10000;
  return <div className="goal-card"><div className="goal-head"><div>{head}</div><div><span>总进度</span><strong>{g ? `${(g.hundredths / 100).toFixed(2)}%` : '待补充'}</strong></div></div>
    {g && <><div className="stats-bar" role="progressbar" aria-label="目标进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(g.hundredths / 100)}><span style={{ width: `${g.hundredths / 100}%` }}/></div>
    <p className="goal-line"><span>当前 {money(unitCost)}{unitCost !== null && ` / ${per}`}</span><span>{p.goal.mode === 'cost' ? `目标 ${money(p.goal.cents)}` : g.projected_cents === null ? '' : `到期预计 ${money(g.projected_cents)} / 天`}</span></p>
    {record.sale ? <p className="goal-line"><span>{done ? '售出前已达成' : '售出时未达成'}</span><span>按售出日结算</span></p>
      : done ? <p className="goal-line"><span>{g.reached_date && g.reached_date <= localDay() ? (p.goal.mode === 'date' ? '已到目标日' : `已于 ${g.reached_date} 达成`) : '已达成'}</span></p>
      : <p className="goal-line"><span>{p.goal.mode === 'date' ? '距目标日' : g.reached_date ? `预计达成 ${g.reached_date}` : `还需使用 ${g.remaining.toLocaleString('zh-CN')} 次`}</span>{g.unit === '天' && <span>还剩 {g.remaining.toLocaleString('zh-CN')} 天</span>}</p>}</>}
    <p className="muted small">{g ? (p.goal.mode === 'cost' && !record.sale && !done ? '按当前总投入推算，之后新增维护会推迟达成。' : '目标只记录计划，不改变物品状态。') : c.unknown_maintenance_count > 0 ? '有维护费用待补录，进度暂不计算。' : '补全购入金额与日期后计算进度。'}</p></div>;
}

export function AssetDetail({ record, generation, today, taxonomy, onEdit, onLifecycle, onSale, onMaintenance, onWarranty, onOpenWish }: { onOpenWish?: (id: string) => void; taxonomy: TaxonomySnapshot | null; record: AssetRecord; generation: string; today: string; onEdit: () => void; onLifecycle: (action: LifecycleAction) => void; onSale: (mode: SaleDraft['mode']) => void; onMaintenance: (id?: string) => void; onWarranty: (id?: string) => void; }) {
  const warranties = record.warranties ?? [];
  return <><header className="asset-hero"><Cover record={record} generation={generation} taxonomy={taxonomy} large/><div className="hero-copy"><div className="hero-meta">{taxonomy?.categories.find(c => c.id === record.classification?.category_id)?.name ?? '未分类'} · <span className="pill" data-state={record.lifecycle?.state ?? 'active'}>{stateLabel(record)}</span></div>{record.label_name&&<span className="pill">{record.label_name}</span>}{(record.warranty_summary.active_count+record.warranty_summary.expiring_count)>0&&<span className="pill">保障中</span>}<h2 id="detail-heading" tabIndex={-1}>{record.asset.name}</h2><p className="muted">{[record.details.brand, record.details.model].filter(Boolean).join(' · ') || '一件物品，一段日常'}</p>{record.origin_wishlist && <p className="muted origin-wish">来自心愿「{record.origin_wishlist.name}」 · {record.origin_wishlist.estimated_price_cents === null ? '预计价格未知' : '预计 ' + money(record.origin_wishlist.estimated_price_cents)} · 加入 {localDay(new Date(record.origin_wishlist.created_at))}{onOpenWish && <button type="button" onClick={() => onOpenWish(record.origin_wishlist!.id)}>查看原心愿</button>}</p>}<div className="hero-actions"><button onClick={onEdit}>编辑资料 <kbd>⌘E</kbd></button><button onClick={() => onMaintenance()}>新增维护</button><button onClick={() => onWarranty()}>添加保障</button>{record.lifecycle?.state !== 'sold' && <button onClick={() => onLifecycle({type:'append',kind:record.lifecycle?.state === 'retired' ? 'activate' : 'retire',date:today,notes:''})}>{record.lifecycle?.state === 'retired' ? '重新启用' : '退役'}</button>}{!record.sale && <button onClick={() => onSale('sell')}>售出</button>}</div></div><CostHeadline record={record}/></header>
    <div className="detail-columns"><div className="detail-primary">
      <article className="detail-section"><h3>购买与投入</h3><dl className="facts facts-grid"><dt>购入日期</dt><dd>{record.asset.purchase_date || '待补充'}</dd><dt>购买渠道</dt><dd>{taxonomy?.channels.find(c => c.id === record.classification?.channel_id)?.name ?? '未记录'}</dd><dt>购入金额</dt><dd>{money(record.asset.price_cents)}</dd><dt>维护投入</dt><dd>{money(record.costs.known_maintenance_cents)}</dd><dt>总投入</dt><dd>{money(record.costs.total_investment_cents)}</dd>{record.sale ? <><dt>净成本</dt><dd>{money(record.costs.net_cost_cents)}</dd></> : record.preferences?.cost_mode === 'per_use' && <><dt>持有时长</dt><dd>{heldText(record.costs.held_days)}</dd></>}<dt>序列号</dt><dd>{record.details.serial_number || '待补充'}</dd></dl><p className="muted small">{record.preferences?.cost_mode==='per_use'?'总投入除以已记录次数；售出后使用净成本。':'按自然日计算，包含购入当天；售出后截止到售出日。'}</p>{record.costs.unknown_maintenance_count > 0 && <p className="muted small">有 {record.costs.unknown_maintenance_count} 条维护费用待补录，精确总成本与日均成本暂不显示。</p>}</article>
      <article className="detail-section"><h3>关于这件物品</h3><p className="notes">{record.details.notes || '还没有备注。记下购买的缘由，或使用中的小细节。'}</p></article>
    {record.sale && <article className="detail-section sale-record"><div className="section-heading"><h3>售出记录</h3><span>持有天数已截止到售出日</span></div><dl className="facts"><dt>售出日期</dt><dd>{record.sale.fields.date}</dd><dt>实际售价</dt><dd>{money(record.sale.fields.price_cents)}</dd><dt>出售平台</dt><dd>{record.sale.fields.platform || '未记录'}</dd><dt>买家</dt><dd>{record.sale.fields.buyer || '未记录'}</dd><dt>备注</dt><dd className="notes">{record.sale.fields.notes || '未记录'}</dd></dl><div className="actions"><button onClick={() => onSale('correct')}>修改</button></div><p className="muted small">真实卖出后又买回，请使用“新增物品”建立另一份档案，保留这次处置记录。</p></article>}
    {warranties.length ? <article className="detail-section warranty-history"><div className="section-heading"><h3>保障档案</h3><span>{warrantySummaryText(record.warranty_summary ?? { status: 'none', total: 0, active_count: 0, expiring_count: 0, upcoming_count: 0, expired_count: 0, pending_count: 0 })}</span></div><ol>{warranties.map(item => <li key={item.id}><div><strong>{warrantyKinds.find(([k]) => k === item.fields.kind)?.[1] ?? '保障'}{item.fields.provider && ` · ${item.fields.provider}`}</strong><span className="muted">{warrantyLine(item)}</span>{item.fields.notes && <p className="notes">{item.fields.notes}</p>}<WarrantyPhotos photos={item.photos} generation={generation}/></div><div className="record-actions"><button onClick={() => onWarranty(item.id)}>更正</button></div></li>)}</ol></article> : <EmptySection title="保障档案" action="添加保障" onAdd={() => onWarranty()}/>}
    {record.maintenances.length ? <article className="detail-section maintenance-history"><div className="section-heading"><h3>维护档案</h3><span>{record.maintenances.length} 条 · 已知费用 {money(record.costs.known_maintenance_cents)}</span></div><ol>{record.maintenances.map(item=><li key={item.id}><div><strong>{item.fields.title || maintenanceKinds.find(([k])=>k===item.fields.kind)?.[1] || '维护'}</strong><span className="muted">{item.fields.date || '日期未知'} · {money(item.fields.cost_cents)}{item.fields.provider && ` · ${item.fields.provider}`}</span>{item.fields.description && <p className="notes">{item.fields.description}</p>}<MaintenancePhotos photos={item.photos} generation={generation}/></div><div className="record-actions"><button onClick={()=>onMaintenance(item.id)}>更正</button></div></li>)}</ol></article> : <EmptySection title="维护档案" action="新增维护" onAdd={() => onMaintenance()}/>}
    {record.photos.length ? <article className="detail-section"><div className="section-heading"><h3>图片附件</h3><span>{record.photos.length} 张</span></div><Gallery record={record} generation={generation} showHeading={false}/></article> : <EmptySection title="图片附件" action="添加图片" onAdd={onEdit}/>}
    </div><div className="detail-secondary">
    <article className="detail-section"><div className="section-heading"><h3>物品时间轴</h3><span>最新记录在前</span></div><Timeline assetId={record.asset.id} version={record} onCorrect={e => onLifecycle({type:'correct_date',event_id:e.id.slice('lifecycle:'.length),date:e.date ?? today})}/></article>
    </div></div>
    <footer className="detail-footer"><details className="archive-meta"><summary>档案信息</summary><dl className="facts"><dt>建档时间</dt><dd>{record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '旧记录未提供'}</dd><dt>修改时间</dt><dd>{record.updated_at ? new Date(record.updated_at).toLocaleString('zh-CN') : '旧记录未提供'}</dd><dt>档案编号</dt><dd><code>{record.asset.id}</code></dd><dt>保存版本</dt><dd>{record.asset.revision}</dd></dl></details></footer>
  </>;
}
