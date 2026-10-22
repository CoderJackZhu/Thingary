import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceText, diagnosticText, feedbackBody, feedbackMailto, iosVersion } from '../src/mobile/me/feedback.ts';
import { feedbackEmail, feedbackSubject } from '../src/support.ts';

const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
test('iOS 版本取自 user agent，缺失时为未知', () => {
  assert.equal(iosVersion(ua), '17.4.1');
  assert.equal(iosVersion('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), '18.0');
  assert.equal(iosVersion('Mozilla/5.0 (X11; Linux)'), null);
});
test('诊断信息只有版本、系统和设备，不含资料', () => {
  const text = diagnosticText({ version: '0.0.7', userAgent: ua, screen: { width: 390, height: 844, ratio: 3 } });
  assert.equal(text, '物谱版本：0.0.7\niOS 版本：17.4.1\n设备：iPhone（屏幕 390×844 @3x）');
  assert.match(diagnosticText({ version: null, userAgent: '' }), /物谱版本：未知\niOS 版本：未知\n设备：未知设备/);
  assert.equal(deviceText({ userAgent: ua }), 'iPhone');
});
test('反馈邮件：固定收件人与主题，正文含模板和诊断信息', () => {
  const diag = diagnosticText({ version: '0.0.7', userAgent: ua });
  const url = new URL(feedbackMailto(diag).replace('mailto:', 'mailto://x/'));
  assert.ok(feedbackMailto(diag).startsWith(`mailto:${feedbackEmail}?subject=`));
  assert.equal(feedbackEmail, 'feedback@jackzhu.top');
  assert.equal(url.searchParams.get('subject'), feedbackSubject);
  const body = url.searchParams.get('body');
  assert.equal(body, feedbackBody(diag));
  assert.match(body, /问题描述：[\s\S]*操作步骤：[\s\S]*物谱版本：0\.0\.7/);
});
