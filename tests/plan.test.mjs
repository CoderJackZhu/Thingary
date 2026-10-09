import test from 'node:test';
import assert from 'node:assert/strict';
import { hpfSummary, incomeHpfTotals, savingViews, STALE_MONTHS, ageText, changeSentence, estimateAccountCents, latestHpf, computeReview, fundsFrom, hundredthsToPct, pctToHundredths, quitAges, rateText, staleMonths, yearBefore } from '../src/plan.ts';

// 与 src-tauri/src/plan_savings.rs 的单元测试使用同一组数值：预览不得和 Rust 口径漂移。
const point = (id, date, prev, change, extra = {}) => ({ snapshot_id: id, date, notes: '', assets_cents: '0', liabilities_cents: '0', net_cents: '0', complete: true, missing: 0, compared_to: prev, scope_changed: false, change_cents: change === null ? null : String(change), hpf_change_cents: null, change_rate_hundredths: null, ...extra });
const pay = (date, net, hpf = 0) => ({ id: date + net, revision: 1, fields: { date, net_cents: String(net), hpf_cents: String(hpf), notes: '' } });
const review = (points, incomes, marks = []) => computeReview(points, incomes, new Set(marks), 'g');

test('saving removes housing fund deposits; spending is what is left of income and deposits', () => {
  const r = review([point('a', '2026-01-31', null, null), point('b', '2026-03-31', '2026-01-31', 2_500_000, { hpf_change_cents: '600000' })], [pay('2026-02-15', 2_000_000, 300_000), pay('2026-03-15', 2_000_000, 300_000)]);
  const i = r.intervals[0];
  assert.equal(i.status, 'ok');
  assert.equal(i.days, 59);
  assert.equal(i.saving_cents, '1900000');
  assert.equal(i.spend_cents, '2100000');
  assert.equal(i.monthly_saving_cents, '980191');
  assert.equal(i.rate_hundredths, 4750);
  assert.equal(i.income_possibly_missing, true);
});

test('negative saving is kept and income on the start date belongs to the earlier interval', () => {
  const neg = review([point('a', '2026-01-01', null, null), point('b', '2026-02-01', '2026-01-01', -300_000)], [pay('2026-01-20', 100_000)]).intervals[0];
  assert.deepEqual([neg.saving_cents, neg.spend_cents, neg.rate_hundredths], ['-300000', '400000', -30000]);
  const edge = review([point('a', '2026-01-15', null, null), point('b', '2026-02-15', '2026-01-15', 0)], [pay('2026-01-15', 111), pay('2026-02-15', 222)]).intervals[0];
  assert.equal(edge.income_cents, '222');
});

test('intervals without income or with changed scope carry no figures', () => {
  const r = review([point('a', '2026-01-01', null, null), point('b', '2026-02-01', '2026-01-01', 10), point('c', '2026-03-01', '2026-02-01', null, { scope_changed: true })], []);
  assert.deepEqual(r.intervals.map(i => [i.status, i.saving_cents]), [['no_income', null], ['scope_changed', null]]);
  assert.equal(r.stats.count, 0);
  assert.equal(r.stats.median_monthly_saving_cents, null);
});

test('unequal gaps are normalised to months; rolling mean is weighted by length', () => {
  const gaps = review([point('a', '2026-01-01', null, null), point('b', '2026-02-01', '2026-01-01', 100_000), point('c', '2026-05-02', '2026-02-01', 300_000)], [pay('2026-01-20', 1), pay('2026-03-20', 1)]);
  assert.deepEqual(gaps.intervals.map(i => i.monthly_saving_cents), ['98185', '101458']);
  const points = [point('p0', '2026-01-01', null, null), point('p1', '2026-02-01', '2026-01-01', 100_000), point('p2', '2026-03-01', '2026-02-01', 300_000), point('p3', '2026-04-01', '2026-03-01', 200_000), point('p4', '2026-05-01', '2026-04-01', 9_000_000)];
  const incomes = ['01-15', '02-15', '03-15', '04-15'].map(d => pay('2026-' + d, 1_000_000));
  const r = review(points, incomes, ['p4']);
  assert.equal(r.stats.count, 3);
  assert.equal(r.stats.low_sample, false);
  assert.equal(r.stats.mean_monthly_saving_cents, '202917');
  assert.equal(r.intervals[3].excluded, true);
  assert.ok(r.intervals.every(i => !i.anomaly));
});

