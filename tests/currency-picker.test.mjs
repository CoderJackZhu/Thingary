import test from 'node:test';
import assert from 'node:assert/strict';
import { commonCurrencies, currencyName, currencySymbol, flagOf, pickerSections } from '../src/currency-picker.ts';
import { currencies, currencyDecimals } from '../src/currency.ts';

test('sections: default, recent, common, then the rest; no code appears twice', () => {
  const s = pickerSections('', 'JPY', ['EUR', 'JPY', 'THB']);
  assert.deepEqual(s.map(x => x.id), ['default', 'recent', 'common', 'all']);
  assert.deepEqual(s[0].codes, ['JPY']);
  assert.deepEqual(s[1].codes, ['EUR', 'THB']);
  const flat = s.flatMap(x => x.codes);
  assert.equal(new Set(flat).size, flat.length);
  assert.equal(flat.length, currencies.length);
  assert.deepEqual(s.at(-1).codes, [...s.at(-1).codes].sort());
});

test('search finds by code, Chinese name, English name and symbol', () => {
  const codes = q => pickerSections(q, 'CNY', []).flatMap(x => x.codes);
  assert.deepEqual(codes('krw'), ['KRW']);
  assert.ok(codes('日元').includes('JPY'));
  assert.ok(codes('yen').includes('JPY'));
  assert.ok(codes('pound').includes('GBP'));
  assert.deepEqual(codes('没有这个币'), []);
});

test('names, symbols and flags come from Intl and a region table; zero-decimal currencies are marked', () => {
  assert.equal(currencyName('USD', 'en'), 'US Dollar');
  assert.equal(currencyName('USD', 'zh-CN'), '美元');
  assert.equal(currencySymbol('JPY', 'en'), '¥');
  assert.equal(flagOf('KR'.length ? 'KRW' : ''), '🇰🇷');
  assert.equal(flagOf('EUR'), '🇪🇺');
  assert.equal(currencyDecimals('KRW'), 0);
  assert.equal(currencyDecimals('VND'), 0);
  assert.ok(commonCurrencies.every(c => currencies.some(x => x[0] === c)));
});
