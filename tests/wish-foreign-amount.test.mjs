import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimatedPriceText } from '../src/wishlist.ts';
import { blankFa, editFa, faCents, faFrom } from '../src/foreign-amount.ts';
import { wishPlanSave } from '../src/wish-save.ts';
import { newWishDraft } from '../src/mobile/wishes/model.ts';

const wishDraft = price => {
  const draft = newWishDraft('generation-1', '2026-10-23');
  draft.fields.name = '虚构相机';
  draft.fields.estimated_price = price;
  return draft;
};

test('estimated price text keeps cents exact and empty stays unknown', () => {
  assert.equal(estimatedPriceText(null), '');
  assert.equal(estimatedPriceText(''), '');
  assert.equal(estimatedPriceText('0'), '0');
  assert.equal(estimatedPriceText('5'), '0.05');
  assert.equal(estimatedPriceText('1250'), '12.5');
  assert.equal(estimatedPriceText('129900'), '1299');
  assert.equal(estimatedPriceText('1234567'), '12345.67');
});

test('a foreign wish estimate is saved as CNY cents and an incomplete one stays unknown', () => {
  const usd = editFa(editFa(blankFa(), 'code', 'USD', '7.12'), 'text', '1299');
  const text = estimatedPriceText(faCents(usd));
  assert.equal(text, '9248.88');
  const saved = wishPlanSave(wishDraft(text), 'request-1').input;
  assert.equal(saved.fields.estimated_price_cents, '924888');
  assert.equal('estimated_price' in saved.fields, false);

  // Original amount without a rate is not a price yet: unknown, never zero.
  const noRate = editFa(editFa(blankFa(), 'code', 'USD'), 'text', '1299');
  assert.equal(faCents(noRate), '');
  assert.equal(wishPlanSave(wishDraft(estimatedPriceText(faCents(noRate))), 'request-2').input.fields.estimated_price_cents, null);
  assert.equal(wishPlanSave(wishDraft(''), 'request-3').input.fields.estimated_price_cents, null);
});

test('an existing wish reads its original amount back for display and re-editing', () => {
  const state = faFrom({ currency: 'USD', original_minor: '129900', fx_rate_micro: '7120000' }, '924888');
  assert.equal(state.code, 'USD');
  assert.equal(state.text, '1299.00');
  assert.equal(state.fx, '7.12');
  assert.equal(estimatedPriceText(faCents(state)), '9248.88');
});

test('desktop and mobile wish editors use the shared foreign amount control and persist the annotation', () => {
  const desktop = readFileSync(new URL('../src/WishEditor.tsx', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../src/mobile/wishes/WishEdit.tsx', import.meta.url), 'utf8');
  for (const source of [desktop, mobile]) {
    assert.match(source, /useForeignAmount\('wish'/);
    assert.match(source, /<AmountEntry fa=\{fa\}/);
    assert.match(source, /fa\.persist\(/);
  }
  // The saved field stays the CNY cents fact; the wish-to-item conversion must not copy the estimate.
  assert.match(desktop, /estimated_price_cents:inputMoney\(draft\.fields\.estimated_price\)/);
});
