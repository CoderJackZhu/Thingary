import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS, filterMaterials, rememberMaterial, readRecentMaterials } from '../src/materials.ts';
import { replaceDraftCover } from '../src/asset-media.ts';
const entries=MATERIALS.map(m=>({...m,builtin:true}));
test('requested objects all have distinct named vector artwork',()=>{
 const names='手机 笔记本电脑 平板 台式电脑 手表 耳机 相机 键盘 鼠标 麦克风 游戏机 游戏手柄 收音机 摄像头 摄像机 电池 CPU 软盘 显卡 机械硬盘 内存条 显示器 主板 固态硬盘 机箱 电源 便携运动相机 无人机 轻薄笔记本 口袋云台相机 电视 冰箱 电饭煲 微波炉 油烟机 空调 洗碗机 电风扇 电热水器 烤箱 平底锅 煤气灶'.split(' ');
 for(const name of names) assert.ok(MATERIALS.some(m=>m.name===name && m.style==='icon' && m.shape),name);
 assert.equal(new Set(MATERIALS.map(m=>m.id)).size,MATERIALS.length);
});
test('source, category and alias search intersect without changing asset data',()=>{
 assert.deepEqual(filterMaterials(entries,'icon','数码','HDD',[]).map(m=>m.name),['机械硬盘']);
 assert.equal(filterMaterials(entries,'icon','家电','HDD',[]).length,0);
 assert.equal(filterMaterials(entries,'dimensional','全部','',[]).length,16);
 assert.deepEqual(filterMaterials(entries,'dimensional','家电','滚筒',[]).map(m=>m.id),['object3d-washer']);
 assert.deepEqual(filterMaterials(entries,'icon','家电','滚筒',[]).map(m=>m.id),['icon-washer']);
 assert.equal(filterMaterials([...entries,{id:'custom',name:'我的照片',builtin:false}],'custom','全部','',[]).length,1);
});
test('recent choices are bounded, deduplicated and isolated by dataset generation',()=>{
 const data=new Map(); const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 for(let i=0;i<30;i++) rememberMaterial(storage,'demo',String(i));
 rememberMaterial(storage,'demo','25');
 assert.equal(readRecentMaterials(storage,'demo').length,24);
 assert.equal(readRecentMaterials(storage,'demo')[0],'25');
 assert.deepEqual(readRecentMaterials(storage,'real'),[]);
 data.set('possio.recent-materials.demo','{"bad":true}');assert.deepEqual(readRecentMaterials(storage,'demo'),[]);
});
test('replacing a draft icon retains saved photos and attachments, removes only its transient predecessor',()=>{
 const saved={id:'saved',name:'实物照片'};const receipt={id:'receipt',name:'发票'};const first={id:'first',name:'手机图标'};const second={id:'second',name:'相机图标'};
 const a=replaceDraftCover([saved,receipt],undefined,first,true);
 const b=replaceDraftCover(a.photos,a.transientCover,second,true);
 assert.deepEqual(b.photos,[saved,receipt,second]);assert.equal(b.cover,'second');
 const c=replaceDraftCover(b.photos,b.transientCover,null,false);
 assert.deepEqual(c.photos,[saved,receipt]);assert.equal(c.cover,null);
 assert.deepEqual(replaceDraftCover([saved,receipt],undefined,receipt,false).photos,[saved,receipt]);
});
test('photo limit permits replacement at capacity and rejects additional images without removing saved ones',()=>{
 const photos=Array.from({length:20},(_,i)=>({id:String(i),name:'photo'}));
 assert.throws(()=>replaceDraftCover(photos,undefined,{id:'new',name:'new'},true),/20/);
 assert.equal(photos.length,20);
 assert.equal(replaceDraftCover(photos,'19',{id:'new',name:'new'},true).photos.length,20);
});
