import type { SaleFields } from './sales';
export type AssetPreferences = { label_id:string|null; cost_mode:'daily'|'per_use'; use_count:number; goal:{mode:'none'}|{mode:'cost';cents:string}|{mode:'date';date:string}; pinned:boolean; exclude:{total:boolean;daily:boolean;statistics:boolean;timeline:boolean} };
export type AssetOptions = {preferences:AssetPreferences;warranty?:{start_date:string|null;end_date:string;reminder:{date:string;notes:string}|null}|null;retired_date?:string|null;sale?:SaleFields|null};
export const defaultPreferences = ():AssetPreferences=>({label_id:null,cost_mode:'daily',use_count:0,goal:{mode:'none'},pinned:false,exclude:{total:false,daily:false,statistics:false,timeline:false}});
export type WishPreferences = {added_date:string|null;channel_id:string|null;mode:'countdown'|'savings';saved_cents:string;achievement_source:'manual'|'savings'|'conversion'|null;pinned:boolean;reminder:boolean};
export const defaultWishPreferences = ():WishPreferences=>({added_date:null,channel_id:null,mode:'countdown',saved_cents:'0',achievement_source:null,pinned:false,reminder:false});
export function savingPercent(saved:string,price:string|null){if(price===null)return null;const goal=BigInt(price);return goal===0n?100:Number((BigInt(saved)*100n/goal)>100n?100n:BigInt(saved)*100n/goal);}
