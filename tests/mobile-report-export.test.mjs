import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';

// Native PDF rendering is iOS-only; Android shows no entry, while every older
// capability payload without the field keeps today's button.
const model = {
  copyText: () => '摘要',
  printableHtml: () => '<html></html>',
  exportFileName: () => '物谱报告.pdf',
  parseReportInput: input => ({ ok: true, report: input }),
};
const element = type => ({ children, ...props }) => ({ type, props: { children, ...props } });
const ui = {
  Button: element('button'),
  Card: element('div'),
  FormRow: element('div'),
  NavBar: element('div'),
  Notice: element('div'),
  ErrorState: element('div'),
  Switch: () => null,
};

function mount(available) {
  return runtime('mobile/plan/Report', { sources: {}, caps: {}, onClose: () => {} }, undefined, undefined, {
    exportName: 'default',
    modules: {
      './mobile/me/files': { shareReport: async () => '已生成', pdfExportAvailable: async () => available },
      './planning-report/current-adapter': { currentReportInput: () => ({}) },
      './planning-report/model': model,
      './mobile/ui': ui,
      './i18n': { t: text => text },
    },
  });
}

test('an explicit pdf_export false hides the report export but keeps the summary', async () => {
  const report = mount(false);
  await report.settle();
  assert.ok(report.button('复制摘要'));
  assert.equal(report.button('导出当前报告'), undefined);
});

test('a missing pdf_export field keeps the report export button', async () => {
  const report = mount(true);
  await report.settle();
  assert.ok(report.button('复制摘要'));
  assert.ok(report.button('导出当前报告'));
});

test('the capability probe hides only explicit false and retries a failed bridge', async t => {
  const originalWindow = globalThis.window, originalTauri = globalThis.isTauri;
  t.after(() => { globalThis.window = originalWindow; globalThis.isTauri = originalTauri; });
  globalThis.isTauri = true;
  let sequence = 0;
  for (const [payload, expected] of [
    [{ native_file_sharing: true, pdf_export: false }, false],
    [{ native_file_sharing: true, pdf_export: true }, true],
    [{ native_file_sharing: true }, true],
  ]) {
    globalThis.window = { __TAURI_INTERNALS__: { invoke: async cmd => {
      assert.equal(cmd, 'platform_capabilities');
      return payload;
    } } };
    const files = await import(`../src/mobile/me/files.ts?capability-${sequence++}`);
    assert.equal(await files.pdfExportAvailable(), expected);
  }
  let calls = 0;
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async () => {
    if (++calls === 1) throw new Error('bridge unavailable');
    return { native_file_sharing: true, pdf_export: false };
  } } };
  const files = await import('../src/mobile/me/files.ts?retry');
  await assert.rejects(files.pdfExportAvailable(), /bridge unavailable/);
  assert.equal(await files.pdfExportAvailable(), false);
  assert.equal(calls, 2);
});

test('a cancelled private export asks to export again without promising a reshare entry', async t => {
  const originalWindow = globalThis.window, originalTauri = globalThis.isTauri;
  t.after(() => { globalThis.window = originalWindow; globalThis.isTauri = originalTauri; });
  globalThis.isTauri = true;
  for (const [capabilities, expected] of [
    [{ native_file_sharing: true, pdf_export: false }, '导出文件只保存在物谱内，尚未保存到其他位置；需要保存时请重新导出并在分享面板选择保存位置'],
    [{ native_file_sharing: true }, '已生成并保留「fiction.thingary」，可在“文件”App 的物谱目录找到。已取消分享，尚未保存到其他位置。'],
  ]) {
    let notice = '';
    const done = { name: 'fiction.thingary', folder: '/fiction', share: { completed: false, error: null } };
    globalThis.window = {
      alert: message => { notice = message; },
      __TAURI_INTERNALS__: { invoke: async command => command === 'create_backup' ? done : capabilities },
    };
    const files = await import(`../src/mobile/me/files.ts?notice-${capabilities.pdf_export}`);
    assert.deepEqual(await files.shareBackup(false, 'fiction-task'), done);
    assert.equal(notice, expected);
  }
});
