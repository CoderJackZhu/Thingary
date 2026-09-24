// Development-only entry. Renders the production App with an in-memory IPC
// adapter; index.html and the production build never import this module.
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import type { AssetRecord, Page, Query, SaveAsset } from './asset';
import { localDay } from './asset';
import type { TrashChange } from './Trash';
import { applyPreviewCommand, previewSnapshot } from './taxonomy';
import type { PreviewCatalog, TaxonomyCommand } from './taxonomy';
import { fixtureArt } from './visual-fixtures';

const seeds = [
  ['laptop', 'MacBook Pro 14″', 'Apple', 'M3 Pro · 深空黑', '1699900', '2024-03-18', '日常工作与创作的主力。'],
  ['camera', 'Fujifilm X100V', 'Fujifilm', '银色', '979000', '2023-06-12', '出门时带上的那台相机。记录周末散步，也记录远一点的地方。'],
  ['headphones', 'WH-1000XM5', 'Sony', '黑色', '219900', '2024-09-01', '专注时刻的安静陪伴。'],
  ['phone', 'iPhone 12 mini', 'Apple', '128 GB · 绿色', '549900', '2021-02-11', '保存下来的小屏手机。'],
  ['keyboard', '机械键盘 K2', 'Keychron', '朋友赠送', '0', '2025-12-25', '去年收到的礼物。'],
  ['coffee', '家里的咖啡机', '', '', null, '2022-05-01', '等找到订单再补充金额。'],
  ['box', '随身录音设备', '', '', '100000', null, '先留下名字和金额。'],
] as const;
let records: AssetRecord[] = seeds.map(([id,name,brand,model,price,date,notes],i) => ({
  asset: { id, name, price_cents: price, purchase_date: date, revision: 1 },
  details: { brand, model, serial_number: '', notes },
  created_at: new Date(Date.UTC(2026,8,10,8,0,i)).toISOString(), updated_at: null,
  classification: {category_id: ['computer','camera','audio','phone',null,'home',null][i],channel_id:'online'},
  deleted: false, deleted_at: null, photos: [{id,name:'虚构物品示意图'}], cover_id: id,
}));
let taxonomyRevision = 0;
const taxonomyReceipts = new Map<string,string>();
let catalog: PreviewCatalog = {categories:[['computer','电脑'],['phone','手机'],['camera','摄影'],['audio','音频'],['home','家电'],['box','其他']].map(([id,name])=>({id,name,icon:id as 'computer',references:{activeAssets:0,deletedAssets:0}})),channels:[{id:'online',name:'京东',references:{activeAssets:0,deletedAssets:0}},{id:'store',name:'线下',references:{activeAssets:0,deletedAssets:0}}],assets:[]};
function taxonomySnapshot() { catalog.assets=records.map(r=>({id:r.asset.id,categoryId:r.classification?.category_id??null,channelId:r.classification?.channel_id??null,deleted:r.deleted})); return {generation,revision:taxonomyRevision,...previewSnapshot(catalog)}; }
const requests = new Map<string, AssetRecord>();
const generation = 'visual-fixture-only';
const params = new URLSearchParams(location.search);
if (params.get('state') === 'empty') records = [];
// This preview owns its isolated origin and only removes its own reminder keys:
// records reset on reload, so pending requests from the previous fixture are stale.
for (const key of ['possio.asset-draft.v1','possio.trash-request.v1','possio.taxonomy-request.v1']) localStorage.removeItem(key);
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
    if(query.category?.mode==='uncategorized') found=found.filter(r=>!r.classification?.category_id);
    if(query.category?.mode==='category') {const id=query.category.id;found=found.filter(r=>r.classification?.category_id===id);}
    const value=(r:AssetRecord):string|number|null => query.sort==='name'?r.asset.name:query.sort==='price'?(r.asset.price_cents===null?null:Number(r.asset.price_cents)):query.sort==='date'?r.asset.purchase_date:query.sort==='deleted'?r.deleted_at:r.created_at;
    found.sort((a,b)=>{const x=value(a),y=value(b); if(x===null)return y===null?0:1;if(y===null)return -1;return (typeof x==='number' && typeof y==='number'?x-y:String(x).localeCompare(String(y),'zh-CN'))*(query.descending?-1:1);});
    return { generation, items: structuredClone(found.slice(query.offset,query.offset+100)), total:found.length, today:localDay() } satisfies Page;
  }
  if (command === 'read_asset') return structuredClone(records.find(r=>r.asset.id===args.id) ?? null);
  if (command === 'saved_request' || command === 'trash_request') return structuredClone(requests.get(String(args.request)) ?? null);
  if (command === 'save_asset') {
    if(params.get('state')==='save-error') throw {message:'模拟保存失败，输入应保留。'};
    const input=args.input as SaveAsset;
    const old=records.find(r=>r.asset.id===input.base.asset_id);
    const id=old?.asset.id ?? crypto.randomUUID();
    const record:AssetRecord={classification:input.classification??old?.classification??{category_id:null,channel_id:null},asset:{id,name:input.base.name,price_cents:input.base.price_cents,purchase_date:input.base.purchase_date,revision:(old?.asset.revision??0)+1},details:input.details,created_at:old?.created_at??new Date().toISOString(),updated_at:new Date().toISOString(),deleted:false,deleted_at:null,photos:(input.photos?.ids??[]).map(photoId=>({id:photoId,name:'虚构物品示意图'})),cover_id:input.photos?.cover_id??null};
    taxonomyRevision++; records=records.filter(r=>r.asset.id!==id).concat(record); requests.set(input.base.request_id,record); return structuredClone(record);
  }
  // Exercise production delete/restore UI, without touching the native library.
  if (command === 'change_trash') {
    const input = args.input as TrashChange;
    const record = records.find(r => r.asset.id === input.asset_id);
    if (!record) throw {message:'虚构记录不存在。'};
    taxonomyRevision++; record.deleted = input.deleted;
    record.deleted_at = input.deleted ? new Date().toISOString() : null;
    record.asset.revision += 1;
    requests.set(input.request_id, structuredClone(record));
    return structuredClone(record);
  }
  if (command === 'photo_preview') return imageBytes(String(args.id));
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
