import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceText, diagnosticText, feedbackBody, iosVersion } from '../src/mobile/me/feedback.ts';
import { feedbackEmail, supportUrls } from '../src/support.ts';

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
test('反馈邮件：固定收件人与主题，经后端白名单打开', () => {
  const url = new URL(supportUrls.mail.replace('mailto:', 'mailto://x/'));
  assert.ok(supportUrls.mail.startsWith(`mailto:${feedbackEmail}?subject=`));
  assert.equal(feedbackEmail, 'feedback@jackzhu.top');
  assert.equal(url.searchParams.get('subject'), '物谱反馈');
});

test('邮件模板带可填写的问题与步骤、一次诊断信息，不读取资料或剪贴板', () => {
  const body = feedbackBody({ version: '0.1.0', userAgent: ua });
  assert.match(body, /^问题或建议：\r\n\r\n操作步骤（可选）：\r\n\r\n---\r\n/);
  assert.equal(body.split('物谱版本：').length, 2);
  assert.match(body, /物谱版本：0.1.0\niOS 版本：17.4.1\n设备：iPhone$/);
});
