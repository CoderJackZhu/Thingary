import test from 'node:test';
import assert from 'node:assert/strict';
import { NONE, NOT_SET, UNKNOWN, dateText, dayLabel, monthLabel, moneyText, optionalText, signedMoneyText, unitMoneyText } from '../src/mobile/format.ts';

const today = '2026-10-22';

test('列表日期是「10月21日」，非今年带年份，从不出现「10-21」', () => {
  assert.equal(dayLabel('2026-10-21', today), '10月21日');
  assert.equal(dayLabel('2026-01-05', today), '1月5日');
  assert.equal(dayLabel('2025-10-21', today), '2025年10月21日');
  assert.equal(dayLabel('2027-02-03', today), '2027年2月3日');
  assert.doesNotMatch(dayLabel('2026-10-21', today), /\d-\d/);
});
test('未知日期显示「未知」，不是日期的文本原样返回', () => {
  assert.equal(dayLabel(null, today), UNKNOWN);
  assert.equal(dayLabel('', today), UNKNOWN);
  assert.equal(dayLabel(undefined, today), UNKNOWN);
  assert.equal(dayLabel('下个月', today), '下个月');
});
test('表单与详情字段日期保持 YYYY-MM-DD', () => {
  assert.equal(dateText('2026-10-21'), '2026-10-21');
  assert.equal(dateText(null), '未知');
  assert.equal(dateText(''), '未知');
});
test('月份标题', () => {
  assert.equal(monthLabel('2026-10', today), '10月');
  assert.equal(monthLabel('2025-03', today), '2025年3月');
  assert.equal(monthLabel('2025-03-09', today), '2025年3月');
});
test('金额到元，有分才显示两位，未知不是零，不缩写万', () => {
  assert.equal(moneyText('649000'), '¥6,490');
  assert.equal(moneyText('649050'), '¥6,490.50');
  assert.equal(moneyText('0'), '¥0');
  assert.equal(moneyText(null), '未知');
  assert.equal(moneyText('88840000'), '¥888,400');
  assert.equal(moneyText(123456789), '¥1,234,567.89');
  assert.doesNotMatch(moneyText('88840000'), /万/);
  assert.equal(unitMoneyText('1142'), '¥11.42');
  assert.equal(unitMoneyText('1100'), '¥11.00');
  assert.equal(unitMoneyText(null), '未知');
});
test('变化量带正负号', () => {
  assert.equal(signedMoneyText(120000), '+¥1,200');
  assert.equal(signedMoneyText('-30000'), '−⁠¥300');
  assert.equal(signedMoneyText(0), '¥0');
});
test('可选字段未设置，列表为空为暂无', () => {
  assert.equal(optionalText(''), NOT_SET);
  assert.equal(optionalText('  '), '未设置');
  assert.equal(optionalText(null), '未设置');
  assert.equal(optionalText('索尼'), '索尼');
  assert.equal(NONE, '暂无');
});
test('电脑端句子里的日期改成列表写法，其余文字不变', async () => {
  const { localizeDates } = await import('../src/mobile/format.ts');
  assert.equal(localizeDates('已于 2026-10-01 结束', today), '已于 10月1日 结束');
  assert.equal(localizeDates('进行中，至 2027-03-04', today), '进行中，至 2027年3月4日');
  assert.equal(localizeDates('持续续费', today), '持续续费');
});
