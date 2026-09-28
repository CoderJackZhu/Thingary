// Development-only entry. Renders the production App with an in-memory IPC
// adapter; index.html and the production build never import this module.
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type { AssetRecord, Page, Query, SaveAsset } from './asset';
import { localDay } from './asset';
import type { TrashChange, RecordTrashChange, TrashEntry } from './Trash';
import { applyPreviewCommand, previewSnapshot } from './taxonomy';
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
import demoAssets from './demo-assets.json';
import { wealthPreview } from './wealth-preview';
const emptyCosts = {known_maintenance_cents:'0',unknown_maintenance_count:0,total_investment_cents:null,sale_proceeds_cents:null,net_cost_cents:null,held_days:null,daily_cents:null};
const emptyWarrantySummary = {status:'none',total:0,active_count:0,expiring_count:0,upcoming_count:0,expired_count:0,pending_count:0} as const;

const categoryNames = [...new Map(demoAssets.map(a => [a.icon, a.category])).entries()];
const channelNames = [...new Set(demoAssets.flatMap(a => a.channel ? [a.channel] : []))];
let records: AssetRecord[] = demoAssets.map((a, i) => ({
  lifecycle: {state: a.sale ? 'sold' : a.retired_on ? 'retired' : 'active', events: a.retired_on ? [{id:'demo-retirement',sequence:1,kind:'retire',date:a.retired_on,notes:'留作备用机'}] : []},
  sale: a.sale ? {id:'demo-sale',previous_state:'active',fields:a.sale} : null,
  maintenances: a.maintenance ? [{id:'demo-maintenance-'+a.key,fields:{...a.maintenance,kind:a.maintenance.kind as Maintenance['fields']['kind']},photos:[],created_at:a.maintenance.date+'T08:00:00Z',updated_at:a.maintenance.date+'T08:00:00Z'}] : [],
  warranties: [],
  warranty_summary: {...emptyWarrantySummary},
  costs: {...emptyCosts},
  asset: { id:a.key, name:a.name, price_cents:a.price_cents, purchase_date:a.purchase_date, revision:1 },
  details: {brand:a.brand,model:a.model,serial_number:'',notes:a.notes},
  created_at: new Date(Date.UTC(2026,8,10,8,0,8-i)).toISOString(), updated_at:null,
  classification: {category_id:a.icon,channel_id:a.channel ? 'demo-channel-'+channelNames.indexOf(a.channel) : null},
  deleted:false,deleted_at:null,photos:[{id:a.key,name:'原始 Demo 虚构物品示意图'}],cover_id:a.key,
}));
let taxonomyRevision = 0;
const taxonomyReceipts = new Map<string,string>();
let catalog: PreviewCatalog = {categories:[...categoryNames,['box','其他']].map(([id,name])=>({id,name,icon:id as 'computer',references:{activeAssets:0,deletedAssets:0}})),channels:channelNames.map((name,i)=>({id:'demo-channel-'+i,name,references:{activeAssets:0,deletedAssets:0}})),assets:[]};
function taxonomySnapshot() { catalog.assets=records.map(r=>({id:r.asset.id,categoryId:r.classification?.category_id??null,channelId:r.classification?.channel_id??null,deleted:r.deleted})); return {generation,revision:taxonomyRevision,...previewSnapshot(catalog)}; }
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
if (params.has('maintenance-photo') && records[0]) records[0].maintenances=[{id:'maintenance-fixture',fields:{date:'2026-09-20',kind:'repair',title:'更换快门',description:'虚构验收记录',cost_cents:'15000',provider:'虚构维修点'},created_at:new Date().toISOString(),updated_at:new Date().toISOString(),photos:[{id:'maintenance-photo-fixture',name:'维护前照片'}]}];
// This preview owns its isolated origin and only removes its own reminder keys:
// records reset on reload, so pending requests from the previous fixture are stale.
for (const key of ['possio.asset-draft.v1','possio.trash-request.v1','possio.record-trash-request.v1','possio.taxonomy-request.v1','possio.lifecycle-draft.v1','possio.sale-draft.v1']) localStorage.removeItem(key);
if (!params.has('preserve-maintenance')) localStorage.removeItem('possio.maintenance-draft.v1');
if (!params.has('preserve-warranty')) localStorage.removeItem('possio.warranty-draft.v1');
if (params.has('theme')) localStorage.setItem('possio.theme',params.get('theme') === 'dark' ? 'dark' : 'light');
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
async function handle(command: string, payload: unknown): Promise<unknown> {
  const args = payload as Record<string,unknown>;
  if (command === 'choice_list') {
    const kind = String(args.kind);
    const items = kind === 'category' ? catalog.categories.map(c => ({ id: c.id, name: c.name, enabled: true })) : kind === 'channel' ? catalog.channels.map(c => ({ id: c.id, name: c.name, enabled: true })) : [{ id: 'label-active', name: '活跃中', enabled: true }];
    return { revision: 0, items };
  }
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
  const wealth = wealthPreview(command,args); if (wealth) return wealth.value;
  if (command === 'demo_status') return {active:params.get('demo') === '1',available:true,started:true};
  if (command === 'switch_demo' || command === 'reset_demo') throw {message:'浏览器预览仅用于界面检查；切库和重置请在隔离原生验收版中验证。'};
  if (command === 'taxonomy_snapshot') return taxonomySnapshot();
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
  if (command === 'list_assets') {
    if (params.get('state') === 'error') throw { message: '虚构加载失败，用于验证错误页面。' };
    const query = args.query as Query;
    let found=records.filter(r => r.deleted === (query.filter === 'deleted'));
    found=found.filter(r => (!query.search || [r.asset.name,...Object.values(r.details),catalog.categories.find(c=>c.id===r.classification?.category_id)?.name??''].join(' ').toLowerCase().includes(query.search.toLowerCase())) && (query.filter !== 'missing_price' || r.asset.price_cents === null) && (query.filter !== 'missing_date' || r.asset.purchase_date === null));
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
    const value=(r:AssetRecord):string|number|null => query.sort==='name'?r.asset.name:query.sort==='price'?(r.asset.price_cents===null?null:Number(r.asset.price_cents)):query.sort==='date'?r.asset.purchase_date:query.sort==='deleted'?r.deleted_at:r.created_at;
    found.sort((a,b)=>{const x=value(a),y=value(b); if(x===null)return y===null?0:1;if(y===null)return -1;return (typeof x==='number' && typeof y==='number'?x-y:String(x).localeCompare(String(y),'zh-CN'))*(query.descending?-1:1);});
    return { generation, items: found.slice(query.offset,args.all ? undefined : query.offset+100).map(r => previewRecord(r)), total:found.length, today:localDay() } satisfies Page;
  }
  if (command === 'read_asset') { const record = records.find(r=>r.asset.id===args.id); return record ? previewRecord(record) : null; }
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
    const record:AssetRecord={sale:old?.sale??null,maintenances:old?.maintenances??[],warranties:old?.warranties??[],warranty_summary:old?.warranty_summary??{...emptyWarrantySummary},costs:old?.costs??{...emptyCosts,total_investment_cents:input.base.price_cents},lifecycle:old?.lifecycle??{state:'active',events:[]},classification:input.classification??old?.classification??{category_id:null,channel_id:null},asset:{id,name:input.base.name,price_cents:input.base.price_cents,purchase_date:input.base.purchase_date,revision:(old?.asset.revision??0)+1},details:input.details,created_at:old?.created_at??new Date().toISOString(),updated_at:new Date().toISOString(),deleted:false,deleted_at:null,photos:(input.photos?.ids??[]).map(photoId=>({id:photoId,name:previewPhotoName(photoId)})),cover_id:input.photos?.cover_id??null};
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
    const query = args.query as { filter: string; offset: number };
    const items: TrashEntry[] = [];
    for (const r of records) if (r.deleted) items.push({ kind:'asset', id:r.asset.id, title:r.asset.name, subtype:null, date:null, end_date:null, cost_cents:null, provider:null, deleted_at:r.deleted_at!, asset_id:null, asset_name:null, asset_deleted:true, asset_revision:r.asset.revision, asset_state:r.lifecycle?.state ?? 'active', contents:([['maintenance',r.maintenances.length],['warranty',(r.warranties??[]).length],['photo',r.photos.length]] as const).filter(([,n])=>n>0).map(([kind,count])=>({kind,count})) });
    const parentFacts = (assetId: string) => { const parent = records.find(r => r.asset.id === assetId); return parent ? { parent, state: parent.lifecycle?.state ?? 'active' } : null; };
    for (const entry of deletedMaintenances) { const facts = parentFacts(entry.assetId); if (!facts) continue; items.push({ kind:'maintenance', id:entry.id, title:entry.snapshot.fields.title, subtype:entry.snapshot.fields.kind, date:entry.snapshot.fields.date, end_date:null, cost_cents:entry.snapshot.fields.cost_cents, provider:null, deleted_at:entry.deleted_at, asset_id:facts.parent.asset.id, asset_name:facts.parent.asset.name, asset_deleted:facts.parent.deleted, asset_revision:facts.parent.asset.revision, asset_state:facts.state, contents:[] }); }
    for (const entry of deletedWarranties) { const facts = parentFacts(entry.assetId); if (!facts) continue; items.push({ kind:'warranty', id:entry.id, title:entry.snapshot.fields.provider, subtype:entry.snapshot.fields.kind, date:entry.snapshot.fields.start_date, end_date:entry.snapshot.fields.end_date, cost_cents:null, provider:entry.snapshot.fields.provider, deleted_at:entry.deleted_at, asset_id:facts.parent.asset.id, asset_name:facts.parent.asset.name, asset_deleted:facts.parent.deleted, asset_revision:facts.parent.asset.revision, asset_state:facts.state, contents:[] }); }
    const found = query.filter === 'all' ? items : items.filter(i => i.kind === query.filter);
    found.sort((a,b) => b.deleted_at.localeCompare(a.deleted_at) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    return { generation, items: found.slice(query.offset, query.offset + 100), total: found.length };
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
  if (command === 'pick_photo') throw {message:'图片选择请在原生 App 中验证，此页面仅使用虚构示意图。'};
  if (['set_appearance','set_editing','set_library_busy','finish_close'].includes(command)) return null;
  throw {message:'此操作需在原生 App 验证：'+command};
}
mockIPC(handle,{shouldMockEvents:true});
window.addEventListener('keydown',event=>{
  if(!(event.metaKey||event.ctrlKey))return;
  const action:Record<string,string>={n:'new-asset',f:'find-asset',e:'edit-asset',a:'select-all',z:'undo'};
  if(action[event.key.toLowerCase()]){event.preventDefault();void emit('asset-action',action[event.key.toLowerCase()]);}
});
if (params.get('section')) sessionStorage.setItem('possio.library-section.v1', params.get('section')!);
void import('./main');
