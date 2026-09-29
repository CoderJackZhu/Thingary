import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inputMoney,validate,emptyFields,costs,money,unitMoney} from '../src/asset.ts';
test('money preserves unknown and zero, without float conversion',()=>{
 assert.equal(inputMoney(''),null);assert.equal(inputMoney('0'),'0');assert.equal(inputMoney('1.01'),'101');assert.equal(inputMoney('999999999.99'),'99999999999');
 for(const s of ['-1','1.001','1e3','Infinity','1000000000'])assert.throws(()=>inputMoney(s));
});
test('name-only and invalid calendar inputs',()=>{
 assert.deepEqual(validate({...emptyFields,name:'虚构耳机'},'2026-09-24'),{});
 assert.ok(validate({...emptyFields,name:' '},'2026-09-24').name);
 for(const date of ['2025-02-29','2026-09-25','2026-2-03'])assert.ok(validate({...emptyFields,name:'相机',date},'2026-09-24').date);
});
test('inclusive natural days and unknown costs',()=>{
 const base={id:'test',name:'样例',revision:1,price_cents:'100000',purchase_date:'2024-02-28'};
 assert.deepEqual(costs(base,'2024-03-01'),{days:3,daily:'33333'});
 assert.deepEqual(costs({...base,purchase_date:null},'2024-03-01'),{days:null,daily:null});
 assert.deepEqual(costs({...base,price_cents:null},'2024-03-01'),{days:3,daily:null});
 assert.deepEqual(costs({...base,price_cents:'0'},'2024-03-01'),{days:3,daily:'0'});
});

// U16-D2：整数元不显示角分；单位成本始终两位；未知不写 0。
test('money drops .00 for whole yuan and unitMoney always keeps two decimals', () => {
  assert.equal(money('35000000'), '¥350,000');
  assert.equal(money('1836'), '¥18.36');
  assert.equal(money('1830'), '¥18.30');
  assert.equal(money('0'), '¥0');
  assert.equal(money(null), '待补充');
  assert.equal(unitMoney('1800'), '¥18.00');
  assert.equal(unitMoney('1836'), '¥18.36');
  assert.equal(unitMoney(null), '待补充');
});