test('an interval far from the median is flagged only with enough samples', () => {
  const make = changes => {
    const points = [point('p0', '2026-01-01', null, null)], incomes = [];
    changes.forEach((c, n) => { points.push(point('p' + (n + 1), `2026-${String(n + 2).padStart(2, '0')}-01`, `2026-${String(n + 1).padStart(2, '0')}-01`, c)); incomes.push(pay(`2026-${String(n + 1).padStart(2, '0')}-15`, 1_000_000)); });
    return review(points, incomes).intervals;
  };
  const four = make([300_000, 310_000, 290_000, 4_000_000]);
  assert.deepEqual(four.map(i => i.anomaly), [false, false, false, true]);
  assert.ok(make([300_000, 4_000_000]).every(i => !i.anomaly));
});

test('old intervals leave the 12-month window, incomplete check-ins never end an interval', () => {
  const r = review([point('p0', '2024-01-01', null, null), point('p1', '2024-02-01', '2024-01-01', 100), point('p2', '2026-01-01', '2024-02-01', 200), point('p3', '2026-02-01', '2026-01-01', 300)], [pay('2024-01-15', 1), pay('2025-06-15', 1), pay('2026-01-15', 1)]);
  assert.deepEqual(r.intervals.map(i => i.in_window), [false, true, true]);
  assert.equal(r.stats.window_from, '2025-02-01');
  assert.equal(r.stats.low_sample, true);
  const gap = review([point('a', '2026-01-01', null, null), point('g', '2026-02-01', null, null, { complete: false, missing: 1 }), point('b', '2026-03-01', '2026-01-01', 10)], [pay('2026-02-10', 1)]);
  assert.equal(gap.incomplete_count, 1);
  assert.deepEqual([gap.intervals.length, gap.intervals[0].from], [1, '2026-01-01']);
});

test('missing income months are flagged but still computed', () => {
  const points = [point('a', '2026-01-01', null, null), point('b', '2026-04-01', '2026-01-01', 0)];
  assert.equal(review(points, [pay('2026-02-10', 5)]).intervals[0].income_possibly_missing, true);
  assert.equal(review(points, [pay('2026-02-10', 5), pay('2026-03-10', 5)]).intervals[0].income_possibly_missing, true);
});

test('year-before clamps to month end like chrono', () => {
  assert.equal(yearBefore('2026-02-01'), '2025-02-01');
  assert.equal(yearBefore('2024-02-29'), '2023-02-28');
});

test('rate and change wording', () => {
  assert.deepEqual([4750, 500, 5, 1000, -30000, null].map(rateText), ['47.5%', '5%', '0.05%', '10%', '−300%', '—']);
  const stats = { median_monthly_saving_cents: '100000' };
  const at = (m, extra = {}) => changeSentence({ status: 'ok', monthly_saving_cents: String(m), excluded: false, ...extra }, stats);
  assert.equal(at(60_000), '本期储蓄比常态少 40%。');
  assert.equal(at(150_000), '本期储蓄比常态多 50%。');
  assert.equal(at(98_000), '本期储蓄与常态基本持平。');
  assert.equal(at(1, { excluded: true }), '这一期已标记为一次性变动，不计入常态储蓄。');
  assert.equal(changeSentence({ status: 'no_income', monthly_saving_cents: null, excluded: false }, stats), '');
  assert.equal(changeSentence({ status: 'ok', monthly_saving_cents: '5', excluded: false }, { median_monthly_saving_cents: '-3' }), '常态月储蓄不为正，无法按比例比较。');
  assert.equal(changeSentence({ status: 'ok', monthly_saving_cents: '5', excluded: false }, { median_monthly_saving_cents: null }), '');
});

