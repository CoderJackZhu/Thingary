// Development-only entry. Renders the production App with an in-memory IPC
// adapter; index.html and the production build never import this module.
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type { AssetRecord, Page, Query, SaveAsset } from './asset';
import { localDay } from './asset';
import type { TrashChange, RecordTrashChange, TrashEntry } from './Trash';
import { applyPreviewCommand, previewSnapshot, normalizeName } from './taxonomy';
import type { PreviewCatalog, TaxonomyCommand } from './taxonomy';
import type { SaleChange, Sale } from './sales';
import { lifecycleError, revokeError } from './lifecycle';
import type { LifecycleChange } from './lifecycle';
import type { Maintenance, MaintenanceChange } from './maintenance';
import type { Warranty, WarrantyChange } from './warranty';
import { deriveStatus, summarizeWarranties } from './warranty';
import { fixtureArt } from './visual-fixtures';
import { MATERIALS, materialOf, materialPhotoName, materialArt } from './materials';
import { previewRecord } from './preview-costs';
import { previewResaleRate } from './resale';
import demoAssets from './demo-assets.json';
import { wealthPreview, financialTimelineEvents, previewWishPage, previewReadWish, validatePreviewSource, searchPreview } from './wealth-preview';
import type { PreviewEvent } from './wealth-preview';
import type { OverviewData } from './Overview';
import type { Review, Read } from './review';
import type { ExpenseView } from './expenses';
import type { SourceTarget } from './source';
const emptyCosts = {known_maintenance_cents:'0',unknown_maintenance_count:0,total_investment_cents:null,sale_proceeds_cents:null,net_cost_cents:null,held_days:null,daily_cents:null};
const emptyWarrantySummary = {status:'none',total:0,active_count:0,expiring_count:0,upcoming_count:0,expired_count:0,pending_count:0} as const;

// One entry per category name (the sample merges camera and audio items); id is the first item's icon.
const categoryNames = [...new Map(demoAssets.map(a => [a.category, a.icon])).entries()].map(([name, icon]) => [icon, name]);
const categoryId = (name: string) => categoryNames.find(([, n]) => n === name)![0];
const channelNames = [...new Set(demoAssets.flatMap(a => a.channel ? [a.channel] : []))];
const previewPrefs = (label: string | undefined) => label ? {label_id:'label-photo',cost_mode:'daily',use_count:0,goal:{mode:'none'},pinned:false,exclude:{total:false,daily:false,statistics:false,timeline:false}} as AssetRecord['preferences'] : undefined;
let records: AssetRecord[] = demoAssets.map((a, i) => ({
  preferences: previewPrefs((a as {label?: string}).label),
  lifecycle: {state: a.sale ? 'sold' : a.retired_on ? 'retired' : 'active', events: a.retired_on ? [{id:'demo-retirement',sequence:1,kind:'retire',date:a.retired_on,notes:'留作备用机'}] : []},
  sale: a.sale ? {id:'demo-sale',previous_state:'active',fields:a.sale} : null,
  maintenances: a.maintenance ? [{id:'demo-maintenance-'+a.key,fields:{...a.maintenance,kind:a.maintenance.kind as Maintenance['fields']['kind']},photos:[],created_at:a.maintenance.date+'T08:00:00Z',updated_at:a.maintenance.date+'T08:00:00Z'}] : [],
  warranties: [],
  warranty_summary: {...emptyWarrantySummary},
  costs: {...emptyCosts},
  asset: { id:a.key, name:a.name, price_cents:a.price_cents, purchase_date:a.purchase_date, revision:1 },
  details: {brand:a.brand,model:a.model,serial_number:'',notes:a.notes},
  created_at: new Date(Date.UTC(2026,8,10,8,0,8-i)).toISOString(), updated_at:null,
  classification: {category_id:categoryId(a.category),channel_id:a.channel ? 'demo-channel-'+channelNames.indexOf(a.channel) : null},
  deleted:false,deleted_at:null,photos:[{id:a.key,name:'原始 Demo 虚构物品示意图'}],cover_id:a.key,
}));
let taxonomyRevision = 0;
const taxonomyReceipts = new Map<string,string>();
let catalog: PreviewCatalog = {categories:[...categoryNames,['apparel','服饰配饰'],['outdoor','出行运动'],['box','其他']].map(([id,name])=>({id,name,icon:(['apparel','outdoor'].includes(id)?'box':id) as 'computer',references:{activeAssets:0,deletedAssets:0}})),channels:channelNames.map((name,i)=>({id:'demo-channel-'+i,name,references:{activeAssets:0,deletedAssets:0}})),assets:[]};
function taxonomySnapshot() { catalog.assets=records.map(r=>({id:r.asset.id,categoryId:r.classification?.category_id??null,channelId:r.classification?.channel_id??null,deleted:r.deleted})); return {generation,revision:taxonomyRevision,...previewSnapshot(catalog)}; }
const namedChoices:Record<string,{id:string;name:string;enabled:boolean}[]>={
 label:[{id:'label-active',name:'工作用',enabled:true},{id:'label-photo',name:'摄影',enabled:true},{id:'label-empty',name:'空标签',enabled:true}],
 sale_channel:['闲鱼','转转','线下','朋友转让','回收商','二手平台','其他'].map((name,i)=>({id:'sale-channel-'+i,name,enabled:true})),
};
const disabledChoices=new Map<string,boolean>();
const choiceReceipts=new Map<string,string>();
function choiceSnapshot(kind:string){
 const list=kind==='category'?catalog.categories:kind==='channel'?catalog.channels:namedChoices[kind]??[];
 return {revision:taxonomyRevision,items:list.map(e=>({...e,enabled:'enabled' in e?e.enabled:!disabledChoices.get(kind+':'+e.id),references:records.filter(r=>kind==='label'?r.preferences?.label_id===e.id:kind==='sale_channel'?r.sale?.fields.platform===e.name:false).length}))};
}
const requests = new Map<string, AssetRecord>();
const recordTrashReceipts = new Map<string, string>();
const lostMaintenanceReceipts = new Set<string>();
// In-memory stand-ins for independently deleted records (schema 10 deleted_at).
// They leave the visible arrays but keep their content until restored.
const deletedMaintenances: { id: string; assetId: string; deleted_at: string; snapshot: Maintenance }[] = [];
const deletedWarranties: { id: string; assetId: string; deleted_at: string; snapshot: Warranty }[] = [];
const generation = 'visual-fixture-only';
const params = new URLSearchParams(location.search);

