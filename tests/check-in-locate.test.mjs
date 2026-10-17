import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInUnfilledLabels, checkInUnfilledTargets, comparisonText, enterJumpsAmount, nextUnfilledLabel } from '../src/wealth.ts';

// I08／I09：定位未填的候选顺序、回绕，以及 Enter 与输入法组合的分工。

const field = (id, name, extra = {}) => ({ id, name, currency: 'CNY', holding_mode: false, ...extra });

test('the shared rate comes first, then each row in table order', () => {
  const fields = [
    field('bank', '日常银行卡'),
    field('broker', '券商美元', { currency: 'USD', holding_mode: true }),
  ];
  const labels = checkInUnfilledLabels(fields, { USD: '' }, {
    bank: { state: 'entered', cents: '10000' },
    broker: { state: null, cents: '' },
  });
  assert.deepEqual(labels, ['USD 汇率', '券商美元 份额', '券商美元 单价']);
});

test('a CNY row only counts its amount; zero is a filled fact, not a gap', () => {
  const fields = [field('bank', '日常银行卡'), field('card', '信用卡')];
  assert.deepEqual(
    checkInUnfilledLabels(fields, {}, { bank: { state: 'entered', cents: '0' }, card: { state: 'missing', cents: '' } }),
    ['信用卡 本次金额'],
    'an explicit zero stays filled; a missing row is located',
  );
});

test('an invalid but non-empty input stays on the locate path because its parsed value is empty', () => {
  const labels = checkInUnfilledLabels([field('bank', '日常银行卡')], {}, { bank: { state: 'entered', cents: '' } });
  assert.deepEqual(labels, ['日常银行卡 本次金额']);
});

test('a foreign row locates its original amount; a kept rate is not re-located', () => {
  const labels = checkInUnfilledLabels([field('us', '美元户', { currency: 'USD' })], { USD: '7200000' }, { us: { state: 'entered', cents: '', original_minor: '' } });
  assert.deepEqual(labels, ['美元户 原币金额']);
  assert.deepEqual(checkInUnfilledLabels([field('us', '美元户', { currency: 'USD' })], { USD: '7200000' }, { us: { state: 'entered', cents: '720', original_minor: '100' } }), []);
});

test('same-name accounts retain different locate identities and a zero FX rate is a gap', () => {
  const targets = checkInUnfilledTargets([field('a', '银行卡'), field('b', '银行卡')], {}, {});
  assert.deepEqual(targets.map(target => target.key), ['amount:a', 'amount:b']);
  assert.equal(targets[0].label, targets[1].label);
  assert.equal(nextUnfilledLabel(targets.map(target => target.key), 'amount:a'), 'amount:b');
  assert.deepEqual(checkInUnfilledTargets([field('usd', '美元', { currency: 'USD' })], { USD: '0' }, {
    usd: { state: 'entered', cents: '', original_minor: '100' },
  }).map(target => target.key), ['rate:USD']);
});

test('the locate action moves after the focus and wraps; nothing happens when filled', () => {
  const labels = ['A 汇率', 'B 份额', 'B 单价'];
  assert.equal(nextUnfilledLabel(labels, null), 'A 汇率');
  assert.equal(nextUnfilledLabel(labels, 'A 汇率'), 'B 份额');
  assert.equal(nextUnfilledLabel(labels, 'B 单价'), 'A 汇率', '末尾回到首处');
  assert.equal(nextUnfilledLabel(labels, '别的输入'), 'A 汇率');
  assert.equal(nextUnfilledLabel([], 'A 汇率'), null, '无缺项时不抢焦点');
});

test('Enter jumps only outside IME composition and never submits; Tab is untouched', () => {
  assert.equal(enterJumpsAmount('Enter', false, true), true);
  assert.equal(enterJumpsAmount('Enter', true, true), false, '组合期间的 Enter 保持原始行为');
  assert.equal(enterJumpsAmount('Tab', false, true), false);
  assert.equal(enterJumpsAmount('Enter', false, false), false, '非输入元素不处理');
});

test('a definite zero reads as 持平, distinct from unknown and from no baseline', () => {
  assert.equal(comparisonText('0', '2026-09-17'), '持平');
  assert.equal(comparisonText('1200000', '2026-09-17'), '+¥12,000');
  const decrease = comparisonText('-50000', '2026-09-17'); assert.ok(decrease.endsWith('¥500') && !decrease.startsWith('+'), decrease);
  assert.equal(comparisonText(null, '2026-09-17'), '—', '一端未知不是零');
  assert.equal(comparisonText('0', null), '—', '没有上期数据不说持平');
  assert.equal(comparisonText(null, null), '—');
});
