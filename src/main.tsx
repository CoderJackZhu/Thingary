import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {invoke} from '@tauri-apps/api/core';
import './style.css';
type Asset={id:string;name:string;price_cents:string|null;purchase_date:string|null;revision:number};
type Snapshot={generation:string;asset:Asset|null;sqlite_version:string};
type Save={request_id:string;generation:string;asset_id:string|null;expected_revision:number|null;name:string;price_cents:string|null;purchase_date:string|null};
function message(e:unknown){return typeof e==='object'&&e!==null&&'message' in e?String(e.message):'操作未完成，请重试。';}
function App(){
 const [data,setData]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('正在读取本地验证资料…');
 const pending=useRef<Save|null>(null);
 async function read(){const s=await invoke<Snapshot>('snapshot');setData(s);return s;}
 useEffect(()=>{void read().then(()=>setNotice('只使用内置虚构资料。')).catch(e=>setNotice(message(e)));},[]);
 async function save(){if(!data||busy)return;setBusy(true);
  const a=data.asset;
  pending.current??={request_id:crypto.randomUUID(),generation:data.generation,asset_id:a?.id??null,expected_revision:a?.revision??null,name:a?'虚构相机 · 补录记录':'虚构相机 · 初始记录',price_cents:'100000',purchase_date:'2026-09-15'};
  try{await invoke<Asset>('save_sample',{input:pending.current});pending.current=null;await read();setNotice('保存完成。退出并重新打开后可检查同一份记录。');}catch(e){setNotice(message(e));}finally{setBusy(false);}
 }
 return <div className="shell"><aside><strong>物志</strong><span>本地工程验证</span><p className="selected">验证工作台</p></aside><main><header><div><p className="eyebrow">POSSIO · 静序</p><h1>让每一件物品，有迹可循。</h1></div><span className="badge">验证版</span></header><section><h2>一件虚构物品</h2><p>这里仅验证保存与恢复。临时资料可被系统清理，请勿用于正式记录。</p>{data?.asset?<dl><dt>名称</dt><dd>{data.asset.name}</dd><dt>购入金额</dt><dd>¥1,000.00</dd><dt>购入日期</dt><dd>{data.asset.purchase_date}</dd><dt>保存版本</dt><dd>{data.asset.revision}</dd></dl>:<p>尚未保存样例。</p>}<button onClick={()=>void save()} disabled={!data||busy}>{busy?'正在保存…':data?.asset?'补录虚构记录':'保存虚构记录'}</button><p role="status" aria-live="polite">{notice}</p></section></main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
