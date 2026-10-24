import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Fresh processes exercise the actual selected locale, without the Chinese-only
// source-reading test preloader or a second, partially cached copy of i18n.
function display(lang) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.localStorage = { getItem: () => ${JSON.stringify(lang)} };
    const { compactYuan } = await import('./src/plan-view.ts');
    const { axisLabel } = await import('./src/mobile/ui/chart-model.ts');
    const f = await import('./src/mobile/format.ts');
    const { t } = await import('./src/i18n.ts');
    const { calendarMonthLabel } = await import('./src/format-date.ts');
    const { goalProgressChange } = await import('./src/goal-progress.ts');
    const { monthSpendingText } = await import('./src/mobile/me/model.ts');
    const { conditionSummary } = await import('./src/mobile/plan/goal-model.ts');
    const { attention } = await import('./src/review.ts');
    const ok = value => ({status:'ready',value});
    const point = (need, funds) => ({date:'2026-09-24',point:{required_monthly_cents:need,available_cents:funds}});
    const amounts = [0, 99, 123400, 999999, 1000000, 10000000, 401000000, -391000000, 12300000000];
    const today = '2026-10-24';
    console.log(JSON.stringify({
      cards: amounts.map(compactYuan), axes: amounts.map(axisLabel),
      dates: [null, '', '2026-01-05', '2025-12-25', '2027-02-03', 'invalid'].map(d => f.dayLabel(d, today)),
      months: ['2026-10', '2025-03', '2025-03-09', 'invalid'].map(d => f.monthLabel(d, today)),
      sentence: f.localizeDates('A 2025-12-25 / B 2026-01-05', today),
      fields: [f.dateText('2025-12-25'), f.dateText(null)],
      calendar: calendarMonthLabel('2025-12'),
      headings: [t('{v1} 年 {v2} 月',{v1:2046,v2:1}), t('希望 {retirementText} 退休',{retirementText:'2046-01'})],
      benefits: ['expired','expiring'].map(status => attention({wealth:ok({points:[]}),recurring:ok({due:[],upcoming:[]}),virtual_assets:ok({items:[{id:'test',fields:{name:'Example'},status,valid_until:'2026-11-01'}]})})[0].details[0]),
      progress: [goalProgressChange(point('500000','100000'), point('400000','200000'), f.moneyText), goalProgressChange(point('400000','200000'), point('500000','100000'), f.moneyText)],
      timeline: ['2026-10','2026-09'].map(key => monthSpendingText({key,spendingCents:'10000',unknownCount:0}, '2026-10')),
      conditions: [conditionSummary({profile:{retire:{spend_cents:'400000',basic:{contribution:{monthly_cents:'500000'}}}}}, {funds:{status:'ready',value:{available_cents:'10000000'}}}), conditionSummary({profile:{retire:{spend_cents:null}}}, {funds:{status:'blocked'}})],
      extra: [t('3 月'), t('{label} · {length} 项', {label:'All',length:4}), t('{length} 条',{length:1}), t('{length} 笔',{length:1}), t('{unknownPriceCount} 件价格未知，未计入',{unknownPriceCount:1}), t('缺 {missing} 个账户',{missing:1}), t('{subscriptions} 项 · 月均 {v2}',{subscriptions:1,v2:'¥120'})],
      money: [f.moneyText(null), f.moneyText('0'), f.moneyText('123456789'), f.unitMoneyText('1100'), f.forecastMoneyText(null)],
      labels: [t('金融净资产'), t('查看财富'), t('退休规划'), t('查看规划')],
      notices: [1, 2].flatMap(n => [
        t('缺 {v1} 个账户', {v1:n}),
        t('{v1} · 缺 {missing} 个账户', {v1:'date',missing:n}),
        t('保修 30 天内到期 {count} 件', {count:n}),
        t('虚拟资产 {length} 项权益到期或即将到期', {length:n}),
        t('购入金额 · {held_unknown_price_count} 件未知', {held_unknown_price_count:n})
      ])
    }));
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));
}

