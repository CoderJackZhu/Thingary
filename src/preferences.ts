import type { SaleFields } from './sales';
import { addYears } from './batch-select.ts';
export type AssetPreferences = { label_id:string|null; cost_mode:'daily'|'per_use'; use_count:number; goal:{mode:'none'}|{mode:'cost';cents:string}|{mode:'date';date:string}; pinned:boolean; exclude:{total:boolean;daily:boolean;statistics:boolean;timeline:boolean} };
export type AssetOptions = {preferences:AssetPreferences;warranty?:{start_date:string|null;end_date:string;reminder:{date:string;notes:string}|null}|null;retired_date?:string|null;sale?:SaleFields|null};
export function newAssetWarranty(addedDate: string): NonNullable<AssetOptions['warranty']> {
 return {start_date:addedDate,end_date:addYears(addedDate,1),reminder:null};
}
export const defaultPreferences = ():AssetPreferences=>({label_id:null,cost_mode:'daily',use_count:0,goal:{mode:'none'},pinned:false,exclude:{total:false,daily:false,statistics:false,timeline:false}});
export type WishPreferences = {added_date:string|null;channel_id:string|null;mode:'countdown'|'savings';saved_cents:string;achievement_source:'manual'|'savings'|'conversion'|null;pinned:boolean;reminder:boolean};
export const defaultWishPreferences = ():WishPreferences=>({added_date:null,channel_id:null,mode:'countdown',saved_cents:'0',achievement_source:null,pinned:false,reminder:false});
export function savingPercent(saved:string,price:string|null){if(price===null)return null;const goal=BigInt(price);return goal===0n?100:Number((BigInt(saved)*100n/goal)>100n?100n:BigInt(saved)*100n/goal);}
export type GoalProgress={hundredths:number;remaining:number;unit:'天'|'次';reached_date:string|null;projected_cents:string|null};
const plusDays=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
// 按日：已持有天数 ÷ ⌈总投入 ÷ 目标⌉；按次同理用次数；目标日期：已持有天数 ÷ 购入日到目标日天数。假设之后不再新增维护支出。
export function goalProgress(p:AssetPreferences,cost:string|null,held:number|null,purchase:string|null):GoalProgress|null{
 const pct=(done:number,need:number)=>need<=0?10000:Math.min(10000,Math.floor(done*10000/need));
 if(p.goal.mode==='date'){if(!purchase||held===null||p.goal.date<purchase)return null;const days=(Date.parse(p.goal.date)-Date.parse(purchase))/86400000+1;
  const projected=cost===null||p.cost_mode==='per_use'?null:((BigInt(cost)+BigInt(days>>1))/BigInt(days)).toString();
  return {hundredths:pct(held,days),remaining:Math.max(0,days-held),unit:'天',reached_date:p.goal.date,projected_cents:projected};}
 if(p.goal.mode!=='cost'||cost===null)return null;const target=BigInt(p.goal.cents);if(target<=0n)return null;
 const c=BigInt(cost),need=c<=0n?0:Number((c+target-1n)/target);
 if(p.cost_mode==='per_use')return {hundredths:pct(p.use_count,need),remaining:Math.max(0,need-p.use_count),unit:'次',reached_date:null,projected_cents:null};
 if(held===null||!purchase)return null;
 return {hundredths:pct(held,need),remaining:Math.max(0,need-held),unit:'天',reached_date:plusDays(purchase,Math.max(need,1)-1),projected_cents:null};
}
// A retired asset's goal stops at its latest retirement; reactivation resumes the normal count.
export function retiredOn(life?: { state: string; events: { kind: string; date: string }[] }) { return life?.state === 'retired' ? life.events.filter(e => e.kind === 'retire').at(-1)?.date ?? null : null; }
