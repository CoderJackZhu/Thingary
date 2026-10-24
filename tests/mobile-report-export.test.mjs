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
