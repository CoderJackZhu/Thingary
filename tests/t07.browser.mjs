// Run only through an already-owned Ego Lite TaskSpace against this dev fixture.
import assert from 'node:assert/strict';
export async function runT07(page) {
  assert.match(await page.url(),/^http:\/\/127\.0\.0\.1:1429\/visual-preview\.html/);
  await page.goto('http://127.0.0.1:1429/visual-preview.html');
  await page.waitForSelector('button[aria-label="查看 Fujifilm X100V"]');await page.snapshot();
  await page.dblclick('button[aria-label="查看 Fujifilm X100V"]');
  await page.waitForSelector('text="标记退役"');await page.snapshot();
  await page.click('text="标记退役"');await page.snapshot();
  await page.fill('#lifecycle-date','2026-09-10');await page.fill('#lifecycle-notes','虚构浏览器状态备注');
  await page.evaluate(()=>{
    const raw=window.__TAURI_INTERNALS__.invoke;const fault=window.__t07={mode:'fail',writes:0};
    window.__TAURI_INTERNALS__.invoke=async(cmd,args,...rest)=>{
      if(cmd==='change_lifecycle') {fault.writes++;if(fault.mode==='fail') throw {message:'T07 before commit failure'};const r=await raw(cmd,args,...rest);if(fault.mode==='lost') throw {message:'T07 response lost'};return r;}
      if(cmd==='saved_request' && fault.mode==='lost') throw {message:'T07 receipt unavailable'};
      return raw(cmd,args,...rest);
    };
  });
  await page.click('text="保存状态"');
  await page.waitForFunction(()=>document.querySelector('.lifecycle-editor .notice')?.textContent.includes('before commit'));
  const failure=await page.evaluate(()=>({date:document.querySelector('#lifecycle-date').value,notes:document.querySelector('#lifecycle-notes').value,pending:JSON.parse(localStorage.getItem('possio.lifecycle-draft.v1')).pending}));
  assert.equal(failure.date,'2026-09-10');assert.equal(failure.notes,'虚构浏览器状态备注');assert.equal(failure.pending,null);
  await page.evaluate(()=>{window.__t07.mode='lost';});await page.snapshot();await page.click('text="保存状态"');
  await page.waitForSelector('text="核对状态保存结果"');await page.snapshot();
  const pending=await page.evaluate(()=>({disabled:document.querySelector('#lifecycle-date').disabled,id:JSON.parse(localStorage.getItem('possio.lifecycle-draft.v1')).pending.request_id,writes:window.__t07.writes}));
  assert.equal(pending.disabled,true);assert.equal(pending.writes,2);
  await page.click('text="核对状态保存结果"');
  await page.waitForFunction(()=>document.querySelector('.lifecycle-editor .notice')?.textContent.includes('原请求与输入已保留'));
  await page.evaluate(()=>{window.__t07.mode='normal';});await page.snapshot();await page.click('text="核对状态保存结果"');
  await page.waitForSelector('text="重新启用"');
  const receipt=await page.evaluate(()=>({writes:window.__t07.writes,pending:localStorage.getItem('possio.lifecycle-draft.v1'),events:document.querySelectorAll('.lifecycle-history li').length,status:document.querySelector('.asset-hero .pill').textContent}));
  assert.deepEqual(receipt,{writes:2,pending:null,events:1,status:'已退役'});
  await page.snapshot();await page.click('text="重新启用"');await page.snapshot();
  await page.fill('#lifecycle-date','2026-09-09');await page.click('text="保存状态"');
  await page.waitForFunction(()=>document.querySelector('.lifecycle-editor .notice')?.textContent.includes('不能早于'));
  await page.fill('#lifecycle-date','2026-09-10');await page.click('text="保存状态"');await page.waitForSelector('text="标记退役"');await page.snapshot({scope:'full_page'});
  await page.click('button[aria-label="更正退役日期 2026-09-10"]');await page.snapshot();
  await page.fill('#lifecycle-date','2026-09-11');await page.click('text="保存状态"');
  await page.waitForFunction(()=>document.querySelector('.lifecycle-editor .notice')?.textContent.includes('不能晚于'));
  await page.fill('#lifecycle-date','2026-09-05');await page.click('text="保存状态"');await page.waitForSelector('button[aria-label="更正退役日期 2026-09-05"]');
  const final=await page.evaluate(()=>({state:document.querySelector('.asset-hero .pill').textContent,events:[...document.querySelectorAll('.lifecycle-history li')].map(e=>e.textContent),cost:document.querySelector('.holding-cost').textContent,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.equal(final.state,'使用中');assert.equal(final.events.length,2);assert.ok(final.events[0].includes('2026-09-05'));assert.ok(final.events[1].includes('2026-09-10'));assert.equal(final.overflow,false);
  return {failure,pending,receipt,final};
}
