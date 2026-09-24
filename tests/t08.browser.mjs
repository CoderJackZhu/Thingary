// Existing Ego TaskSpace, dev memory IPC only. Stops before final revoke confirmation.
import assert from 'node:assert/strict';
export async function runT08(page) {
 await page.goto('http://127.0.0.1:1429/visual-preview.html');
 await page.waitForSelector('button[aria-label="查看 机械键盘 K2"]');await page.snapshot();
 await page.dblclick('button[aria-label="查看 机械键盘 K2"]');await page.waitForSelector('button:text-is("标记售出")');await page.snapshot();await page.click('button:text-is("标记售出")');await page.snapshot();
 await page.click('button:text-is("保存售出记录")');await page.waitForFunction(()=>document.querySelector('.sale-editor .notice')?.textContent.includes('请填写实际售价'));
 await page.fill('#sale-date','2026-09-15');await page.fill('#sale-price','300');
 await page.click('button[aria-label="关闭售出表单"]');await page.waitForSelector('button:text-is("继续编辑")');await page.snapshot();await page.click('button:text-is("继续编辑")');
 await page.evaluate(()=>{const raw=window.__TAURI_INTERNALS__.invoke;const f=window.__t08={mode:'fail',writes:0};window.__TAURI_INTERNALS__.invoke=async(c,a,...rest)=>{if(c==='change_sale'){f.writes++;if(f.mode==='fail')throw {message:'T08 before commit failure'};const r=await raw(c,a,...rest);if(f.mode==='lost')throw {message:'T08 response lost'};return r;}if(c==='saved_request'&&f.mode==='lost')throw {message:'T08 receipt unavailable'};return raw(c,a,...rest);};});
 await page.click('button:text-is("保存售出记录")');await page.waitForFunction(()=>document.querySelector('.sale-editor .notice')?.textContent.includes('before commit'));
 const failure=await page.evaluate(()=>({price:document.querySelector('#sale-price').value,pending:JSON.parse(localStorage.getItem('possio.sale-draft.v1')).pending}));assert.deepEqual(failure,{price:'300',pending:null});
 await page.evaluate(()=>{window.__t08.mode='lost';});await page.snapshot();await page.click('button:text-is("保存售出记录")');await page.waitForSelector('button:text-is("核对售出保存结果")');await page.snapshot();
 const pending=await page.evaluate(()=>({disabled:document.querySelector('#sale-price').disabled,writes:window.__t08.writes,request:JSON.parse(localStorage.getItem('possio.sale-draft.v1')).pending.request_id}));assert.equal(pending.disabled,true);assert.equal(pending.writes,2);
 await page.click('button:text-is("核对售出保存结果")');await page.waitForFunction(()=>document.querySelector('.sale-editor .notice')?.textContent.includes('原请求与输入已保留'));
 await page.evaluate(()=>{window.__t08.mode='normal';});await page.snapshot();await page.click('button:text-is("核对售出保存结果")');await page.waitForSelector('button:text-is("修改售出记录")');await page.snapshot({scope:'full_page'});
 const receipt=await page.evaluate(()=>({writes:window.__t08.writes,draft:localStorage.getItem('possio.sale-draft.v1'),state:document.querySelector('.asset-hero .pill').textContent}));assert.deepEqual(receipt,{writes:2,draft:null,state:'已售出'});
 await page.click('button:text-is("修改售出记录")');await page.snapshot();const old=await page.evaluate(()=>JSON.parse(localStorage.getItem('possio.sale-draft.v1')).record.sale.id);await page.fill('#sale-price','400');await page.click('button:text-is("保存售出记录")');await page.waitForSelector('button:text-is("撤销误记售出…")');await page.snapshot({scope:'full_page'});await page.click('button:text-is("撤销误记售出…")');await page.snapshot();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('possio.sale-draft.v1')).record.sale.id),old);
 return {failure,pending,receipt,sameSaleId:old,revoke:'awaiting immediate confirmation'};
}
