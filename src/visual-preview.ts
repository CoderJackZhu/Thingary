// Development-only entry. Renders the production App with an in-memory IPC
// adapter; index.html and the production build never import this module.
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type { AssetRecord, Page, Query, SaveAsset } from './asset';
import { localDay } from './asset';
import type { TrashChange } from './Trash';
import { applyPreviewCommand, previewSnapshot } from './taxonomy';
import type { PreviewCatalog, TaxonomyCommand } from './taxonomy';
import type { SaleChange, Sale } from './sales';
import { lifecycleError } from './lifecycle';
import type { LifecycleChange } from './lifecycle';
import type { Maintenance, MaintenanceChange } from './maintenance';
import { fixtureArt } from './visual-fixtures';
import { previewRecord } from './preview-costs';
import demoAssets from './demo-assets.json';
const emptyCosts = {known_maintenance_cents:'0',unknown_maintenance_count:0,total_investment_cents:null,sale_proceeds_cents:null,net_cost_cents:null,held_days:null,daily_cents:null};

const categoryNames = [...new Map(demoAssets.map(a => [a.icon, a.category])).entries()];
const channelNames = [...new Set(demoAssets.flatMap(a => a.channel ? [a.channel] : []))];
let records: AssetRecord[] = demoAssets.map((a, i) => ({
  lifecycle: {state: a.sale ? 'sold' : a.retired_on ? 'retired' : 'active', events: a.retired_on ? [{id:'demo-retirement',sequence:1,kind:'retire',date:a.retired_on,notes:'留作备用机'}] : []},
  sale: a.sale ? {id:'demo-sale',previous_state:'active',fields:a.sale} : null,
  maintenances: a.maintenance ? [{id:'demo-maintenance-'+a.key,fields:{...a.maintenance,kind:a.maintenance.kind as Maintenance['fields']['kind']},photos:[],created_at:a.maintenance.date+'T08:00:00Z',updated_at:a.maintenance.date+'T08:00:00Z'}] : [],
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
const lostMaintenanceReceipts = new Set<string>();
const generation = 'visual-fixture-only';
const params = new URLSearchParams(location.search);

if (params.get('state') === 'empty') records = [];
if (params.has('no-photos')) records = records.map(r => ({...r,photos:[],cover_id:null}));
if (params.has('maintenance-photo') && records[0]) records[0].maintenances=[{id:'maintenance-fixture',fields:{date:'2026-09-20',kind:'repair',title:'更换快门',description:'虚构验收记录',cost_cents:'15000',provider:'虚构维修点'},created_at:new Date().toISOString(),updated_at:new Date().toISOString(),photos:[{id:'maintenance-photo-fixture',name:'维护前照片'}]}];
// This preview owns its isolated origin and only removes its own reminder keys:
// records reset on reload, so pending requests from the previous fixture are stale.
for (const key of ['possio.asset-draft.v1','possio.trash-request.v1','possio.taxonomy-request.v1','possio.lifecycle-draft.v1','possio.sale-draft.v1']) localStorage.removeItem(key);
if (!params.has('preserve-maintenance')) localStorage.removeItem('possio.maintenance-draft.v1');
if (params.has('theme')) localStorage.setItem('possio.theme',params.get('theme') === 'dark' ? 'dark' : 'light');
const images = new Map<string, Promise<ArrayBuffer>>();
function imageBytes(id: string): Promise<ArrayBuffer> {
  if (!images.has(id)) images.set(id, new Promise((resolve,reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width=480; canvas.height=360;
      canvas.getContext('2d')!.drawImage(img,0,0,480,360);
      canvas.toBlob(blob => { if(blob) void blob.arrayBuffer().then(resolve); else reject(new Error('Fixture image failed')); },'image/png');
    };
    img.onerror = () => reject(new Error('Fixture illustration failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fixtureArt(id));
  }));
  return images.get(id)!;
}
mockIPC(async (command,payload) => {
  const args = payload as Record<string,unknown>;
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
    const value=(r:AssetRecord):string|number|null => query.sort==='name'?r.asset.name:query.sort==='price'?(r.asset.price_cents===null?null:Number(r.asset.price_cents)):query.sort==='date'?r.asset.purchase_date:query.sort==='deleted'?r.deleted_at:r.created_at;
    found.sort((a,b)=>{const x=value(a),y=value(b); if(x===null)return y===null?0:1;if(y===null)return -1;return (typeof x==='number' && typeof y==='number'?x-y:String(x).localeCompare(String(y),'zh-CN'))*(query.descending?-1:1);});
    return { generation, items: found.slice(query.offset,query.offset+100).map(r => previewRecord(r)), total:found.length, today:localDay() } satisfies Page;
  }
  if (command === 'read_asset') { const record = records.find(r=>r.asset.id===args.id); return record ? previewRecord(record) : null; }
  if (command === 'saved_request') {
    const request=String(args.request);
    if(lostMaintenanceReceipts.delete(request)) throw {message:'模拟首次回执查询失败。'};
    if(params.has('pending-receipt') && request==='request-stable') return structuredClone(records[0] ?? null);
    return structuredClone(requests.get(request) ?? null);
  }
  if (command === 'trash_request') return structuredClone(requests.get(String(args.request)) ?? null);
  if (command === 'save_asset') {
    if(params.get('state')==='save-error') throw {message:'模拟保存失败，输入应保留。'};
    const input=args.input as SaveAsset;
    const old=records.find(r=>r.asset.id===input.base.asset_id);
    if(old?.sale && input.base.purchase_date && input.base.purchase_date>old.sale.fields.date) throw {code:'DATE_CONFLICT',message:'购入日期晚于有效售出记录。'};
    if(old && input.base.purchase_date && old.lifecycle?.events.some(e=>e.date<input.base.purchase_date!)) throw {code:'DATE_CONFLICT',message:'购入日期晚于已有状态记录，请先更正相关动作日期。'};
    const id=old?.asset.id ?? crypto.randomUUID();
    const record:AssetRecord={sale:old?.sale??null,maintenances:old?.maintenances??[],costs:old?.costs??{...emptyCosts,total_investment_cents:input.base.price_cents},lifecycle:old?.lifecycle??{state:'active',events:[]},classification:input.classification??old?.classification??{category_id:null,channel_id:null},asset:{id,name:input.base.name,price_cents:input.base.price_cents,purchase_date:input.base.purchase_date,revision:(old?.asset.revision??0)+1},details:input.details,created_at:old?.created_at??new Date().toISOString(),updated_at:new Date().toISOString(),deleted:false,deleted_at:null,photos:(input.photos?.ids??[]).map(photoId=>({id:photoId,name:'虚构物品示意图'})),cover_id:input.photos?.cover_id??null};
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
  if (command === 'change_lifecycle') {
    const input=args.input as LifecycleChange;
    if(input.generation!==generation) throw {code:'STALE_DATASET',message:'资料已切换。'};
    const record=records.find(r=>r.asset.id===input.asset_id);
    if(!record) throw {message:'找不到虚构记录。'};
    if(requests.has(input.request_id)) return previewRecord(record);
    if(record.asset.revision!==input.expected_revision) throw {code:'REVISION_CONFLICT',message:'资料已更改，请重新读取。'};
    const error=lifecycleError(record,input.action,localDay());
    if(error) throw {code:'DATE_CONFLICT',message:error};
    if(params.get('state')==='save-error') throw {message:'模拟状态保存失败，输入应保留。'};
    const life=record.lifecycle??{state:'active',events:[]}; const action=input.action;
    if(action.type==='append') {life.events.push({id:crypto.randomUUID(),sequence:life.events.length+1,kind:action.kind,date:action.date,notes:action.notes});life.state=action.kind==='retire'?'retired':'active';}
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
  if (command === 'photo_preview') {
    if(params.has('missing-maintenance-photo') && String(args.id)==='maintenance-photo-fixture') throw {code:'PHOTO_MISSING',message:'模拟维护原图缺失。'};
    return imageBytes(String(args.id));
  }
  if (command === 'pick_photo') throw {message:'图片选择请在原生 App 中验证，此页面仅使用虚构示意图。'};
  if (['set_appearance','set_editing','finish_close'].includes(command)) return null;
  throw {message:'此操作需在原生 App 验证：'+command};
},{shouldMockEvents:true});
window.addEventListener('keydown',event=>{
  if(!(event.metaKey||event.ctrlKey))return;
  const action:Record<string,string>={n:'new-asset',f:'find-asset',e:'edit-asset'};
  if(action[event.key.toLowerCase()]){event.preventDefault();void emit('asset-action',action[event.key.toLowerCase()]);}
});
void import('./main');
