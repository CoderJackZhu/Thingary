import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastMoney} from '../src/plan-format.ts';
import {money} from '../src/asset.ts';
import {contributionVerdict} from '../src/planning-basic-view.ts';

test('forecast rounds display only, retaining unknown, negative and sub-yuan distinctions', () => {
  for (const [input, expected] of [[null,'待补充'],['','待补充'],[NaN,'暂不可计算'],['0','¥0'],['1','不足 ¥1'],['-1','负值（不足 ¥1）'],['3087','¥31'],['471831','¥4,700'],['-471831',money('-470000')],['10000','¥100']]) {
    assert.equal(forecastMoney(input), expected);
  }
  assert.equal(money('471831'),'¥4,718.31');
});

test('comparison uses original cents when display-rounded requirement equals the estimate', () => {
  const result = {status:'found', monthly_cents:'470001'};
  assert.match(contributionVerdict(result,'470000',money,forecastMoney).text,/每月还差 不足 ¥1/);
  assert.match(contributionVerdict(result,'470002',money,forecastMoney).text,/比所需多 不足 ¥1/);
});
