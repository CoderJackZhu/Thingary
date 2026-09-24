// Run through Ego Lite in an already-owned TaskSpace; never target a native library.
// const { runT06c } = await import("file:///absolute/path/tests/t06c.browser.mjs");
// console.log(await runT06c(task.page("p1")));
import assert from 'node:assert/strict';

export async function runT06c(page) {
  assert.match(await page.url(), /^http:\/\/127\.0\.0\.1:1429\/visual-preview\.html/);
  await page.goto('http://127.0.0.1:1429/visual-preview.html?theme=light');
  await page.waitForSelector('button[aria-label="仅看分类 摄影"]');
  await page.snapshot();
  await page.click('loc=role:button[name="设置"]');
  await page.snapshot();
  await page.click('[aria-label="摄影 的操作"] button:text-is("改名")');
  await page.snapshot();
  await page.fill('input[aria-label="摄影 的新名称"]', 'T06c 保留的名称草稿');
  await page.evaluate(() => {
    const raw = window.__TAURI_INTERNALS__.invoke;
    const fault = window.__t06c = { mode: 'lost', calls: [] };
    window.__TAURI_INTERNALS__.invoke = async (cmd, args, ...rest) => {
      fault.calls.push(cmd);
      if (cmd === 'change_taxonomy' && fault.mode === 'lost') {
        await raw(cmd, args, ...rest);
        throw { message: 'T06c: committed response lost' };
      }
      if (cmd === 'taxonomy_request' && fault.mode === 'lost') throw { message: 'T06c: receipt unavailable' };
      if (cmd === 'change_taxonomy' && fault.mode === 'fail') throw { message: 'T06c: not committed' };
      return raw(cmd, args, ...rest);
    };
  });
  await page.click('button[aria-label="摄影，选择图标 音频"]');
  await page.waitForSelector('.taxonomy-locked');
  const pending = await page.evaluate(() => localStorage.getItem('possio.taxonomy-request.v1'));
  assert.ok(pending);
  await page.snapshot();
  await page.click('loc=role:button[name="重新加载并核对"]');
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '重新加载并核对')?.disabled);
  assert.deepEqual(await page.evaluate(() => ({
    pending: localStorage.getItem('possio.taxonomy-request.v1'),
    locked: !!document.querySelector('.taxonomy-locked'),
    disabled: document.querySelector('input[aria-label="摄影 的新名称"]').disabled,
  })), { pending, locked: true, disabled: true });
  await page.evaluate(() => { window.__t06c.mode = 'normal'; });
  await page.click('loc=role:button[name="重新加载并核对"]');
  await page.waitForFunction(() => !document.querySelector('.taxonomy-locked'));
  const recovered = await page.evaluate(() => ({
    icon: document.querySelector('[aria-label="摄影图标"] [aria-checked="true"]')?.getAttribute('aria-label'),
    draft: document.querySelector('input[aria-label="摄影 的新名称"]').value,
    error: document.querySelector('.taxonomy-edit-row .taxonomy-help')?.textContent,
    pending: localStorage.getItem('possio.taxonomy-request.v1'),
    writes: window.__t06c.calls.filter(c => c === 'change_taxonomy').length,
  }));
  assert.deepEqual(recovered, { icon: '摄影，选择图标 音频', draft: 'T06c 保留的名称草稿', error: '按 Enter 保存，Esc 取消', pending: null, writes: 1 });
  await page.evaluate(() => { window.__t06c.mode = 'fail'; });
  await page.click('button[aria-label="摄影，选择图标 家电"]');
  await page.waitForFunction(() => document.querySelector('.taxonomy-edit-row .taxonomy-help')?.textContent.includes('not committed'));
  assert.equal(await page.evaluate(() => document.querySelector('[aria-label="摄影图标"] [aria-checked="true"]')?.getAttribute('aria-label')), '摄影，选择图标 音频');
  await page.evaluate(() => { window.__t06c.mode = 'normal'; });
  await page.click('button[aria-label="摄影，选择图标 家电"]');
  await page.waitForFunction(() => document.querySelector('[aria-label="摄影，选择图标 家电"]')?.getAttribute('aria-checked') === 'true');
  assert.equal(await page.evaluate(() => document.querySelector('.taxonomy-edit-row .taxonomy-help')?.textContent), '按 Enter 保存，Esc 取消');
  await page.snapshot();
  await page.click('.taxonomy-edit-row button:text-is("保存")');
  await page.waitForSelector('[aria-label="T06c 保留的名称草稿 的操作"]');
  await page.click('button[aria-label="移除 T06c 保留的名称草稿"]');
  await page.waitForSelector('dialog.taxonomy-confirm[open]');
  const removal = await page.evaluate(() => ({ selected: document.querySelectorAll('dialog.taxonomy-confirm input:checked').length, disabled: [...document.querySelectorAll('dialog.taxonomy-confirm button')].find(b => b.textContent === '迁移并移除')?.disabled }));
  assert.deepEqual(removal, { selected: 0, disabled: true });
  await page.snapshot();
  await page.click('dialog.taxonomy-confirm button:text-is("取消")');
  await page.click('loc=role:button[name="我的物品"]');
  await page.click('button[aria-label="仅看分类 T06c 保留的名称草稿"]');
  await page.waitForSelector('button[aria-label="查看 Fujifilm X100V"]');
  await page.click('button[aria-label="查看 Fujifilm X100V"]');
  await page.snapshot();
  await page.click('loc=role:button[name="打开完整档案"]');
  await page.waitForSelector('#detail-heading');
  const layout = await page.evaluate(() => ({ horizontalOverflow: document.documentElement.scrollWidth > innerWidth, heading: document.querySelector('#detail-heading').textContent }));
  assert.equal(layout.horizontalOverflow, false);
  await page.snapshot();
  await page.click('button[aria-label="预览 虚构物品示意图"]');
  await page.waitForFunction(() => { const img = document.querySelector('dialog.photo-preview img'); return img?.complete && img.naturalWidth > 0; });
  const photoLayout = await page.evaluate(() => ({
    height: document.querySelector('dialog.photo-preview img').getBoundingClientRect().height,
    expectedHeight: Math.min(innerHeight * 0.6, 640),
    thumbnailHeight: document.querySelector('.photo-tile img').getBoundingClientRect().height,
  }));
  assert.ok(Math.abs(photoLayout.height - photoLayout.expectedHeight) < 1);
  assert.equal(photoLayout.thumbnailHeight, 105);
  await page.snapshot();
  await page.click('loc=role:button[name="关闭预览"]');
  return { recovered, removal, layout, photoLayout, passed: ['lost response and failed reconciliation stay locked', 'successful reconciliation retains draft, updates icon and clears error without replay', 'uncommitted failure keeps icon and retry clears error', 'migration requires explicit choice', 'renamed category filters same asset', 'photo preview uses viewport height while thumbnail stays compact'] };
}
