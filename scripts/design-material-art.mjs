// Original, editable object illustrations. Run this before render-material-icons.mjs.
import { readFile, writeFile } from 'node:fs/promises';
import { objectArt } from '../src/illustrations.ts';
const path=new URL('../src-tauri/materials/materials.json',import.meta.url);
const catalog=JSON.parse(await readFile(path,'utf8')).filter(m=>!m.id.startsWith('object3d-'));
const originals={phone:'phone',laptop:'laptop',tablet:'tablet',headphones:'headphones',camera:'camera',keyboard:'keyboard',ultrabook:'laptop'};
const palettes={数码:['#a5b6c6','#546979','#263d50'],家电:['#e0ddd3','#a49d8c','#5e655f'],家居:['#c5cbbb','#859482','#515e55'],办公:['#c3cdd1','#879ca4','#415866'],交通:['#acc4c9','#638b96','#334d60'],运动:['#d9b39c','#b27b62','#6d594f'],厨具:['#b6c4c5','#738d92','#3c5157'],通用:['#c8bba7','#a09381','#6d716e']};
function frame(body,colors){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><linearGradient id="body" x2=".8" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient><linearGradient id="glass" x2="1" y2="1"><stop stop-color="#223d55"/><stop offset=".55" stop-color="#557b91"/><stop offset="1" stop-color="#a6c1c8"/></linearGradient><linearGradient id="metal" x2="1" y2="1"><stop stop-color="#edf0ed"/><stop offset=".5" stop-color="#aab9bb"/><stop offset="1" stop-color="#728990"/></linearGradient></defs><ellipse cx="40" cy="69" rx="24" ry="3" fill="#263d50" opacity=".1"/><g transform="translate(8 7)" stroke="${colors[2]}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;}
const extras={
 box:'<path d="M10 25 32 34 54 25v25L32 60 10 50Z" fill="#b99363"/><path d="M32 34v26l22-10V25Z" fill="#96754e"/><path d="M10 25 32 15l22 10-22 9Z" fill="#80664c"/><path d="M10 25 2 15 24 5l8 10ZM32 15 40 5l22 10-8 10Z" fill="#dac39e"/><path d="m10 25 22 9-8 11L2 35ZM32 34l22-9 8 10-22 10Z" fill="#e7d1ac"/><path d="m17 47 8 3v5l-8-3Z" fill="#f0e3c9" stroke="none"/>',
 desktop:'<rect x="10" y="19" width="27" height="20" rx="1" fill="url(#glass)" stroke="none"/><path d="M11 38c9-18 16-4 25-17v17" fill="#a6c0cd" stroke="none"/><circle cx="52" cy="44" r="2" fill="#bedbc8"/>',
 watch:'<path d="M24 18l2-11h12l2 11M24 46l2 11h12l2-11" fill="#738c91"/><rect x="23" y="22" width="18" height="20" rx="5" fill="url(#glass)"/><path d="M32 25v8l6 4" fill="none" stroke="#e7f0e9" stroke-width="2"/>',
 mouse:'<path d="M22 28V23a10 10 0 0 1 7-10" fill="none" stroke="#f2f4ed" stroke-width="2.5"/><rect x="30" y="18" width="4" height="8" rx="2" fill="#42525e"/>',
 microphone:'<path d="M27 13h10M27 18h10M27 23h10M27 28h10" stroke="#384c5a" stroke-width="1.8"/><path d="M27 11v22" stroke="#dbe4df"/>',
 console:'<path d="M30 10l-3 44h8l3-44" fill="#263b4f" stroke="none"/><path d="M39 14l-2 35" stroke="#a3c6da" stroke-width="2"/>',
 gamepad:'<path d="M18 26v12M12 32h12" stroke="#344550" stroke-width="4"/><circle cx="43" cy="28" r="2.4" fill="#759b91"/><circle cx="49" cy="34" r="2.4" fill="#b8928d"/><circle cx="25" cy="38" r="3" fill="#485d6c"/><circle cx="38" cy="38" r="3" fill="#485d6c"/>',
 radio:'<circle cx="24" cy="38" r="7" fill="#546b70"/><path d="M18 34h12M18 38h12M18 42h12" stroke="#aebcba"/><rect x="37" y="29" width="13" height="10" rx="1" fill="#e3ddbb"/>',
 webcam:'<circle cx="32" cy="25" r="7" fill="url(#glass)"/><circle cx="30" cy="23" r="2" fill="#d4e5e9" stroke="none"/><circle cx="46" cy="25" r="1.5" fill="#a6d0b8" stroke="none"/>',
 camcorder:'<path d="M41 30l15-8v26l-15-8" fill="#344a57"/><rect x="11" y="27" width="24" height="14" rx="2" fill="url(#glass)"/><path d="M9 24h29" stroke="#d5dcd9"/>',
 battery:'<rect x="22" y="32" width="20" height="21" rx="2" fill="#759b89" stroke="none"/><path d="M26 25h12M32 19v12" stroke="#e6efe8" stroke-width="2.5"/>',
 cpu:'<rect x="23" y="23" width="18" height="18" rx="1" fill="url(#metal)"/><path d="M28 27h8M28 31h5" stroke="#667e88"/>',
 floppy:'<path d="M20 9v17h23V9" fill="url(#metal)"/><path d="M21 55V36h23v19" fill="#efe9dc"/><path d="M25 41h15M25 45h15M25 49h10" stroke="#b3b5ab"/>',
 gpu:'<circle cx="25" cy="33" r="7" fill="#334650"/><circle cx="44" cy="33" r="5" fill="#334650"/><path d="M24 27l3 12M19 34l12-2M42 29l4 8M40 34l8-2" stroke="#a8bbc0" stroke-width="2"/><path d="M17 46v6h26v-6" fill="#ccba83"/>',
 hdd:'<circle cx="31" cy="29" r="12" fill="url(#metal)"/><circle cx="31" cy="29" r="3" fill="#566f79"/><path d="M44 47L31 29" stroke="#d8e1df" stroke-width="4"/>',
 ram:'<path d="M7 20h50v25H7Z" fill="#789c89"/><path d="M12 45v7h16v-7m7 0v7h17v-7" fill="#d8c28a"/><path d="M13 26h8v12h-8ZM28 26h8v12h-8ZM43 26h8v12h-8Z" fill="#33454b"/>',
 monitor:'<rect x="10" y="15" width="44" height="23" rx="1" fill="url(#glass)" stroke="none"/><path d="M10 38c15-24 21 3 44-20v20Z" fill="#92b2c5" stroke="none"/><path d="M28 43h8" stroke="#b9c9c8"/>',
 motherboard:'<rect x="13" y="8" width="38" height="48" rx="2" fill="#738c7d"/><rect x="20" y="16" width="16" height="16" fill="url(#metal)"/><path d="M43 14v24M47 14v24M20 40h16M20 46h23M20 51h23" stroke="#cfbf8c" stroke-width="3"/><circle cx="44" cy="48" r="4" fill="#bdc5c0"/>',
 ssd:'<rect x="11" y="21" width="42" height="23" rx="2" fill="#688d88"/><rect x="17" y="26" width="10" height="12" fill="#364a51"/><rect x="33" y="26" width="10" height="12" fill="#364a51"/><path d="M54 27h5v12h-5" fill="#d1ba7d"/>',
 case:'<rect x="20" y="12" width="24" height="39" rx="1" fill="#415765"/><circle cx="32" cy="41" r="8" fill="#738e9c"/><circle cx="32" cy="41" r="4" fill="#263d50"/><path d="M23 16h18M23 21h18" stroke="#b6c3c4"/><circle cx="39" cy="28" r="1.5" fill="#a4cecb"/>',
 power:'<circle cx="27" cy="34" r="10" fill="#415866"/><circle cx="27" cy="34" r="4" fill="#aab9bc"/><path d="M27 26v16M19 34h16M21 28l12 12M21 40l12-12" stroke="#b5c4c7"/>',
 actioncam:'<circle cx="41" cy="30" r="8" fill="url(#glass)"/><circle cx="39" cy="27" r="2" fill="#cbdde1" stroke="none"/><rect x="15" y="25" width="12" height="15" rx="2" fill="#344c5a"/>',
 drone:'<path d="M25 26h14v13H25Z" fill="#899dab"/><circle cx="32" cy="44" r="3" fill="url(#glass)"/><path d="M4 15h18M42 15h18M4 49h18M42 49h18" stroke="#465f70" stroke-width="3"/>',
 gimbal:'<rect x="27" y="31" width="10" height="23" rx="3" fill="#596f7b"/><circle cx="34" cy="15" r="5" fill="url(#glass)"/><rect x="29" y="35" width="6" height="9" rx="1" fill="#9fb5bd"/>',
 tv:'<rect x="10" y="16" width="44" height="27" rx="1" fill="url(#glass)" stroke="none"/><path d="M10 42c12-29 22 1 44-18v19H10Z" fill="#91b4bb" stroke="none"/>',
 fridge:'<path d="M20 9h24v14H20Z" fill="#e5e4dc" stroke="none"/><path d="M23 14v6M23 32v12" stroke="#686e68" stroke-width="2.5"/><path d="M44 28v25" stroke="#f0f0e8" stroke-width="2"/>',
 rice:'<path d="M15 25a17 17 0 0 1 34 0Z" fill="#c3c4b7"/><path d="M24 10h16" stroke="#757f75" stroke-width="4"/><rect x="24" y="36" width="16" height="10" rx="2" fill="#526c63"/><circle cx="32" cy="41" r="2" fill="#cbd8bd" stroke="none"/>',
 microwave:'<rect x="12" y="22" width="31" height="21" rx="2" fill="url(#glass)"/><path d="M17 39l19-13" stroke="#93adb8" stroke-width="2"/><circle cx="51" cy="28" r="3" fill="#e6e7df"/>',
 hood:'<path d="M24 7h16v20l17 13H7l17-13Z" fill="url(#metal)"/><path d="M7 40h50v9H7Z" fill="#5e716e"/><path d="M17 45h1M23 45h1M29 45h1" stroke="#e1e5cb" stroke-width="2"/>',
 aircon:'<path d="M12 29h40v5H12Z" fill="#8d9e9a" stroke="none"/><path d="M46 20h6" stroke="#83947b" stroke-width="2"/><path d="M19 43v9M32 43v14M45 43v9" stroke="#8fbdc7" stroke-width="2"/>',
 dishwasher:'<path d="M13 21h38v35H13Z" fill="url(#metal)"/><path d="M20 29h24" stroke="#566e74" stroke-width="3"/><path d="M20 15h1M26 15h1M36 15h9" stroke="#546e69" stroke-width="2"/>',
 fan:'<circle cx="32" cy="25" r="17" fill="#d4ded8"/><path d="M32 21c-12-14 13-16 4 1M36 25c17-3 9 18-3 4M29 28c-4 16-18 0-2-4" fill="#6f9595" stroke="none"/><circle cx="32" cy="25" r="4" fill="#b8ccbf"/><circle cx="32" cy="25" r="19" fill="none" stroke="#708887" stroke-width="2"/>',
 waterheater:'<path d="M17 18h29" stroke="#f8f6e9" stroke-width="2"/><circle cx="41" cy="27" r="6" fill="#edf0e6"/><path d="M41 27l2-3" stroke="#7895a0" stroke-width="2"/><path d="M19 43v11M45 43v11" stroke="#a3b2b2" stroke-width="3"/>',
 oven:'<rect x="16" y="29" width="32" height="21" rx="2" fill="url(#glass)"/><path d="M22 33h20" stroke="#c4d2cf" stroke-width="2.5"/><path d="M17 16h1M25 16h1" stroke="#586f73" stroke-width="3"/>',
 pan:'<circle cx="27" cy="36" r="18" fill="url(#metal)"/><circle cx="27" cy="36" r="14" fill="#47595c"/><path d="M19 26a13 13 0 0 1 15 0" stroke="#8a9fa3" fill="none"/><path d="M43 22l12-11" stroke="#485b61" stroke-width="6"/>',
 stove:'<circle cx="21" cy="32" r="9" fill="#3d5057"/><circle cx="44" cy="32" r="9" fill="#3d5057"/><circle cx="21" cy="32" r="4" fill="#98a8a7"/><circle cx="44" cy="32" r="4" fill="#98a8a7"/><path d="M21 19v6M21 39v6M8 32h6M28 32h6M44 19v6M44 39v6M37 32h-6M51 32h6" stroke="#50666c" stroke-width="3"/>',
 sofa:'<path d="M13 29V20a7 7 0 0 1 7-7h24a7 7 0 0 1 7 7v9" fill="#899e94"/><path d="M8 28h7v12h34V28h7v22H8Z" fill="url(#body)"/><path d="M17 36h30M32 16v20" stroke="#667c70"/>',
 lamp:'<path d="M22 9h20l10 23H12Z" fill="#e5d5ad"/><path d="M20 55h24" stroke="#647772" stroke-width="4"/><path d="M25 11l-8 18" stroke="#f8ead0" stroke-width="2"/>',
 printer:'<path d="M18 23V8h28v15" fill="#f1eee4"/><path d="M18 46H9V24h46v22h-9" fill="url(#body)"/><path d="M18 36h28v21H18Z" fill="#f1eee4"/><path d="M24 42h16M24 49h16" stroke="#b4c1bf"/><circle cx="47" cy="29" r="1.5" fill="#6f9f8c"/>',
 bike:'<circle cx="15" cy="43" r="10" fill="#e8eee9"/><circle cx="50" cy="43" r="10" fill="#e8eee9"/><path d="m15 43 13-21 11 21H15M28 22h16l6 21M39 43l8-29" fill="none" stroke="#658f9a" stroke-width="3"/><path d="M23 17h10M47 14h7" stroke="#40515b" stroke-width="3"/>',
 car:'<path d="M18 28l5-10h18l5 10Z" fill="url(#glass)"/><path d="M8 40h48v10H8Z" fill="#73949d"/><path d="M14 35h7M43 35h7" stroke="#eef1de" stroke-width="3"/>',
 ball:'<circle cx="32" cy="32" r="24" fill="url(#body)"/><path d="M8 32h48M32 8v48M15 15c22 9 12 23 34 34M49 15c-22 9-12 23-34 34" stroke="#85664f" fill="none"/><path d="M18 19a19 19 0 0 1 17-6" stroke="#f0d3b4" stroke-width="2" fill="none"/>',
 dumbbell:'<path d="M24 27h16v10H24Z" fill="url(#metal)"/><path d="M15 17h9v30h-9ZM40 17h9v30h-9ZM8 24h7v16H8ZM49 24h7v16h-7Z" fill="#657783"/><path d="M18 20v24M43 20v24" stroke="#a5b8bd" stroke-width="2"/>'
};
for (const m of catalog) {
 if(!m.id.startsWith('icon-')){m.style='icon';m.hidden=m.id!=='coffee';continue;}
 const key=m.id.slice(5);const colors=palettes[m.category]??palettes.数码;
 if(originals[key]){m.art=objectArt(originals[key]);continue;}
 let body=m.shape.replace(/<(rect|circle|ellipse)(\s)/g,'<$1 fill="url(#body)"$2').replace(/<path d="([^"]*)"\/>/g,(_,d)=>`<path d="${d}" fill="${/z/i.test(d)?'url(#body)':'none'}"/>`);
 m.art=frame((key==='box'?'':body)+(extras[key]??''),colors);
}
const dimensional=[
 ['plant','小盆栽','家居','绿植 多肉 植物', '<ellipse cx="32" cy="51" rx="16" ry="6" fill="#b9a795" stroke="none"/><path d="M16 49l5 14c6 4 16 4 22 0l5-14" fill="url(#body)"/><ellipse cx="32" cy="49" rx="16" ry="6" fill="#80766a"/><path d="M31 46C8 41 12 20 31 36C17 8 36 4 36 31C48 9 62 24 38 42C58 31 59 50 34 48Z" fill="#7c9f8c" stroke="#668975"/><path d="M32 48l2-22" fill="none" stroke="#bad0b2" stroke-width="2"/>'],
 ['suitcase','旅行箱','交通','行李 旅行 拉杆箱', '<path d="M23 14V5h17v9" fill="none" stroke="#6c8390" stroke-width="3"/><path d="M15 20l8-6h29v43l-8 7H15Z" fill="#516f83"/><rect x="12" y="20" width="32" height="42" rx="6" fill="url(#body)"/><path d="M19 28v24M26 28v24M34 28v24" stroke="#d7e0df" stroke-width="2"/><circle cx="19" cy="64" r="3" fill="#455a68"/><circle cx="39" cy="64" r="3" fill="#455a68"/>'],
 ['tent','露营帐篷','运动','户外 露营 帐篷', '<path d="M7 55l25-43 26 40-26 10Z" fill="#799a92"/><path d="M7 55l25-43v50Z" fill="#b6c9b5"/><path d="M17 56l15-30v36Z" fill="#455e5c"/><path d="M32 12l26 40-26 10" fill="none" stroke="#e0dfc2" stroke-width="1.5"/><path d="M32 12l-4-7M7 55l-3 6M58 52l4 8" stroke="#7a8984" stroke-width="1.5"/>'],
 ['books','阅读书籍','办公','书本 阅读 图书', '<path d="M10 45l27-11 23 10-27 12Z" fill="#a8b7bd"/><path d="M10 45v8l23 11v-8Z" fill="#607f8e"/><path d="M33 56l27-12v8L33 64Z" fill="#eee9d9"/><path d="M8 30l28-12 22 10-28 12Z" fill="#b8c4a8"/><path d="M8 30v10l22 10V40Z" fill="#7f957c"/><path d="M30 40l28-12v10L30 50Z" fill="#f0ecdd"/><path d="M17 24l24-10 16 7-24 10Z" fill="#c8ac9b"/><path d="M17 24v6l16 7v-6Z" fill="#ac8877"/><path d="M33 31l24-10v6L33 37Z" fill="#f5ead9"/>']
];
for (const [key,name,category,keywords,body] of dimensional) catalog.push({id:'object3d-'+key,name,style:'dimensional',category,keywords,art:frame(body,palettes[category])});
await writeFile(path,JSON.stringify(catalog,null,2)+'\n');
console.log(`Designed ${catalog.length} original materials, including ${dimensional.length} distinct 3D subjects.`);