test('English formats full card amounts, compact chart ticks and calendar dates', () => {
  const en = display('en');
  assert.deepEqual(en.cards, ['¥0', '¥1', '¥1,234', '¥10,000', '¥10,000', '¥100,000', '¥4,010,000', '−¥3,910,000', '¥123,000,000']);
  assert.deepEqual(en.axes, ['0', '1', '1.2K', '10K', '10K', '100K', '4M', '−3.9M', '123M']);
  assert.deepEqual(en.dates, ['Unknown', 'Unknown', 'Jan 5', 'Dec 25, 2025', 'Feb 3, 2027', 'invalid']);
  assert.deepEqual(en.months, ['Oct', 'Mar 2025', 'Mar 2025', 'invalid']);
  assert.equal(en.sentence, 'A Dec 25, 2025 / B Jan 5');
  assert.deepEqual(en.fields, ['2025-12-25', 'Unknown']);
  assert.equal(en.calendar, 'Dec 2025');
  assert.deepEqual(en.headings, ['1/2046', 'Plan to retire in 2046-01']);
  assert.deepEqual(en.benefits, ['Example · Benefits Expired · 2026-11-01', 'Example · Benefits Expiring Soon · 2026-11-01']);
  assert.deepEqual(en.progress, ['Compared with the last check-in (2026-09-24): Monthly savings needed decreased by ¥1,000, Available funds increased by ¥1,000.', 'Compared with the last check-in (2026-09-24): Monthly savings needed increased by ¥1,000, Available funds decreased by ¥1,000.']);
  assert.deepEqual(en.timeline, ['This Month spending ¥100', 'That month’s spending ¥100']);
  assert.deepEqual(en.conditions, ['Retirement budget ¥4,000/month · Available funds ¥100,000 · Save ¥5,000 per month', 'Retirement budget Unknown · Available funds Pending confirmation · Save Pending confirmation per month']);
  assert.deepEqual(en.extra, ['3 months', 'All · Items: 4', 'Entries: 1', 'Entries: 1', 'Unknown prices (excluded): 1', 'Accounts missing: 1', 'Subscriptions: 1 · monthly average ¥120']);
  assert.deepEqual(en.money, ['Unknown', '¥0', '¥1,234,567.89', '¥11.00', 'Unknown']);
  assert.deepEqual(en.labels, ['Financial Net Worth', 'View Wealth', 'Retirement Planning', 'View Planning']);
  assert.deepEqual(en.notices, [1, 2].flatMap(n => [`Accounts missing: ${n}`, `date · Accounts missing: ${n}`, `Warranty expiring within 30 days: ${n}`, `Virtual assets expired or expiring soon: ${n}`, `Purchase amount · Unknown prices: ${n}`]));
});

test('Chinese card, chart, date, unknown and notice output is fixed verbatim', () => {
  const zh = display('zh-CN');
  assert.deepEqual(zh.cards, ['¥0', '¥1', '¥1,234', '¥10,000', '¥1万', '¥10万', '¥401万', '−¥391万', '¥1.2亿']);
  assert.deepEqual(zh.axes, ['0', '1', '1234', '10000', '1万', '10万', '401万', '−391万', '1.2亿']);
  assert.deepEqual(zh.dates, ['未知', '未知', '1月5日', '2025年12月25日', '2027年2月3日', 'invalid']);
  assert.deepEqual(zh.months, ['10月', '2025年3月', '2025年3月', 'invalid']);
  assert.equal(zh.sentence, 'A 2025年12月25日 / B 1月5日');
  assert.deepEqual(zh.fields, ['2025-12-25', '未知']);
  assert.equal(zh.calendar, '2025 年 12 月');
  assert.deepEqual(zh.headings, ['2046 年 1 月', '希望 2046-01 退休']);
  assert.deepEqual(zh.benefits, ['Example · 权益已到期 · 2026-11-01', 'Example · 权益即将到期 · 2026-11-01']);
  assert.deepEqual(zh.progress, ['较上次盘点（2026-09-24）：需要每月存少了 ¥1,000，可用资金增加 ¥1,000。', '较上次盘点（2026-09-24）：需要每月存多了 ¥1,000，可用资金减少 ¥1,000。']);
  assert.deepEqual(zh.timeline, ['本月支出 ¥100', '当月支出 ¥100']);
  assert.deepEqual(zh.conditions, ['退休预算 ¥4,000/月 · 可用资金 ¥100,000 · 每月存 ¥5,000', '退休预算 未知 · 可用资金 待确认 · 每月存 待确认']);
  assert.deepEqual(zh.extra, ['3 月', 'All · 4 项', '1 条', '1 笔', '1 件价格未知，未计入', '缺 1 个账户', '1 项 · 月均 ¥120']);
  assert.deepEqual(zh.money, ['未知', '¥0', '¥1,234,567.89', '¥11.00', '未知']);
  assert.deepEqual(zh.labels, ['金融净资产', '查看财富', '退休规划', '查看规划']);
  assert.deepEqual(zh.notices, [1, 2].flatMap(n => [`缺 ${n} 个账户`, `date · 缺 ${n} 个账户`, `保修 30 天内到期 ${n} 件`, `虚拟资产 ${n} 项权益到期或即将到期`, `购入金额 · ${n} 件未知`]));
});

test('card headers reserve space between title and link, and wrap without shrinking the link', () => {
  for (const [path, prefix] of [['../src/mobile/ui/ui.css', 'm-hero'], ['../src/mobile/home/home.css', 'h-plan']]) {
    const css = readFileSync(new URL(path, import.meta.url), 'utf8');
    const top = css.match(new RegExp(`\\.${prefix}-top\\{([^}]+)\\}`))?.[1];
    const action = css.match(new RegExp(`\\.${prefix}-action\\{([^}]+)\\}`))?.[1];
    assert.match(top, /gap:8px 12px/);
    assert.match(top, /flex-wrap:wrap/);
    assert.match(action, /flex-shrink:0/);
  }
});