test('percent inputs convert to hundredths of a percent and back', () => {
  assert.deepEqual(['2', '2.5', '0.05', '-1', ' 3% ', '2.555', '', 'abc', '1000'].map(pctToHundredths), [200, 250, 5, -100, 300, null, null, null, null]);
  assert.deepEqual([200, 250, -100, 5].map(hundredthsToPct), ['2', '2.5', '-1', '0.05']);
});

test('housing fund start: sum of housing fund accounts in the latest check-in, monthly deposit from the newest income row', () => {
  const entries = [{ kind: 'housing_fund', amount_cents: '1000' }, { kind: 'housing_fund', amount_cents: '500' }, { kind: 'cash', amount_cents: '9999' }, { kind: 'housing_fund', amount_cents: null }];
  const incomes = [{ fields: { date: '2026-01-15', hpf_cents: '100' } }, { fields: { date: '2026-03-15', hpf_cents: '300' } }, { fields: { date: '2026-02-15', hpf_cents: '200' } }];
  const r = fundsFrom(entries, incomes);
  assert.deepEqual(r.funds, { hpf_balance_cents: '1500', hpf_monthly_cents: '300' });
  assert.deepEqual(r.notes, []);
  // 缺什么就说明按 0 计算，不静默当成已知。
  assert.equal(fundsFrom(null, []).notes.length, 2);
  assert.deepEqual(fundsFrom([{ kind: 'cash', amount_cents: '1' }], incomes).notes, ['最近盘点里没有公积金类账户，公积金余额按 0 计算。']);
});

test('age wording and quit-age choices', () => {
  assert.deepEqual([756, 757, 721].map(ageText), ['63 岁', '63 岁 1 个月', '60 岁 1 个月']);
  // 现在 36 岁 4 个月、63 岁领取：40、45、…、60 岁。
  assert.deepEqual(quitAges(436, 756), [40, 45, 50, 55, 60]);
  assert.deepEqual(quitAges(756, 756), []);
});

test('stale profile reminder counts whole months since the last save', () => {
  assert.equal(STALE_MONTHS, 6);
  assert.deepEqual([['2026-10-02T01:00:00Z', '2026-10-06'], ['2026-04-30T23:00:00Z', '2026-10-06'], ['2026-01-02T00:00:00Z', '2026-10-06'], ['2025-10-06T00:00:00Z', '2026-10-06'], ['2027-01-01T00:00:00Z', '2026-10-06']].map(([u, t]) => staleMonths(u, t)), [0, 6, 9, 12, 0]);
});

test('account estimate is months x base x 8%, rounded; the income default is the newest row\'s deposit', () => {
  // 14 个月、基数 32 592 元：约 8% 进个人账户。
  assert.equal(estimateAccountCents(14, '3259200'), '3650304');
  assert.deepEqual([estimateAccountCents(0, '3259200'), estimateAccountCents(12, ''), estimateAccountCents(1, '7270')], ['0', '0', '582']);
  const row = (date, hpf) => ({ fields: { date, hpf_cents: hpf } });
  assert.equal(latestHpf([row('2026-02-15', '100'), row('2026-04-15', '300'), row('2026-03-15', '200')]), '300');
  assert.equal(latestHpf([]), '');
});

