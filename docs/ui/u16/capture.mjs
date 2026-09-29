// Run after starting Vite on 1429: ego-browser nodejs < docs/ui/u16/capture.mjs
const task=await taskSpace('Possio U16 screenshot comparison'),app=task.page('p1'),mock=await task.newPage();
console.log({taskSpaceId:task.spaceId});
await mock.goto('http://127.0.0.1:1429/docs/ui/u16/mockup-v3.html');
const fs=await import('node:fs/promises');
const base=process.cwd()+'/docs/ui/u16/capture';
await fs.mkdir(base,{recursive:true});
const screens={spec:'overview',overview:'overview',items:'assets',detail:'assets',form:'assets',wish:'wishlist',accounts:'wealth',stock:'wealth',expenses:'expenses',recurring:'recurring',virtual:'virtual',timeline:'timeline',stats:'stats',trash:'trash',settings:'settings'};
const wanted=['native','paper','bento'].flatMap(style=>['light','dark'].flatMap(mode=>(style==='native'?Object.keys(screens):['spec','overview','items','detail','timeline','settings']).map(screen=>[screen,style,mode])));
let previous='';
for(const [screen,style,mode] of wanted){
 if(previous!==style+mode){
  await app.goto('http://127.0.0.1:1429/visual-preview.html?section=settings');
  await app.waitForSelector('.theme-card');console.log((await app.snapshot()).slice(-180));
  await app.click('.theme-card:has-text("'+({native:'清新原生',paper:'纸本档案',bento:'柔和卡片'}[style])+'")');
  await app.click('.appearance-mode button:has-text("'+(mode==='light'?'浅色':'深色')+'")');
  console.log((await app.snapshot()).slice(-180));previous=style+mode;
 }

 await app.goto('http://127.0.0.1:1429/visual-preview.html?section='+screens[screen]+(screen==='spec'?'&state=components':screen==='trash'?'&trash-fixture':''));
 await app.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false});
 await app.waitForSelector('.page-header');
 await app.evaluate(({style,mode})=>{document.documentElement.dataset.style=style;document.documentElement.dataset.mode=mode;document.getElementById('visual-preview-label').style.display='none';}, {style,mode});
 console.log((await app.snapshot()).slice(0,200));
 if(screen==='items'||screen==='detail'){
   await app.waitForSelector('button[aria-label="查看 Fujifilm X100V"]');
   if(screen==='detail')await app.press('button[aria-label="查看 Fujifilm X100V"]','Enter');
   else await app.click('button[aria-label="查看 Fujifilm X100V"]');
 }
 if(screen==='form'){await app.click('.topbar-actions button:has-text("新增物品")');await app.waitForSelector('dialog[open]');}
 if(screen==='wish'){await app.waitForSelector('button[aria-label="查看心愿：虚构心愿 · 实木书桌"]');await app.click('button[aria-label="查看心愿：虚构心愿 · 实木书桌"]');}
 if(screen==='stock'){await app.click('.topbar-actions button:has-text("开始盘点")');await app.waitForSelector('.check-in-table');}
 if(screen==='virtual'){await app.waitForSelector('.virtual-table tbody tr');await app.click('.virtual-table tbody tr >> nth=0');}
 await app.waitForFunction(()=>!document.querySelector('.loading') && ![...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('正在读取')));
 await app.evaluate(()=>document.fonts.ready);
 await app.screenshot({path:`${base}/${screen}-${style}-${mode}-app.png`});
 await mock.evaluate(({screen,style,mode})=>{setScreen(screen);setTheme(style);setMode(mode);document.querySelector('#stage').style.setProperty('zoom','1','important');document.querySelector('.toolbar').style.display='none';document.querySelector('#note').style.display='none';if(!document.getElementById('capture-css')){const css=document.createElement('style');css.id='capture-css';css.textContent='body,.shell{margin:0!important;padding:0!important}.app{border-radius:0!important;box-shadow:none!important}';document.head.append(css)}}, {screen,style,mode});
 await mock.cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false});
 await mock.screenshot({path:`${base}/${screen}-${style}-${mode}-mockup.png`});
 console.log(JSON.stringify({screen,style,mode,layout:await app.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)}))}));
 console.log((await app.snapshot()).slice(-350));
}

await task.finish({keep:[]});