if (params.get('state') === 'empty') records = [];
// U18 分类夹具：30 个虚构分类（长中文/英文名、无物品分类），并把两件样例
// 挂到首/尾分类，验证溢出、菜单与极窄选择器。仅浏览器预览，刷新即重置。
if (params.get('category-fixture') === '30') {
  const names = [
    '便携手账与纸胶带', '长途骑行装备', 'Kitchen & Dining', '露营照明与电源', 'Mid-Century Furniture',
    '手冲咖啡器具', '桌面收纳', '黑胶唱片', '绘画颜料', 'Model Kits',
    '瑜伽与拉伸', '冬季滑雪', '水上运动', 'Kites & Drones', '望远镜与观鸟',
    '多肉植物', '烘焙模具', '茶具与茶叶', '香薰蜡烛', 'Board Games',
    '拼图', '乐高', '遥控车', '钓鱼用具', '烧烤炉具',
    '工具与五金', '乐器配件', '缝纫机', '胶片相机', '一个特别特别特别长的分类名称用来验证菜单内换行行为',
  ];
  const extra = names.map((name, i) => ({ id: `u18-cat-${i}`, name, icon: 'box' as const, references: { activeAssets: 0, deletedAssets: 0 } }));
  catalog.categories = [...catalog.categories, ...extra];
  if (records[0]) records[0] = { ...records[0], classification: { category_id: 'u18-cat-0', channel_id: records[0].classification?.channel_id ?? null } };
  if (records[1]) records[1] = { ...records[1], classification: { category_id: 'u18-cat-29', channel_id: records[1].classification?.channel_id ?? null } };
}
if (params.has('trash-fixture') && records[0]) records.push({...structuredClone(records[0]),asset:{...records[0].asset,id:'deleted-fixture',name:'虚构旧电脑'},deleted:true,deleted_at:'2026-09-28T08:00:00Z'});
if (params.has('no-photos')) records = records.map(r => ({...r,photos:[],cover_id:null}));
// Browser-only warranty fixtures anchored to the real current day, so E04/E05
// style states stay demoable on any date; nothing here reaches the native library.
if (!params.has('no-warranty') && params.get('state') !== 'empty') {
  const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const fixtureWarranty = (id: string, kind: Warranty['fields']['kind'], provider: string, start: string | null, end: string | null): Warranty =>
    ({id, fields: {kind, provider, start_date: start, end_date: end, notes: '虚构保障样例'}, status: 'pending', remaining_days: null, photos: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString()});
  const attach = (key: string, items: Warranty[]) => {
    const record = records.find(r => r.asset.id === key);
    if (record) record.warranties = items;
  };
  attach('laptop', [
    fixtureWarranty('warranty-laptop-long', 'manufacturer', 'Apple', day(-300), day(300)),
    fixtureWarranty('warranty-laptop-care', 'applecare', 'AppleCare+', day(-40), day(10)),
  ]);
  attach('camera', [fixtureWarranty('warranty-camera-ending', 'store', '线下相机店', day(-30), day(0))]);
  attach('phone', [
    fixtureWarranty('warranty-phone-future', 'extended', '京东延保', day(14), day(380)),
    fixtureWarranty('warranty-phone-expired', 'manufacturer', 'Apple', day(-500), day(-100)),
    fixtureWarranty('warranty-phone-unknown', 'other', '未记录', null, null),
  ]);
}
// U17 预览夹具：按 ?tag-fixture= 替换「摄影」标签的虚构记录（D23 基准、
// 组合状态、150 件），刷新即重置；仅浏览器渲染证据用，不代表原生持久性。
const tagFixtureRecord = (id: string, name: string, price: string | null, state: 'active' | 'retired' | 'sold', maintenance: { cost: string | null }[] = [], sale?: string): AssetRecord => ({
  preferences: previewPrefs('摄影'),
  lifecycle: { state, events: state === 'retired' ? [{ id: 'tag-fixture-retire', sequence: 1, kind: 'retire', date: '2026-03-05', notes: '' }] : [] },
  sale: state === 'sold' ? { id: 'tag-fixture-sale', previous_state: 'active', fields: { date: '2026-04-10', price_cents: sale ?? '0', platform: '', buyer: '', notes: '虚构' } } : null,
  maintenances: maintenance.map((m, i) => ({ id: `tag-fixture-m${i}`, fields: { date: '2026-06-01', kind: 'repair' as const, title: '虚构维护', description: '', cost_cents: m.cost, provider: '' }, photos: [], created_at: '2026-06-01T08:00:00Z', updated_at: '2026-06-01T08:00:00Z' })),
  warranties: [],
  warranty_summary: { ...emptyWarrantySummary },
  costs: { ...emptyCosts },
  asset: { id, name, price_cents: price, purchase_date: '2026-01-10', revision: 1 },
  details: { brand: '虚构品牌', model: '样例型号', serial_number: '', notes: '虚构夹具' },
  created_at: '2026-01-10T08:00:00Z', updated_at: null,
  classification: { category_id: 'camera', channel_id: null },
  deleted: false, deleted_at: null, photos: [], cover_id: null,
});
if (params.has('tag-fixture')) {
  const mode = params.get('tag-fixture')!;
  records = records.filter(r => r.preferences?.label_id !== 'label-photo');
  if (mode === 'baseline') {
    records.push(
      tagFixtureRecord('tag-body', '机身', '1200000', 'active', [{ cost: '100000' }]),
      tagFixtureRecord('tag-lens', '镜头', '1500000', 'active'),
      tagFixtureRecord('tag-part', '配件', '300000', 'retired'),
      tagFixtureRecord('tag-old', '旧机身', '500000', 'sold', [], '500000'),
    );
  } else if (mode === 'unknown') {
    // 全部未知：购入未知 + 费用未知的维护记录（R1 复现态：无任何已知分量）。
    records.push(tagFixtureRecord('tag-u1', '胶片扫描仪', null, 'active', [{ cost: null }]), tagFixtureRecord('tag-u2', '快门线', null, 'active', [{ cost: null }]));
  } else if (mode === 'zero') {
    records.push(tagFixtureRecord('tag-z1', '赠品相机包', '0', 'active'), tagFixtureRecord('tag-z2', '赠品镜头布', '0', 'active'));
  } else if (mode === 'mixed') {
    records.push(tagFixtureRecord('tag-m0', '赠品相机包', '0', 'active'), tagFixtureRecord('tag-ml', '镜头', '1500000', 'active'));
  } else if (mode === 'heldempty') {
    records.push(tagFixtureRecord('tag-h1', '旧机身', '500000', 'sold', [], '500000'), tagFixtureRecord('tag-h2', '旧镜头', '300000', 'sold', [], '300000'));
  } else if (mode === 'many') {
    for (let i = 1; i <= 130; i++) records.push(tagFixtureRecord(`tag-n${String(i).padStart(3, '0')}`, `常规${String(i).padStart(3, '0')}`, String(i * 10000), 'active'));
    for (let i = 131; i <= 150; i++) records.push(tagFixtureRecord(`tag-n${String(i).padStart(3, '0')}`, `已售${String(i).padStart(3, '0')}`, String(i * 10000), 'sold', [], String(i * 8000)));
  }
}
// U19 预览夹具：售出保值率虚构样例（口径见 docs/PRODUCT_RULES.md），只加入内存；?resale-fixture=skipped 只留不可计算的售出物品。
if (params.has('resale-fixture')) {
  const skippedOnly = params.get('resale-fixture') === 'skipped';
  records = records.filter(r => r.lifecycle?.state !== 'sold');
  if (!skippedOnly) records.push(tagFixtureRecord('rs-a', '相机', '1000000', 'sold', [], '650000'), tagFixtureRecord('rs-b', '耳机', '200000', 'sold', [], '240000'), tagFixtureRecord('rs-c', '键盘', '80000', 'sold', [], '0'));
  records.push(tagFixtureRecord('rs-d', '手机', null, 'sold', [], '100000'), tagFixtureRecord('rs-e', '赠品', '0', 'sold', [], '5000'));
}
// U17 预览夹具：缺失、全排除状态只改内存虚构事实，刷新即重置。
if (params.get('tag-view') === 'missing') {
  const boxRecord = records.find(r => r.asset.id === 'box');
  if (boxRecord) boxRecord.asset = { ...boxRecord.asset, price_cents: null };
  const camera = records.find(r => r.asset.id === 'camera');
  if (camera) camera.maintenances = [...camera.maintenances, { id: 'demo-maintenance-unknown', fields: { date: '2026-08-01', kind: 'repair' as const, title: '传感器清洁（费用待补）', description: '', cost_cents: null, provider: '' }, photos: [], created_at: '2026-08-01T08:00:00Z', updated_at: '2026-08-01T08:00:00Z' }];
}
if (params.get('tag-view') === 'excluded') {
  records = records.map(r => r.preferences?.label_id === 'label-photo' && r.preferences ? { ...r, preferences: { ...r.preferences, exclude: { ...r.preferences.exclude, statistics: true } } } : r);
}
if (params.has('maintenance-photo') && records[0]) records[0].maintenances=[{id:'maintenance-fixture',fields:{date:'2026-09-20',kind:'repair',title:'更换快门',description:'虚构验收记录',cost_cents:'15000',provider:'虚构维修点'},created_at:new Date().toISOString(),updated_at:new Date().toISOString(),photos:[{id:'maintenance-photo-fixture',name:'维护前照片'}]}];
// This preview owns its isolated origin and only removes its own reminder keys:
// records reset on reload, so pending requests from the previous fixture are stale.
for (const key of ['thingary.asset-draft.v1','thingary.trash-request.v1','thingary.record-trash-request.v1','thingary.taxonomy-request.v1','thingary.lifecycle-draft.v1','thingary.sale-draft.v1']) localStorage.removeItem(key);
if (!params.has('preserve-maintenance')) localStorage.removeItem('thingary.maintenance-draft.v1');
if (!params.has('preserve-warranty')) localStorage.removeItem('thingary.warranty-draft.v1');
if (params.has('theme')) localStorage.setItem('thingary.theme',params.get('theme') === 'dark' ? 'dark' : 'light');
if (params.has('style')) localStorage.setItem('thingary.style', params.get('style') === 'olive' || params.get('style') === 'paper' ? 'olive' : params.get('style') === 'bento' ? 'bento' : 'native');
if (params.get('preset-label')) sessionStorage.setItem('thingary.preset-label.v1', params.get('preset-label')!);
if (params.has('enter-tag') || params.has('preset-label')) document.getElementById('visual-preview-label')?.remove();
// U18 截图入口：?open-wish=<心愿ID> 走真实来源跳转打开详情；?recurring-tab=payments 直达付款记录视图。
if (params.get('open-wish')) sessionStorage.setItem('thingary.open-wish.v1', params.get('open-wish')!);
// U22 截图入口：?open-virtual=new 打开新增对话框；?open-virtual=<虚拟资产ID> 打开编辑。
if (params.get('open-virtual')) sessionStorage.setItem('thingary.open-virtual.v1', params.get('open-virtual')!);
if (params.get('recurring-tab')) sessionStorage.setItem('thingary.recurring-tab.v1', params.get('recurring-tab')!);
if (params.get('scroll-to')) sessionStorage.setItem('thingary.scroll-to.v1', params.get('scroll-to')!);
if (params.get('category-menu')) sessionStorage.setItem('thingary.category-menu.v1', params.get('category-menu')!);
const images = new Map<string, Promise<ArrayBuffer>>();
// Staged material selections keep their artwork key so previews render the
// same illustration the native app hosts; ids are per-selection and independent.
const stagedMaterials = new Map<string, { art: string; name: string }>();
let materialSequence = 0;
// In-memory stand-in for the schema 9 user-material table; resets on reload.
type PreviewMaterial = { id: string; name: string; builtin: boolean; art: string };
let userMaterials: PreviewMaterial[] = [];
const previewMaterials = (): PreviewMaterial[] => [
  ...MATERIALS.map(m => ({ id: m.id, name: m.name, builtin: true, art: m.id })),
  ...userMaterials,
];
function imageBytes(id: string): Promise<ArrayBuffer> {
  const key = stagedMaterials.get(id)?.art ?? id;
  if (!images.has(key)) images.set(key, new Promise((resolve,reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width=materialOf(key)?.style === 'icon' ? 320 : 480; canvas.height=materialOf(key)?.style === 'icon' ? 320 : 360;
      canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);
      canvas.toBlob(blob => { if(blob) void blob.arrayBuffer().then(resolve); else reject(new Error('Fixture image failed')); },'image/png');
    };
    img.onerror = () => reject(new Error('Fixture illustration failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialOf(key) ? materialArt(key) : fixtureArt(key));
  }));
  return images.get(key)!;
}
function previewPhotoName(id: string): string {
  const staged = stagedMaterials.get(id);
  return staged ? staged.name : '虚构物品示意图';
}
// D19 batch commands over the same in-memory records; receipts keep prior values for undo.
const batchReceipts = new Map<string, { action: string; items: { id: string; after: number; before: AssetRecord }[] }>();
function batchRow(r: AssetRecord) {
  const p = r.preferences;
  return { id: r.asset.id, name: r.asset.name, revision: r.asset.revision, state: r.lifecycle?.state ?? 'active', price_cents: r.asset.price_cents, purchase_date: r.asset.purchase_date, last_event_date: r.lifecycle?.events.at(-1)?.date ?? null, category_id: r.classification?.category_id ?? null, channel_id: r.classification?.channel_id ?? null, label_id: p?.label_id ?? null, exclude: p?.exclude ?? { total: false, daily: false, statistics: false, timeline: false }, maintenance_cents: String(r.maintenances.reduce((sum, m) => sum + Number(m.fields.cost_cents ?? 0), 0)) };
}
// Browser-only physical adapter; native review tests verify authoritative totals.
function physicalPreview(scope: string): OverviewData {
  const live = records.filter(r => !r.deleted && !r.preferences?.exclude.total), held = live.filter(r => r.lifecycle?.state !== 'sold');
  const rows = scope === 'history' ? live : held, total = (items: AssetRecord[]) => items.reduce((n, r) => n + BigInt(r.asset.price_cents ?? '0'), 0n).toString();
  const unknown = (items: AssetRecord[]) => items.filter(r => r.asset.price_cents === null).length;
  const days = held.filter(r => r.asset.purchase_date).map(r => Math.max(1, Math.round((Date.parse(localDay()) - Date.parse(r.asset.purchase_date!)) / 86400000) + 1));
  const daily = { known_cents: null as string | null, included_count: 0, unknown_count: 0, per_use_count: 0, excluded_count: 0 };
  let dailyTotal = 0n;
  const dailyHeld = records.filter(r => !r.deleted && r.lifecycle?.state !== 'sold');
  for (const r of dailyHeld) {
    if (r.preferences?.exclude.daily) { daily.excluded_count++; continue; }
    if (r.preferences?.cost_mode === 'per_use') { daily.per_use_count++; continue; }
    const cents = previewRecord(r).costs.daily_cents;
    if (cents === null) daily.unknown_count++;
    else { dailyTotal += BigInt(cents); daily.included_count++; }
  }
  if (daily.included_count || !dailyHeld.length) daily.known_cents = dailyTotal.toString();
  const ids = [...new Set(rows.map(r => r.classification?.category_id ?? null))];
  return { generation, today: localDay(), scope: scope === 'history' ? 'history' : 'held', held_count: held.length, active_count: held.filter(r => r.lifecycle?.state !== 'retired').length, retired_count: held.filter(r => r.lifecycle?.state === 'retired').length, sold_count: live.length - held.length,
    held_known_cents: total(held), held_unknown_price_count: unknown(held), history_known_cents: total(live), history_unknown_price_count: unknown(live), average_holding_days: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null, held_unknown_date_count: held.length - days.length, held_daily: daily, considering_wishes: previewWishPage({ search: '', filter: 'considering', sort: 'created', descending: true, offset: 0 }).total - previewWishPage({ search: '', filter: 'considering', sort: 'created', descending: true, offset: 0 }).legacy_achieved_count, legacy_wishes: previewWishPage({ search: '', filter: 'considering', sort: 'created', descending: true, offset: 0 }).legacy_achieved_count,
    categories: ids.map((id, slot) => { const items = rows.filter(r => (r.classification?.category_id ?? null) === id); return { id, slot: slot < 7 ? slot : null, name: catalog.categories.find(c => c.id === id)?.name ?? '未分类', count: items.length, known_cents: total(items), unknown_price_count: unknown(items) }; }),
    recent: live.filter(r => r.asset.purchase_date).map(r => ({ id: 'purchase:' + r.asset.id, kind: 'purchase', date: r.asset.purchase_date, asset_id: r.asset.id, wishlist_id: null, title: r.asset.name, note: '', amount_cents: r.asset.price_cents, target: { kind: 'asset' as const, id: r.asset.id }, domain: 'physical' })).sort((a,b) => b.date!.localeCompare(a.date!)).slice(0,5) };
}
// Q03 preview timeline: physical events from the demo records plus the
// financial/wish projection from wealth-preview, filtered like timeline_view.
const timelineKindSets: Record<string, readonly string[]> = {
  all: ['purchase', 'retire', 'activate', 'sale', 'maintenance', 'warranty_start', 'warranty_end', 'wish_added', 'wish_abandoned', 'wish_achieved', 'expense', 'refund', 'payment', 'virtual', 'snapshot'],
  snapshot: ['snapshot'], purchase: ['purchase'], expense: ['expense', 'refund', 'payment', 'virtual'],
  maintenance: ['maintenance'], warranty: ['warranty_start', 'warranty_end'], lifecycle: ['retire', 'activate', 'sale'],
  wishlist: ['wish_added', 'wish_abandoned', 'wish_achieved', 'purchase'],
};
function physicalTimelineEvents(): PreviewEvent[] {
  const today = localDay();
  return records.filter(r => !r.deleted).flatMap(r => [
    ...(r.asset.purchase_date ? [{ id: 'purchase:' + r.asset.id, kind: 'purchase', date: r.asset.purchase_date, asset_id: r.asset.id, wishlist_id: null, title: r.asset.name, note: '', amount_cents: r.asset.price_cents, target: { kind: 'asset', id: r.asset.id }, domain: 'physical' } as PreviewEvent] : []),
    ...(r.maintenances ?? []).map(m => ({ id: 'maintenance:' + m.id, kind: 'maintenance', date: m.fields.date, asset_id: r.asset.id, wishlist_id: null, title: r.asset.name, note: m.fields.title, amount_cents: m.fields.cost_cents, target: { kind: 'asset', id: r.asset.id }, domain: 'physical' }) as PreviewEvent),
    ...(r.warranties ?? []).flatMap(w => [
      ...(w.fields.start_date && w.fields.start_date <= today ? [{ id: 'warranty_start:' + w.id, kind: 'warranty_start', date: w.fields.start_date, asset_id: r.asset.id, wishlist_id: null, title: r.asset.name, note: [w.fields.kind, w.fields.provider].join('|'), amount_cents: null, target: { kind: 'asset', id: r.asset.id }, domain: 'physical' } as PreviewEvent] : []),
      ...(w.fields.end_date && w.fields.end_date <= today ? [{ id: 'warranty_end:' + w.id, kind: 'warranty_end', date: w.fields.end_date, asset_id: r.asset.id, wishlist_id: null, title: r.asset.name, note: [w.fields.kind, w.fields.provider].join('|'), amount_cents: null, target: { kind: 'asset', id: r.asset.id }, domain: 'physical' } as PreviewEvent] : []),
    ]),
    ...(r.lifecycle?.events ?? []).map(e => ({ id: 'lifecycle:' + e.id, kind: e.kind, date: e.date, asset_id: r.asset.id, wishlist_id: null, title: r.asset.name, note: e.notes ?? '', amount_cents: null, target: { kind: 'asset', id: r.asset.id }, domain: 'physical' }) as PreviewEvent),
    ...(r.sale ? [{ id: 'sale:' + r.sale.id, kind: 'sale', date: r.sale.fields.date, asset_id: r.asset.id, wishlist_id: null, title: r.asset.name, note: r.sale.fields.platform ?? '', amount_cents: r.sale.fields.price_cents, target: { kind: 'asset', id: r.asset.id }, domain: 'physical' } as PreviewEvent] : []),
  ]);
}
function timelinePreview(args: Record<string, unknown>) {
  const filter = String((args.query as { filter?: string })?.filter ?? 'all');
  const domain = String(args.domain ?? 'all');
  const year = (args.year as number | null) ?? null;
  const wanted = timelineKindSets[filter];
  if (!wanted || !['all', 'physical', 'wish', 'wealth', 'expense'].includes(domain)) throw { message: '时间轴筛选无效' };
  const keep = (e: PreviewEvent) => wanted.includes(e.kind) && (filter !== 'wishlist' || e.kind !== 'purchase' || !!e.wishlist_id);
  const assetId = (args.query as { asset_id?: string })?.asset_id;
  const domainFiltered = [...physicalTimelineEvents(), ...financialTimelineEvents()].filter(e => (!assetId || e.asset_id === assetId) && (domain === 'all' || e.domain === domain) && keep(e));
  const byDate = (a: PreviewEvent, b: PreviewEvent) => b.date!.localeCompare(a.date!) || b.id.localeCompare(a.id);
  const dated = domainFiltered.filter(e => e.date).sort(byDate);
  // Year options follow the domain selection, never the active year.
  const years = [...new Set(dated.map(e => Number(e.date!.slice(0, 4))))].sort((a, b) => b - a);
  return { generation, today: localDay(), years, dated: year === null ? dated : dated.filter(e => e.date!.startsWith(`${year}-`)), undated: domainFiltered.filter(e => !e.date) };
}
// U13 automatic backup fixtures: one in-memory status per ?autobackup= state,
// switched and cleared in place so the settings block stays interactive.
type PreviewAutoBackup = { enabled: boolean; folder: string; last_success_at: string | null; last_error: { at: string; message: string } | null; items: { name: string; date: string; size: number }[]; total_size: number; extra_dir: string | null; extra_last_at: string | null; extra_last_error: { at: string; message: string } | null };
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const when = (offset: number) => new Date(Date.now() - offset * 60000).toISOString();
function autoBackupFixture(): PreviewAutoBackup {
  const mode = params.get('autobackup') ?? 'never';
  const items = mode === 'never' ? [] : Array.from({ length: mode === 'error' ? 3 : 7 }, (_, i) => { const date = day(-i - (mode === 'error' ? 1 : 0)); return { name: `物谱自动备份-${date}.thingary`, date, size: 6_000_000 + i * 812_345 }; });
  return {
    enabled: true,
    folder: '/Users/虚构用户/Library/Application Support/local.thingary.preview/library/auto-backups',
    last_success_at: mode === 'never' ? null : when(mode === 'error' ? 26 * 60 : 42),
    last_error: mode === 'error' ? { at: when(18), message: '模拟自动备份失败：目标磁盘空间不足' } : null,
    items,
    total_size: items.reduce((sum, item) => sum + item.size, 0),
    extra_dir: mode === 'ok' || mode === 'extra-error' ? '/Users/虚构用户/额外备份/物谱' : null,
    extra_last_at: mode === 'ok' ? when(42) : null,
    extra_last_error: mode === 'extra-error' ? { at: when(11), message: '额外备份位置不可用：外接盘未连接' } : null,
  };
}
let previewAutoBackup = autoBackupFixture();
function autoBackupPreview(command: string, args: Record<string, unknown>): unknown {
  if (command === 'auto_backup_status') return previewAutoBackup;
  if (command === 'auto_backup_set_enabled') { previewAutoBackup = { ...previewAutoBackup, enabled: !!args.enabled }; return previewAutoBackup; }
  if (command === 'auto_backup_clear_extra') { previewAutoBackup = { ...previewAutoBackup, extra_dir: null, extra_last_at: null, extra_last_error: null }; return previewAutoBackup; }
  if (command === 'auto_backup_open_folder') return null;
  if (command === 'auto_backup_choose_extra') throw { message: '额外备份位置选择请在原生 App 中验证，此页面仅展示界面状态。' };
  if (command === 'inspect_auto_backup') {
    const name = String(args.name ?? '');
    if (!/^物谱自动备份-\d{4}-\d{2}-\d{2}\.thingary$/.test(name)) throw { code: 'AUTO_BACKUP_NAME', message: '不是有效的自动备份文件名' };
    return { path: `${previewAutoBackup.folder}/${name}`, name, summary: { hash: 'preview-fixture', created_at: when(120), schema: 20, assets: 9, deleted_assets: 0, wishes: 2, maintenances: 3, warranties: 4, accounts: 2, snapshots: 6, expenses: 5, plans: 2, payments: 12, virtual_assets: 3, files: 11 } };
  }
  throw { message: '此操作需在原生 App 验证：' + command };
}
async function handle(command: string, payload: unknown): Promise<unknown> {
  if (command === 'notification_status') return '';
  const args = payload as Record<string,unknown>;
  if(command==='wealth_request_result' && choiceReceipts.has(String(args.request)))return 'choices';
  if(command==='choice_list')return choiceSnapshot(String(args.kind));
  if(command==='choice_change'){
    const input=args.input as {request_id:string;generation:string;expected_revision:number;kind:string;action:{type:string;id:string;name:string;enabled:boolean;ids:string[];replacement:string|null;expected_references:number}};
    if(input.generation!==generation)throw {code:'STALE_DATASET',message:'资料库已变化'};
    const fingerprint=JSON.stringify(input),prior=choiceReceipts.get(input.request_id);
    if(prior){if(prior!==fingerprint)throw {code:'REQUEST_CONFLICT',message:'请求已变化'};return choiceSnapshot(input.kind)}
    if(input.expected_revision!==taxonomyRevision)throw {code:'TAXONOMY_STALE',message:'选项已变化，请重新读取'};
    const {action:a,kind}=input,snapshot=choiceSnapshot(kind),old=snapshot.items.find(e=>e.id===a.id);
    if(a.type!=='create'&&a.type!=='reorder'&&!old)throw {code:'CHOICE',message:'选项已不存在'};
    const list=namedChoices[kind];
    if(a.type==='create'||a.type==='rename'){
      const name=normalizeName(a.name);
      if(!name||[...name].length>80||/[\u0000-\u001f\u007f-\u009f]/u.test(name)||snapshot.items.some(e=>e.id!==a.id&&e.name.replace(/[A-Z]/g,c=>c.toLowerCase())===name.replace(/[A-Z]/g,c=>c.toLowerCase()))||['全部','未设置','未选择',...(kind==='label'?['保障中','已退役','已售出']:[])].includes(name))throw {code:'CHOICE_NAME',message:'名称为空、过长、重复或为系统保留名称'};
      if(!list)throw {message:'请使用分类与购买渠道管理'};
      if(a.type==='create')list.push({id:crypto.randomUUID(),name,enabled:true});
      else {if(kind==='sale_channel')for(const r of records){if(r.sale?.fields.platform===old!.name){r.sale.fields.platform=name;r.asset.revision++}}list.find(e=>e.id===a.id)!.name=name;}
    }else if(a.type==='remove'){
      if(old!.references!==a.expected_references)throw {code:'CHOICE_REFERENCES',message:'关联数量已变化，请重新查看后删除'};
      const target=list?.find(e=>e.id===a.replacement&&e.id!==a.id&&e.enabled);
      if(!list||(a.replacement&&!target))throw {code:'CHOICE',message:'替换选项不可用'};
      for(const r of records){if(kind==='label'&&r.preferences?.label_id===a.id){r.preferences.label_id=a.replacement;r.asset.revision++}if(kind==='sale_channel'&&r.sale?.fields.platform===old!.name){r.sale.fields.platform=target?.name??'';r.asset.revision++}}
      namedChoices[kind]=list.filter(e=>e.id!==a.id);
    }else if(a.type==='enable'){if(list)list.find(e=>e.id===a.id)!.enabled=a.enabled;else disabledChoices.set(kind+':'+a.id,!a.enabled)}
    else if(a.type==='reorder'&&list)namedChoices[kind]=a.ids.map(id=>list.find(e=>e.id===id)!);
    taxonomyRevision++;choiceReceipts.set(input.request_id,fingerprint);return choiceSnapshot(kind);
  }
  // U16-D5: same filters as the sidebar entries, so counts equal the list totals.
  if (command === 'asset_counts') { const total = async (filter: string, warranty: string) => (await handle('list_assets', { query: { search: '', filter, sort: 'created', descending: true, offset: 0, warranty } }) as Page).total; return { generation: (await handle('list_assets', { query: { search: '', filter: 'all', sort: 'created', descending: true, offset: 0 } }) as Page).generation, all: await total('all', 'all'), active: await total('active', 'all'), covered: await total('held', 'covered'), retired: await total('retired', 'all'), sold: await total('sold', 'all') }; }
  if (command === 'asset_ids') { const page = await handle('list_assets', { query: { ...(args.query as Query), offset: 0 }, all: true }) as Page; return page.items.map(r => r.asset.id); }
  if (command === 'batch_rows') return (args.ids as string[]).map(id => records.find(r => r.asset.id === id && !r.deleted)).filter((r): r is AssetRecord => !!r).map(batchRow);
  if (command === 'batch_change') {
    const input = args.input as { request_id: string; action: string; items: { asset_id: string; expected_revision: number; category_id?: string | null; channel_id?: string | null; label_id?: string | null; exclude?: NonNullable<AssetRecord['preferences']>['exclude']; date?: string }[] };
    const prior = batchReceipts.get(input.request_id); if (prior) return { changed: prior.items.length, skipped: 0 };
    const today = localDay(), done: { id: string; after: number; before: AssetRecord }[] = [];
    for (const item of input.items) {
      const r = records.find(x => x.asset.id === item.asset_id && !x.deleted);
      if (!r || r.asset.revision !== item.expected_revision) throw { code: 'REVISION_CONFLICT', message: `「${r?.asset.name ?? '物品'}」已变化，请重新读取后再保存` };
      if (input.action === 'retire' || input.action === 'activate') {
        const life = r.lifecycle ?? { state: 'active', events: [] }, want = input.action === 'retire' ? 'active' : 'retired';
        const earliest = [r.asset.purchase_date, life.events.at(-1)?.date].filter(Boolean).sort().at(-1);
        if (life.state !== want || !item.date || item.date > today || (earliest && item.date < earliest)) throw { code: 'DATE_CONFLICT', message: `「${r.asset.name}」：状态或日期不符合规则` };
      }
    }
    for (const item of input.items) {
      const r = records.find(x => x.asset.id === item.asset_id)!;
      const before = structuredClone(r);
      if (input.action === 'classify') r.classification = { category_id: item.category_id !== undefined ? item.category_id : r.classification?.category_id ?? null, channel_id: item.channel_id !== undefined ? item.channel_id : r.classification?.channel_id ?? null };
      if (input.action === 'label' && r.preferences) r.preferences = { ...r.preferences, label_id: item.label_id ?? null };
      if (input.action === 'exclude' && r.preferences && item.exclude) r.preferences = { ...r.preferences, exclude: item.exclude };
      if (input.action === 'retire' || input.action === 'activate') { const life = r.lifecycle ?? { state: 'active', events: [] }; life.events.push({ id: crypto.randomUUID(), sequence: life.events.length + 1, kind: input.action === 'retire' ? 'retire' : 'activate', date: item.date!, notes: '' }); life.state = input.action === 'retire' ? 'retired' : 'active'; r.lifecycle = life; }
      if (input.action === 'delete') { r.deleted = true; r.deleted_at = new Date().toISOString(); }
      const extra = item as unknown as { warranty?: { kind: string; provider: string; start_date: string | null; end_date: string | null; notes: string }; sale?: { date: string; price_cents: string; platform: string; buyer: string; notes: string } };
      if (input.action === 'warranty' && extra.warranty) { r.warranties = [...(r.warranties ?? []), { id: crypto.randomUUID(), fields: extra.warranty, status: 'active', remaining_days: null, photos: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), reminder: null } as unknown as NonNullable<AssetRecord['warranties']>[number]]; r.warranty_summary = summarizeWarranties(r.warranties, today); }
      if (input.action === 'sell' && extra.sale) { r.sale = { id: crypto.randomUUID(), previous_state: r.lifecycle?.state ?? 'active', fields: extra.sale } as unknown as AssetRecord['sale']; r.lifecycle = { state: 'sold', events: r.lifecycle?.events ?? [] }; }
      r.asset.revision++; taxonomyRevision++;
      done.push({ id: r.asset.id, after: r.asset.revision, before });
    }
    batchReceipts.set(input.request_id, { action: input.action, items: done });
    return { changed: done.length, skipped: 0 };
  }
  if (command === 'batch_undo') {
    const input = args.input as { batch_request_id: string };
    const batch = batchReceipts.get(input.batch_request_id); if (!batch) throw { code: 'NOT_FOUND', message: '找不到这次批量操作' };
    let changed = 0, skipped = 0;
    for (const item of batch.items) {
      const i = records.findIndex(x => x.asset.id === item.id);
      if (i < 0 || records[i].asset.revision !== item.after) { skipped++; continue; }
      records[i] = { ...item.before, asset: { ...item.before.asset, revision: item.after + 1 } }; changed++;
    }
    taxonomyRevision++;
    return { changed, skipped };
  }
  // Screenshot fixtures only: authoritative statistical calculations stay in Rust.
  if (command === 'stats_snapshot') {
    const rows=records.filter(r=>!r.deleted&&!r.preferences?.exclude.statistics), sum=(rs:AssetRecord[])=>rs.reduce((n,r)=>n+BigInt(r.asset.price_cents??0),0n).toString();
    const sold=rows.filter(r=>r.lifecycle?.state==='sold'), rated=sold.filter(r=>r.asset.price_cents!==null&&BigInt(r.asset.price_cents)>0n);
    return {period:args.period,start:null,end:localDay(),total:rows.length,active:rows.filter(r=>r.lifecycle?.state==='active').length,retired:rows.filter(r=>r.lifecycle?.state==='retired').length,sold:sold.length,known_cents:sum(rows),unknown_price_count:rows.filter(r=>r.asset.price_cents===null).length,sale_proceeds_cents:rated.reduce((n,r)=>n+BigInt(r.sale?.fields.price_cents??0),0n).toString(),sold_purchase_cents:sum(rated),sold_unknown_price_count:sold.filter(r=>r.asset.price_cents===null).length,sold_zero_price_count:sold.filter(r=>r.asset.price_cents==='0').length,categories:catalog.categories.flatMap(c=>{const items=rows.filter(r=>r.classification?.category_id===c.id);return items.length?[{id:c.id,name:c.name,count:items.length,known_cents:sum(items),unknown_price_count:items.filter(r=>r.asset.price_cents===null).length}]:[]})};
  }
  if (command === 'resale_rate') {
    if (params.has('resale-error')) throw { message: '虚构保值率读取失败，用于验证错误与重试。' };
    return previewResaleRate(records);
  }
  if (command === 'purchase_trend') {
    const rows=records.filter(r=>!r.deleted), dated=rows.filter(r=>r.asset.purchase_date), groups=new Map<string,AssetRecord[]>();
    for(const r of dated){const d=r.asset.purchase_date!,key=args.granularity==='year'?d.slice(0,4):args.granularity==='quarter'?d.slice(0,4)+'-Q'+Math.ceil(Number(d.slice(5,7))/3):d.slice(0,7);groups.set(key,[...(groups.get(key)??[]),r])}
    let cumulative=0n;
    const buckets=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([key,items])=>{const known=items.reduce((n,r)=>n+BigInt(r.asset.price_cents??0),0n);cumulative+=known;return {key,start:items.map(r=>r.asset.purchase_date!).sort()[0],end:items.map(r=>r.asset.purchase_date!).sort().at(-1),count:items.length,known_cents:String(known),unknown_price_count:items.filter(r=>r.asset.price_cents===null).length,cumulative_cents:String(cumulative)}});
    return {generation,today:localDay(),granularity:args.granularity,buckets,known_cents:String(cumulative),unknown_price_count:dated.filter(r=>r.asset.price_cents===null).length,unknown_date_count:rows.length-dated.length,unknown_date_known_cents:rows.filter(r=>!r.asset.purchase_date).reduce((n,r)=>n+BigInt(r.asset.price_cents??0),0n).toString()};
  }
  if (command === 'holding') {
    const rows=records.filter(r=>!r.deleted).map(r=>previewRecord(r)), scoped=rows.filter(r=>args.scope==='history'||r.lifecycle?.state!=='sold'),days=scoped.flatMap(r=>r.costs.held_days===null?[]:[r.costs.held_days]).sort((a,b)=>a-b);
    const rank=(rs:AssetRecord[])=>rs.flatMap(r=>r.costs.daily_cents!==null&&r.costs.held_days!==null?[{id:r.asset.id,name:r.asset.name,state:r.lifecycle?.state,held_days:r.costs.held_days,cost_cents:r.costs.net_cost_cents??r.costs.total_investment_cents,daily_cents:r.costs.daily_cents}]:[]).sort((a,b)=>Number(b.daily_cents)-Number(a.daily_cents));
    return {scope:args.scope,groups:[{key:'all',label:'已有持有记录',count:days.length}],dated_count:days.length,unknown_date_count:scoped.length-days.length,average_days:days.length?days.reduce((a,b)=>a+b,0)/days.length:null,median_days:days.length?days[Math.floor(days.length/2)]:null,longest:rank(scoped).sort((a,b)=>b.held_days-a.held_days)[0]??null,held_ranking:rank(rows.filter(r=>r.lifecycle?.state!=='sold')),sold_ranking:rank(rows.filter(r=>r.lifecycle?.state==='sold')),excluded:rows.filter(r=>r.costs.daily_cents===null).map(r=>({id:r.asset.id,name:r.asset.name,reason:'资料待补充'}))};
  }
  if (command === 'overview') return physicalPreview(String(args.scope));
  if (command === 'timeline_view' || command === 'list_timeline') return timelinePreview(args);
  if (command === 'validate_source') {
    if (args.generation !== generation) throw { code: 'STALE_DATASET', message: '资料库已变化，请返回后重新读取。' };
    // ?source=missing demonstrates the failed-source path: notice plus refresh,
    // never a same-named substitute record.
    if (params.get('source') === 'missing') throw { code: 'NOT_FOUND', message: '这条来源记录已删除或失效，请返回后重新读取。' };
    const target = args.target as SourceTarget;
    if (target.kind === 'asset') {
      if (!records.some(r => r.asset.id === target.id && !r.deleted)) throw { code: 'NOT_FOUND', message: '这条来源记录已删除或失效，请返回后重新读取。' };
      return null;
    }
    validatePreviewSource(target);
    return null;
  }
  if (command === 'list_wishlist') return previewWishPage(args.query as never);
  if (command === 'read_wishlist') return previewReadWish(String(args.id));
  if (command === 'review_overview') {
    if (params.get('review') === 'error') throw { message: '虚构综合读取失败，用于重试验证。' };
    const read = <T,>(command: string, args: Record<string, unknown> = {}): Read<T> => { try { const value = wealthPreview(command, args); if (!value) throw Error('Unsupported preview source'); return { status: 'ready', value: value.value as T }; } catch (error) { return { status: 'error', value: { code: 'PREVIEW', message: String((error as { message?: string }).message ?? error) } }; } };
    const expenses = read<ExpenseView>('expense_view', args);
    // Recent rides the same unified projection as the timeline, snapshots and
    // stable targets included, exactly like the native review command.
    const recent: Read<PreviewEvent[]> = expenses.status === 'error' ? expenses : { status: 'ready', value: (timelinePreview({ query: { filter: 'all' }, domain: 'all', year: args.year }).dated as PreviewEvent[]).slice(0, 8) };
    const result: Review = { generation, today: localDay(), year: args.year as number | null, physical: { status: 'ready', value: physicalPreview('held') }, wealth: read('wealth_summary'), expenses, recurring: read('recurring_overview'), virtual_assets: read('virtual_overview'), recent };
    return result;
  }
  const wealth = wealthPreview(command,args); if (wealth) return wealth.value;
  const search = searchPreview(command,args); if (search) return search.value;
  if (command === 'demo_status') return {active:params.get('demo') === '1',available:true,started:true};
  if (command === 'switch_demo' || command === 'reset_demo') throw {message:'浏览器预览仅用于界面检查；切库和重置请在隔离原生验收版中验证。'};
  if (command.startsWith('auto_backup_') || command === 'inspect_auto_backup') return autoBackupPreview(command, args);
  if (command === 'taxonomy_snapshot') { if (params.has('taxonomy-error')) throw { message: '虚构分类读取失败，用于验证错误与重试。' }; return taxonomySnapshot(); }
  if (command === 'taxonomy_request') return taxonomyReceipts.has(String(args.request));
  if (command === 'change_taxonomy') {
    const input = args.input as {request_id:string;generation:string;expected_revision:number;command:TaxonomyCommand};
    const fingerprint=JSON.stringify(input), previous=taxonomyReceipts.get(input.request_id);
    if(previous) { if(previous!==fingerprint) throw {code:'REQUEST_CONFLICT',message:'请求内容不一致。'}; return taxonomySnapshot(); }
    if(input.generation!==generation || input.expected_revision!==taxonomyRevision) throw {code:'TAXONOMY_CONFLICT',message:'分类资料已变化，请重新加载。'};
    taxonomySnapshot(); catalog=applyPreviewCommand(catalog,input.command,crypto.randomUUID());
    for(const r of records) { const ref=catalog.assets.find(a=>a.id===r.asset.id)!; const next={category_id:ref.categoryId,channel_id:ref.channelId}; if(JSON.stringify(r.classification)!==JSON.stringify(next)) {r.classification=next;r.asset.revision++;} }
    taxonomyRevision++;taxonomyReceipts.set(input.request_id,fingerprint);return taxonomySnapshot();
  }
  if (command === 'tag_investment_view') {
    if (params.get('tag-view') === 'error') throw { code: 'DATABASE', message: '虚构标签投入读取失败，用于重试验证。' };
    const { label_id, scope } = args.query as { label_id: string; scope: 'all' | 'held' };
    if (!label_id || !/^[a-zA-Z0-9-]+$/.test(label_id)) throw { code: 'QUERY', message: '不支持的标签筛选' };
    const label = namedChoices.label.find(l => l.id === label_id);
    if (!label) throw { code: 'LABEL', message: '标签已不可用，请返回物品列表重新选择' };
    const states = scope === 'held' ? ['active', 'retired'] : ['active', 'retired', 'sold'];
    const matched = records.filter(r => !r.deleted && states.includes(r.lifecycle?.state ?? 'active') && r.preferences?.label_id === label_id);
    const items = matched.filter(r => !r.preferences?.exclude.statistics).map(r => {
      const known = (r.maintenances ?? []).filter(m => m.fields.cost_cents !== null);
      const unknownCount = (r.maintenances ?? []).length - known.length;
      const knownMaintenance = known.reduce((sum, m) => sum + Number(m.fields.cost_cents ?? 0), 0);
      const purchase = r.asset.price_cents === null ? null : Number(r.asset.price_cents);
      return {
        id: r.asset.id, name: r.asset.name, category_name: catalog.categories.find(c => c.id === r.classification?.category_id)?.name ?? '未分类',
        lifecycle_state: r.lifecycle?.state ?? 'active', brand: r.details.brand, model: r.details.model, serial_number: r.details.serial_number, notes: r.details.notes,
        purchase_cents: r.asset.price_cents, known_maintenance_cents: String(knownMaintenance), known_maintenance_record_count: known.length, missing_maintenance_count: unknownCount,
        known_investment_cents: String((purchase ?? 0) + knownMaintenance),
        complete_investment_cents: purchase !== null && unknownCount === 0 ? String((purchase ?? 0) + knownMaintenance) : null,
        has_known_investment: purchase !== null || known.length > 0,
        sale_proceeds_cents: r.sale?.fields.price_cents ?? '0', incomplete: purchase === null || unknownCount > 0,
      };
    });
    items.sort((a, b) => Number(b.incomplete) - Number(a.incomplete) || Number(b.known_investment_cents) - Number(a.known_investment_cents) || a.id.localeCompare(b.id));
    const counts = {
      matched: matched.length, included: items.length, excluded: matched.length - items.length,
      active: items.filter(i => i.lifecycle_state === 'active').length, retired: items.filter(i => i.lifecycle_state === 'retired').length, sold: items.filter(i => i.lifecycle_state === 'sold').length,
    };
    const checked = (values: number[]) => { let total = 0; for (const v of values) { total += v; if (!Number.isSafeInteger(total)) throw { code: 'OVERFLOW', message: '金额超出范围' }; } return total; };
    const knownPurchase = checked(items.map(i => Number(i.purchase_cents ?? 0)));
    const knownMaintenance = checked(items.map(i => Number(i.known_maintenance_cents)));
    const proceeds = checked(items.map(i => Number(i.sale_proceeds_cents)));
    const knownInvestment = knownPurchase + knownMaintenance;
    const complete = items.every(i => i.purchase_cents !== null && i.missing_maintenance_count === 0);
    return { generation, today: localDay(), label: { id: label.id, name: label.name, inactive: !label.enabled }, scope, counts,
      totals: {
        known_purchase_cents: String(knownPurchase), known_maintenance_cents: String(knownMaintenance), known_investment_cents: String(knownInvestment),
        sale_proceeds_cents: String(proceeds), known_net_cents: String(knownInvestment - proceeds),
        complete_investment_cents: complete ? String(knownInvestment) : null, complete_net_cents: complete ? String(knownInvestment - proceeds) : null,
        has_known_purchase: items.some(i => i.purchase_cents !== null), has_known_maintenance_record: items.some(i => i.known_maintenance_record_count > 0),
        has_known_investment: items.some(i => i.has_known_investment),
        missing_purchase_count: items.filter(i => i.purchase_cents === null).length, missing_maintenance_count: items.reduce((n, i) => n + i.missing_maintenance_count, 0),
        incomplete_asset_count: items.filter(i => i.incomplete).length,
      }, items };
  }
  if (command === 'list_assets') {
    if (params.get('state') === 'error') throw { message: '虚构加载失败，用于验证错误页面。' };
    const query = args.query as Query;
    const labelName = (id: string | null | undefined) => namedChoices.label.find(l => l.id === id)?.name ?? '';
    let found=records.filter(r => r.deleted === (query.filter === 'deleted'));
    found=found.filter(r => (!query.search || [r.asset.name,...Object.values(r.details),catalog.categories.find(c=>c.id===r.classification?.category_id)?.name??'',labelName(r.preferences?.label_id)].join(' ').toLowerCase().includes(query.search.toLowerCase())) && (query.filter !== 'missing_price' || r.asset.price_cents === null) && (query.filter !== 'missing_date' || r.asset.purchase_date === null));
    if(query.filter==='active'||query.filter==='retired'||query.filter==='sold') found=found.filter(r=>(r.lifecycle?.state??'active')===query.filter);
    if(query.filter==='held') found=found.filter(r=>r.lifecycle?.state!=='sold');
    if(query.category?.mode==='uncategorized') found=found.filter(r=>!r.classification?.category_id);
    if(query.category?.mode==='category') {const id=query.category.id;found=found.filter(r=>r.classification?.category_id===id);}
    // Same rule set as the Rust filter: effective = both dates known and
    // start<=today<=end; expiring adds the inclusive 0–30 day window.
    if(query.warranty && query.warranty!=='all') {
      const today=localDay();
      const summaryOf=(r:AssetRecord)=>summarizeWarranties(r.warranties??[],today);
      if(query.warranty==='covered') found=found.filter(r=>['covered','expiring_soon'].includes(summaryOf(r).status));
      if(query.warranty==='expiring') found=found.filter(r=>summaryOf(r).expiring_count>0);
      if(query.warranty==='lapsed') found=found.filter(r=>summaryOf(r).status==='not_covered');
      if(query.warranty==='none') found=found.filter(r=>summaryOf(r).status==='none');
    }
    const value=(r:AssetRecord):string|number|null => {
      if(query.sort==='name')return r.asset.name.toLowerCase();
      if(query.sort==='price')return r.asset.price_cents===null?null:Number(r.asset.price_cents);
      if(query.sort==='date')return r.asset.purchase_date;
      if(query.sort==='held')return previewRecord(r).costs.held_days;
      if(query.sort==='status')return ['active','retired','sold'].indexOf(r.lifecycle?.state ?? 'active');
      if(query.sort==='daily') {
        if(r.preferences?.cost_mode==='per_use')return null;
        const c=previewRecord(r).costs;
        const cost=r.sale?c.net_cost_cents:c.total_investment_cents;
        return cost===null || !c.held_days ? null : Number(cost)/c.held_days;
      }
      return query.sort==='deleted'?r.deleted_at:r.created_at;
    };
    found.sort((a,b)=>{
      const pinned=Number(!!b.preferences?.pinned)-Number(!!a.preferences?.pinned);if(pinned)return pinned;
      const x=value(a),y=value(b);
      if(x===null && y!==null)return 1;if(y===null && x!==null)return -1;
      const order=x===null?0:typeof x==='number' && typeof y==='number'?x-y:String(x)<String(y)?-1:String(x)>String(y)?1:0;
      return order*(query.descending?-1:1)||a.asset.id.localeCompare(b.asset.id);
    });
    return { generation, items: found.slice(query.offset,args.all ? undefined : query.offset+100).map(r => previewRecord(r)), total:found.length, today:localDay() } satisfies Page;
  }
  if (command === 'read_asset') { if(params.get('replacement-read')==='error') throw {message:'虚构原物品读取失败'}; const record = records.find(r=>r.asset.id===args.id); return record ? previewRecord(record) : null; }
  if (command === 'saved_request') {
    const request=String(args.request);
    if(lostMaintenanceReceipts.delete(request)) throw {message:'模拟首次回执查询失败。'};
    if(params.has('pending-receipt') && request==='request-stable') return structuredClone(records[0] ?? null);
    return structuredClone(requests.get(request) ?? null);
  }
  if (command === 'saved_record_trash_request') {
    const input = args.input as RecordTrashChange;
    if (input.generation !== generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const prior = recordTrashReceipts.get(input.request_id);
    if (!prior && requests.has(input.request_id)) throw {code:'REQUEST_CONFLICT',message:'请求标识已用于其他操作。'};
    if (prior && prior !== JSON.stringify(input)) throw {code:'REQUEST_CONFLICT',message:'请求内容不一致。'};
    if (!prior) return null;
    const record = records.find(r => r.asset.id === input.asset_id);
    return record ? previewRecord(record) : null;
  }
  if (command === 'trash_request') return structuredClone(requests.get(String(args.request)) ?? null);
  if (command === 'save_asset') {
    if(params.get('state')==='save-error') throw {message:'模拟保存失败，输入应保留。'};
    const input=args.input as SaveAsset;
    const old=records.find(r=>r.asset.id===input.base.asset_id);
    if(old?.sale && input.base.purchase_date && input.base.purchase_date>old.sale.fields.date) throw {code:'DATE_CONFLICT',message:'购入日期晚于有效售出记录。'};
    if(old && input.base.purchase_date && old.lifecycle?.events.some(e=>e.date<input.base.purchase_date!)) throw {code:'DATE_CONFLICT',message:'购入日期晚于已有状态记录，请先更正相关动作日期。'};
    const id=old?.asset.id ?? crypto.randomUUID();
    const record:AssetRecord={preferences:input.options?.preferences??old?.preferences,sale:old?.sale??null,maintenances:old?.maintenances??[],warranties:old?.warranties??[],warranty_summary:old?.warranty_summary??{...emptyWarrantySummary},costs:old?.costs??{...emptyCosts,total_investment_cents:input.base.price_cents},lifecycle:old?.lifecycle??{state:'active',events:[]},classification:input.classification??old?.classification??{category_id:null,channel_id:null},asset:{id,name:input.base.name,price_cents:input.base.price_cents,purchase_date:input.base.purchase_date,revision:(old?.asset.revision??0)+1},details:input.details,created_at:old?.created_at??new Date().toISOString(),updated_at:new Date().toISOString(),deleted:false,deleted_at:null,photos:(input.photos?.ids??[]).map(photoId=>({id:photoId,name:previewPhotoName(photoId)})),cover_id:input.photos?.cover_id??null};
    taxonomyRevision++; records=records.filter(r=>r.asset.id!==id).concat(record); requests.set(input.base.request_id,record); return previewRecord(record);
  }
  // Exercise production delete/restore UI, without touching the native library.
  if (command === 'change_trash') {
    const input = args.input as TrashChange;
    const record = records.find(r => r.asset.id === input.asset_id);
    if (!record) throw {message:'虚构记录不存在。'};
    taxonomyRevision++; record.deleted = input.deleted;
    record.deleted_at = input.deleted ? new Date().toISOString() : null;
    record.asset.revision += 1;
    requests.set(input.request_id, previewRecord(record));
    return previewRecord(record);
  }
  // Unified trash listing: independently deleted records plus deleted assets.
  if (command === 'list_trash') {
    const query = args.query as { filter: string; offset: number; search?: string };
    const kindLabel = (kind: string) => ({ asset: '物品', maintenance: '维护', warranty: '保障' } as Record<string, string>)[kind] ?? kind;
    const items: TrashEntry[] = [];
    for (const r of records) if (r.deleted) items.push({ kind:'asset', id:r.asset.id, title:r.asset.name, subtype:null, date:null, end_date:null, cost_cents:null, provider:null, deleted_at:r.deleted_at!, asset_id:null, asset_name:null, asset_deleted:true, asset_revision:r.asset.revision, asset_state:r.lifecycle?.state ?? 'active', contents:([['maintenance',r.maintenances.length],['warranty',(r.warranties??[]).length],['photo',r.photos.length]] as const).filter(([,n])=>n>0).map(([kind,count])=>({kind,count})) });
    const parentFacts = (assetId: string) => { const parent = records.find(r => r.asset.id === assetId); return parent ? { parent, state: parent.lifecycle?.state ?? 'active' } : null; };
    for (const entry of deletedMaintenances) { const facts = parentFacts(entry.assetId); if (!facts) continue; items.push({ kind:'maintenance', id:entry.id, title:entry.snapshot.fields.title, subtype:entry.snapshot.fields.kind, date:entry.snapshot.fields.date, end_date:null, cost_cents:entry.snapshot.fields.cost_cents, provider:null, deleted_at:entry.deleted_at, asset_id:facts.parent.asset.id, asset_name:facts.parent.asset.name, asset_deleted:facts.parent.deleted, asset_revision:facts.parent.asset.revision, asset_state:facts.state, contents:[] }); }
    for (const entry of deletedWarranties) { const facts = parentFacts(entry.assetId); if (!facts) continue; items.push({ kind:'warranty', id:entry.id, title:entry.snapshot.fields.provider, subtype:entry.snapshot.fields.kind, date:entry.snapshot.fields.start_date, end_date:entry.snapshot.fields.end_date, cost_cents:null, provider:entry.snapshot.fields.provider, deleted_at:entry.deleted_at, asset_id:facts.parent.asset.id, asset_name:facts.parent.asset.name, asset_deleted:facts.parent.deleted, asset_revision:facts.parent.asset.revision, asset_state:facts.state, contents:[] }); }
    const found = query.filter === 'all' ? items : items.filter(i => i.kind === query.filter);
    found.sort((a,b) => b.deleted_at.localeCompare(a.deleted_at) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    // Same backend contract: filter the full result, then paginate the count.
    const needle = (query.search ?? '').trim().toLowerCase();
    const matched = needle ? found.filter(i => [i.title, kindLabel(i.kind), i.asset_name ?? ''].some(t => t.toLowerCase().includes(needle))) : found;
    return { generation, items: matched.slice(query.offset, query.offset + 100), total: matched.length };
  }
  if (command === 'purge_trash') {
    const input = args.input as { kind: string | null; id: string };
    const gone = (kind: string, id: string) => input.kind === null || (input.kind === kind && input.id === id);
    const before = records.length + deletedMaintenances.length + deletedWarranties.length;
    records = records.filter(r => !(r.deleted && gone('asset', r.asset.id)));
    for (const list of [deletedMaintenances, deletedWarranties] as { id: string }[][]) for (let i = list.length - 1; i >= 0; i--) if (gone(list === deletedMaintenances ? 'maintenance' : 'warranty', list[i].id)) list.splice(i, 1);
    taxonomyRevision++;
    return { removed: before - records.length - deletedMaintenances.length - deletedWarranties.length, kept: 0 };
  }
  if (command === 'change_record_trash') {
    const input = args.input as RecordTrashChange;
    if (input.generation !== generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const prior = recordTrashReceipts.get(input.request_id);
    if (prior && prior !== JSON.stringify(input)) throw {code:'REQUEST_CONFLICT',message:'请求内容不一致。'};
    if (!prior && requests.has(input.request_id)) throw {code:'REQUEST_CONFLICT',message:'请求标识已用于其他操作。'};
    const record = records.find(r => r.asset.id === input.asset_id);
    if (!record) throw {code:'NOT_FOUND',message:'找不到所属物品。'};
    if (prior) return previewRecord(record);
    if (record.deleted) throw {code:'PARENT_DELETED',message:'所属物品还在最近删除中。请先恢复所属物品，再处理这条记录。'};
    if (record.asset.revision !== input.expected_revision) throw {code:'REVISION_CONFLICT',message:'所属物品已更改，请重新读取后再决定。'};
    if (input.kind === 'maintenance') {
      if (input.deleted) {
        const item = record.maintenances.find(m => m.id === input.record_id);
        if (!item) throw {code:'REVISION_CONFLICT',message:'维护记录状态已变化，请重新读取后再决定。'};
        record.maintenances = record.maintenances.filter(m => m.id !== input.record_id);
        deletedMaintenances.push({ id: item.id, assetId: record.asset.id, deleted_at: new Date().toISOString(), snapshot: structuredClone(item) });
      } else {
        const index = deletedMaintenances.findIndex(e => e.id === input.record_id && e.assetId === record.asset.id);
        if (index === -1) throw {code:'REVISION_CONFLICT',message:'维护记录状态已变化，请重新读取后再决定。'};
        const [entry] = deletedMaintenances.splice(index, 1);
        record.maintenances = [...record.maintenances, structuredClone(entry.snapshot)];
      }
    } else {
      if (input.deleted) {
        const item = (record.warranties ?? []).find(w => w.id === input.record_id);
        if (!item) throw {code:'REVISION_CONFLICT',message:'保障记录状态已变化，请重新读取后再决定。'};
        record.warranties = (record.warranties ?? []).filter(w => w.id !== input.record_id);
        deletedWarranties.push({ id: item.id, assetId: record.asset.id, deleted_at: new Date().toISOString(), snapshot: structuredClone(item) });
      } else {
        const index = deletedWarranties.findIndex(e => e.id === input.record_id && e.assetId === record.asset.id);
        if (index === -1) throw {code:'REVISION_CONFLICT',message:'保障记录状态已变化，请重新读取后再决定。'};
        const [entry] = deletedWarranties.splice(index, 1);
        record.warranties = [...(record.warranties ?? []), structuredClone(entry.snapshot)];
      }
    }
    record.asset.revision++; record.updated_at = new Date().toISOString();
    requests.set(input.request_id, previewRecord(record));
    recordTrashReceipts.set(input.request_id, JSON.stringify(input));
    // Simulates a lost response after commit so the pending/核对 flow is demoable.
    if (params.has('record-trash-lost')) throw {message:'模拟记录删除响应丢失。'};
    return previewRecord(record);
  }
  if (command === 'change_lifecycle') {
    const input=args.input as LifecycleChange;
    if(input.generation!==generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const record=records.find(r=>r.asset.id===input.asset_id);
    if(!record) throw {message:'找不到虚构记录。'};
    if(requests.has(input.request_id)) return previewRecord(record);
    if(record.asset.revision!==input.expected_revision) throw {code:'REVISION_CONFLICT',message:'资料已更改，请重新读取。'};
    const error=input.action.type==='revoke'?revokeError(record,input.action.event_id):lifecycleError(record,input.action,localDay());
    if(error) throw {code:'DATE_CONFLICT',message:error};
    if(params.get('state')==='save-error') throw {message:'模拟状态保存失败，输入应保留。'};
    const life=record.lifecycle??{state:'active',events:[]}; const action=input.action;
    if(action.type==='revoke') {life.events.pop();life.state=life.events.at(-1)?.kind==='retire'?'retired':'active';}
    else if(action.type==='append') {life.events.push({id:crypto.randomUUID(),sequence:life.events.length+1,kind:action.kind,date:action.date,notes:action.notes});life.state=action.kind==='retire'?'retired':'active';}
    else life.events.find(e=>e.id===action.event_id)!.date=action.date;
    record.lifecycle=life;record.asset.revision++;record.updated_at=new Date().toISOString();requests.set(input.request_id,previewRecord(record));return previewRecord(record);
  }
  if (command === 'change_sale') {
    const input=args.input as SaleChange;
    if(input.generation!==generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const record=records.find(r=>r.asset.id===input.asset_id);
    if(!record || record.deleted) throw {code:'REVISION_CONFLICT',message:'档案已删除或不可用。'};
    if(requests.has(input.request_id)) return previewRecord(record);
    if(record.asset.revision!==input.expected_revision) throw {code:'REVISION_CONFLICT',message:'资料已更改，请读取最新状态。'};
    if(params.get('state')==='save-error') throw {message:'模拟售出保存失败，输入应保留。'};
    const action=input.action;
    if(action.type==='sell') {
      if(record.sale || record.lifecycle?.state==='sold') throw {code:'STATE_CONFLICT',message:'已经售出。'};
      record.sale={id:crypto.randomUUID(),previous_state:record.lifecycle?.state??'active',fields:structuredClone(action.fields)} as Sale;
      record.lifecycle={...(record.lifecycle??{events:[]}),state:'sold'};
    } else {
      if(!record.sale || record.sale.id!==action.sale_id) throw {code:'STATE_CONFLICT',message:'售出已变化。'};
      if(action.type==='correct') record.sale.fields=structuredClone(action.fields);
      else {record.lifecycle={...(record.lifecycle??{events:[]}),state:record.sale.previous_state};record.sale=null;}
    }
    record.asset.revision++;record.updated_at=new Date().toISOString();requests.set(input.request_id,previewRecord(record));return previewRecord(record);
  }
  if (command === 'change_maintenance') {
    const input=args.input as MaintenanceChange;
    if(input.generation!==generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const record=records.find(r=>r.asset.id===input.asset_id);
    if(!record || record.deleted) throw {code:'REVISION_CONFLICT',message:'档案已删除或不可用。'};
    if(requests.has(input.request_id)) return previewRecord(record);
    if(record.asset.revision!==input.expected_revision) throw {code:'REVISION_CONFLICT',message:'资料已更改，请读取最新状态。'};
    const action=input.action;
    if(action.type==='add') {
      const maintenance:Maintenance={id:crypto.randomUUID(),fields:structuredClone(action.fields),photos:action.photos.ids.map(id=>({id,name:'虚构维护附件'})),created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
      record.maintenances=[...(record.maintenances??[]),maintenance];
    } else {
      const maintenance=record.maintenances?.find(item=>item.id===action.maintenance_id);
      if(!maintenance) throw {code:'STATE_CONFLICT',message:'维护记录已变化。'};
      maintenance.fields=structuredClone(action.fields);maintenance.photos=action.photos.ids.map(id=>({id,name:'虚构维护附件'}));maintenance.updated_at=new Date().toISOString();
    }
    record.asset.revision++;record.updated_at=new Date().toISOString();requests.set(input.request_id,previewRecord(record));
    if(action.fields.title==='回执核对测试') {lostMaintenanceReceipts.add(input.request_id);throw {message:'模拟响应丢失。'};}
    return previewRecord(record);
  }
  if (command === 'change_warranty') {
    const input=args.input as WarrantyChange;
    if(input.generation!==generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const record=records.find(r=>r.asset.id===input.asset_id);
    if(!record || record.deleted) throw {code:'REVISION_CONFLICT',message:'档案已删除或不可用。'};
    if(requests.has(input.request_id)) return previewRecord(record);
    if(record.asset.revision!==input.expected_revision) throw {code:'REVISION_CONFLICT',message:'资料已更改，请读取最新状态。'};
    if(params.get('state')==='save-error') throw {message:'模拟保障保存失败，输入应保留。'};
    const action=input.action;
    const now=new Date().toISOString();
    if(action.type==='add') {
      const warranty:Warranty={id:crypto.randomUUID(),fields:structuredClone(action.fields),status:'pending',remaining_days:null,photos:action.photos.ids.map(id=>({id,name:'虚构保障附件'})),created_at:now,updated_at:now};
      record.warranties=[...(record.warranties??[]),warranty];
    } else {
      const warranty=record.warranties?.find(item=>item.id===action.warranty_id);
      if(!warranty) throw {code:'STATE_CONFLICT',message:'保障记录已变化。'};
      warranty.fields=structuredClone(action.fields);warranty.photos=action.photos.ids.map(id=>({id,name:'虚构保障附件'}));warranty.updated_at=now;
    }
    record.asset.revision++;record.updated_at=new Date().toISOString();requests.set(input.request_id,previewRecord(record));
    if(action.fields.notes==='回执核对测试') {lostMaintenanceReceipts.add(input.request_id);throw {message:'模拟响应丢失。'};}
    return previewRecord(record);
  }
  if (command === 'photo_preview') {
    if(params.has('missing-maintenance-photo') && String(args.id)==='maintenance-photo-fixture') throw {code:'PHOTO_MISSING',message:'模拟维护原图缺失。'};
    return imageBytes(String(args.id));
  }
  if (command === 'list_materials') return previewMaterials().map(({id,name,builtin}) => ({id,name,builtin}));
  if (command === 'material_upload_result') {
    if(args.generation!==generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    return userMaterials.find(m=>m.id===args.request) ?? null;
  }
  if (command === 'add_material') {
    if(args.generation!==generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const saved = userMaterials.find(m=>m.id===args.request); if(saved) return saved;
    // The real upload opens a native picker; the preview adds a fixture art
    // entry so the library flow stays demonstrable in the browser.
    const art = MATERIALS[userMaterials.length % MATERIALS.length].id;
    const entry = { id: String(args.request), name: `自定义素材 ${userMaterials.length + 1}.png`, builtin: false, art };
    userMaterials = [...userMaterials, entry];
    return { id: entry.id, name: entry.name, builtin: false };
  }
  if (command === 'remove_material') {
    userMaterials = userMaterials.filter(m => m.id !== String(args.id));
    return previewMaterials().map(({id,name,builtin}) => ({id,name,builtin}));
  }
  if (command === 'material_preview') {
    const found = previewMaterials().find(m => m.id === String(args.id));
    if(!found) throw {code:'MATERIAL',message:'未知素材。'};
    return imageBytes(found.art);
  }
  if (command === 'prepare_material') {
    // In-memory stand-in for native staging; it cannot prove native durability.
    const input = args.input as {id: string; generation: string};
    if(input.generation!==generation) throw {code:'STALE_DATASET',message:'资料已切换，请重新打开档案。'};
    const material = previewMaterials().find(m => m.id === input.id);
    if(!material) throw {code:'MATERIAL',message:'未知素材，请重新选择。'};
    if(params.has('material-error')) throw {message:'模拟素材准备失败，输入应保留'};
    const id = `material-${material.id}-${++materialSequence}`;
    stagedMaterials.set(id, { art: material.art, name: material.builtin ? materialPhotoName(materialOf(material.id)!) : material.name });
    return {id, name: stagedMaterials.get(id)!.name};
  }
  if (command === 'import_photo_bytes') {
    if (args.generation !== generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const id = `uploaded-${++materialSequence}`;
    stagedMaterials.set(id,{art:id,name:String(args.name)});
    images.set(id,Promise.resolve(new Uint8Array(args.bytes as number[]).buffer));
    return {id,name:String(args.name)};
  }
  if (command === 'save_csv_template') return '/Users/demo/Downloads/物谱导入模板.csv';
  if (command === 'inspect_csv_import') return {path:'/tmp/旧表格.csv',name:'旧表格.csv',preview:{hash:'h',valid:12,invalid:[{line:5,name:'台灯',reason:'金额「约100」须为不小于 0 的数字，最多两位小数'},{line:9,name:'',reason:'名称须为 1–200 字'}],duplicates:[{line:3,name:'降噪耳机',reason:'名称、购入日期和购入价与已有物品相同'}],new_categories:['乐器'],new_channels:['闲鱼']}};
  if (command === 'commit_csv_import') throw {message:'导入请在原生 App 验证。'};
  if (command === 'pick_photo') throw {message:'图片选择请在原生 App 中验证，此页面仅使用虚构示意图。'};
  if (['set_appearance','set_editing','set_library_busy','finish_close','set_page_menu'].includes(command)) return null;
  throw {message:'此操作需在原生 App 验证：'+command};
}
mockIPC(handle,{shouldMockEvents:true});
window.addEventListener('keydown',event=>{
  if(!(event.metaKey||event.ctrlKey))return;
  const action:Record<string,string>={n:'new-asset',f:'find-asset',e:'edit-asset',a:'select-all',z:'undo'};
  if(action[event.key.toLowerCase()]){event.preventDefault();void emit('asset-action',action[event.key.toLowerCase()]);}
});
if (params.get('section')) sessionStorage.setItem('thingary.library-section.v1', params.get('section')!);
// 截图入口：自动进入指定标签的分析子视图（仅浏览器预览；?enter-tag=<labelId>&analysis-search=<词>）。
if (params.get('enter-tag')) {
  sessionStorage.setItem('thingary.enter-tag.v1', params.get('enter-tag')!);
  sessionStorage.setItem('thingary.enter-tag-search.v1', params.get('analysis-search') ?? '');
  sessionStorage.setItem('thingary.enter-tag-scope.v1', params.get('analysis-scope') === 'held' ? 'held' : 'all');
}
if (params.get('state') === 'components') void import('./ComponentPreview');
else void import('./main');