test('housing fund money withdrawn into cash counts as cash saving; without a counted fund account nothing is taken out', () => {
  const incomes = [pay('2026-02-15', 2_000_000, 300_000), pay('2026-03-15', 2_000_000, 300_000)];
  const withdrawn = review([point('a', '2026-01-31', null, null), point('b', '2026-03-31', '2026-01-31', 2_500_000, { hpf_change_cents: '400000' })], incomes).intervals[0];
  assert.deepEqual([withdrawn.hpf_change_cents, withdrawn.hpf_out_cents, withdrawn.saving_cents, withdrawn.spend_cents, withdrawn.rate_hundredths], ['400000', '200000', '2100000', '2100000', 5000]);
  const grown = review([point('a', '2026-01-31', null, null), point('b', '2026-03-31', '2026-01-31', 2_500_000, { hpf_change_cents: '610000' })], incomes).intervals[0];
  assert.deepEqual([grown.hpf_out_cents, grown.rate_hundredths], ['-10000', 4725]);
  const untracked = review([point('a', '2026-01-31', null, null), point('b', '2026-03-31', '2026-01-31', 2_500_000)], incomes).intervals[0];
  assert.deepEqual([untracked.hpf_change_cents, untracked.hpf_out_cents, untracked.saving_cents, untracked.spend_cents], [null, null, '2500000', '1500000']);
});

test('I02: unknown deposits preserve arrival and saving; dependent figures alone are unknown', () => {
 const points=[point('a','2026-01-31',null,null),point('b','2026-03-31','2026-01-31',2600000,{hpf_change_cents:'600000',market_change_cents:'100000'})];
 const incomes=[pay('2026-02-15',2000000),pay('2026-03-15',2000000)]; incomes[0].fields.hpf_cents=null;
 const r=review(points,incomes), i=r.intervals[0];
 assert.deepEqual([i.income_cents,i.hpf_cents,i.hpf_known_cents,i.hpf_unknown_records],['4000000',null,'0',1]);
 assert.deepEqual([i.delta_nw_cents,i.saving_cents,i.spend_cents,i.hpf_out_cents,i.rate_hundredths],['2600000','2000000',null,null,null]);
 assert.deepEqual([r.stats.count,r.stats.spend_count,r.stats.median_monthly_spend_cents],[1,0,null]);
 assert.deepEqual(savingViews(i).map(v=>[v.id,v.total,v.rate_hundredths]),[['free',2000000n,null],['total',2600000n,null]]);
 const untracked=review(points.map(p=>({...p,hpf_change_cents:null})),incomes).intervals[0];assert.equal(untracked.spend_cents,'1400000');assert.equal(untracked.rate_hundredths,6500);
 const totals=incomeHpfTotals(incomes);assert.deepEqual(totals,{total:null,known:'0',unknown:1});
 assert.match(hpfSummary(totals.total,totals.known,totals.unknown,v=>v===null?'未知':v),/未知／不完整.*已知 0.*1 条未知/);
 const all=incomeHpfTotals([incomes[0]]);assert.equal(all.known,null);assert.doesNotMatch(hpfSummary(all.total,all.known,all.unknown,v=>'¥'+v),/¥0/);
});
test('new income defaults only from the newest row; unknown never searches older history',()=>{
 const rows=[{fields:{date:'2026-08-01',hpf_cents:'20000'}},{fields:{date:'2026-09-01',hpf_cents:null}}];
 assert.equal(latestHpf(rows),'');assert.equal(fundsFrom(null,rows).funds.hpf_monthly_cents,null);rows[1].fields.hpf_cents='0';assert.equal(latestHpf(rows),'0');
});
test('spend typical values filter their own valid samples without changing saving or change stats',()=>{
 const points=[point('p0','2026-01-01',null,null),...['02','03','04','05'].map((m,n)=>point('p'+(n+1),`2026-${m}-01`,`2026-${String(n+1).padStart(2,'0')}-01`,100000,{hpf_change_cents:'0'}))];
 const incomes=['01','02','03','04'].map(m=>pay(`2026-${m}-15`,200000));const original=review(points,incomes);incomes[0].fields.hpf_cents=null;const r=review(points,incomes);
 assert.equal(r.stats.count,4);assert.equal(r.stats.change_count,4);assert.equal(r.stats.spend_count,3);assert.equal(r.stats.median_monthly_saving_cents,original.stats.median_monthly_saving_cents);assert.equal(r.stats.median_monthly_change_cents,original.stats.median_monthly_change_cents);
 assert.equal(r.stats.median_monthly_spend_cents,'101458');
});
