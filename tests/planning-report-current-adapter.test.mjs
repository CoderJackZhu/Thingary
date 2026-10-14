import test from 'node:test';
import assert from 'node:assert/strict';
import { currentReportInput } from '../src/planning-report/current-adapter.ts';
import { basicFixtureSources, basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { copyText, parseReportInput, redactReport, printableHtml, reportConclusion } from '../src/planning-report/model.ts';
import { fixture } from './planning-ui-fixture.mjs';

const report = sources => currentReportInput(sources, buildBasicCapabilities(sources), sources.today);

test('current summary exposes known requirements while preserving unknown, zero and withdrawal inputs',()=>{
 for(const cents of [null,'0','-12500','500000']){
  const s=basicFixtureSources(basicInputFixtures.prediction);s.profile.value.saved.profile.retire.basic.contribution.monthly_cents=cents;
  const caps=buildBasicCapabilities(s),r=currentReportInput(s,caps,s.today),summary=r.current_summary;
  assert.equal(summary.estimated_contribution.cents,cents);
  assert.equal(summary.required_contribution.cents,caps.requirement.value.set.monthly_cents);
  assert.equal(summary.contribution_direction,cents===null?'unknown':cents==='0'?'none':cents.startsWith('-')?'withdrawal':'contribution');
  if(cents===null){assert.equal(summary.outcome,'incomplete');assert.equal(summary.expected_retirement_month,null);}
  if(cents===null||cents.startsWith('-'))assert.equal(summary.difference.cents,null);
  else assert.equal(summary.difference.cents,(BigInt(cents)-BigInt(summary.required_contribution.cents)).toString());
 }
});
test('summary states distinguish failed prediction, no margin, pending coverage and successful coverage',()=>{
 const s=basicFixtureSources(basicInputFixtures.prediction),caps=buildBasicCapabilities(s);
 for(const [success,terminal,limited,expected] of [[false,'gap',false,'not_covered'],[true,'no_margin',false,'no_margin'],[true,'surplus',true,'provisional'],[true,'surplus',false,'covered']]){
  const changed=structuredClone({...caps,prediction:undefined});changed.prediction={status:'ready',value:{...caps.prediction.value,terminal,outcome:{...caps.prediction.value.outcome,success}}};
  changed.annotations=limited?[{id:'unknown-fee',reason_code:'COST_PERIOD_PENDING',effect:'uncertain',treatment:'omitted',source_ids:[],missing_fields:[],refinement:{owner:'budget',field:'spend_items'}}]:[];
  const r=currentReportInput(s,changed,s.today);assert.equal(r.current_summary.outcome,expected);
  assert.equal(reportConclusion(r),reportConclusion(redactReport(r)));assert.equal(r.status,'partial');
 }
});
test('FIRE summary preserves the real month offset rather than inventing a calendar day',()=>{
 const s=basicFixtureSources(basicInputFixtures.prediction);s.profile.value.saved.profile.retire.mode='fire';
 const caps=buildBasicCapabilities(s),index=27;
 const changed={...caps,prediction:{status:'ready',value:{...caps.prediction.value,projection:{...caps.prediction.value.projection,fi_month:index}}}};
 const r=currentReportInput(s,changed,s.today);
 const anchor=caps.prediction.value.plan.anchor_date;const base=Number(anchor.slice(0,4))*12+Number(anchor.slice(5,7))-1+index;
 assert.equal(r.current_summary.expected_retirement_month,`${Math.floor(base/12)}-${String(base%12+1).padStart(2,'0')}`);
});
test('summary validation rejects malformed fields and private render/copy/print erase every financial value',()=>{
 const s=basicFixtureSources(basicInputFixtures.prediction),r=report(s);
 for(const patch of [{target_month:'2030-01-01'},{outcome:'safe_forever'},{required_contribution:{kind:'money',cents:123,basis:'known'}},{before_return:undefined}]){
  assert.equal(parseReportInput({...r,current_summary:{...r.current_summary,...patch}}).ok,false);
 }
 assert.equal(parseReportInput({...r,kind:'baseline'}).ok,false);
 const enriched=structuredClone(r);enriched.current_summary.secret='秘密987654321';
 const privateReport=redactReport(enriched);assert.equal(privateReport.current_summary.secret,undefined);
 for(const key of ['required_contribution','estimated_contribution','difference','terminal_available','available_funds','budget'])assert.equal(privateReport.current_summary[key].cents,null);
 for(const out of [JSON.stringify(privateReport),copyText(enriched,true),printableHtml(enriched,{privacy:true})]){
  assert.ok(!out.includes('秘密987654321'));assert.ok(!out.includes('¥'));
 }
 assert.ok(copyText(enriched,true).includes('金额已隐藏'));assert.ok(printableHtml(enriched,{privacy:true}).includes('金额已隐藏'));
 const legacy={...r};delete legacy.current_summary;assert.equal(parseReportInput(legacy).ok,true);
});

test('current report uses saved domain metadata and a detached, valid v1 snapshot', () => {
  const s = basicFixtureSources(basicInputFixtures.prediction), caps = buildBasicCapabilities(s);
  const r = currentReportInput(s, caps, s.today), before = JSON.stringify(r);
  assert.equal(parseReportInput(r).ok, true);
  assert.equal(r.kind, 'current'); assert.equal(r.model_version, caps.context.model_version);
  assert.equal(r.source_date, caps.context.start.date); assert.equal(r.monetary_basis_date, caps.context.monetary_basis_date);
  assert.equal(r.scenario_revision, null); assert.deepEqual(r.differences, []);
  s.profile.value.saved.profile.retire.basic.contribution.monthly_cents = '1';
  caps.annotations?.push({ id: 'later', message: '后来变更' });
  assert.equal(JSON.stringify(r), before);
});

test('private current report preserves the actual public kernel version without exposing arbitrary metadata or unknown amounts', () => {
  const sources = basicFixtureSources(), caps = buildBasicCapabilities(sources);
  const input = currentReportInput(sources, caps, sources.today);
  const privateReport = redactReport(input);
  assert.match(input.model_version, /^rust-[a-f0-9]{12}$/);
  assert.equal(privateReport.model_version, caps.context.model_version);
  assert.equal(privateReport.current_summary.estimated_contribution.cents, null);
  assert.equal(privateReport.current_summary.estimated_contribution.hidden, false);
  assert.equal(privateReport.current_summary.estimated_contribution.basis, 'unknown');
  for (const text of [copyText(input, true), printableHtml(input, { privacy: true })]) {
    assert.ok(text.includes(caps.context.model_version));
  }
  const other = { ...input, model_version: '私人版本-余额123456789' };
  assert.equal(redactReport(other).model_version, null);
  for (const text of [copyText(other, true), printableHtml(other, { privacy: true })]) {
    assert.ok(!text.includes(other.model_version));
  }
});

test('unknown contribution preserves requirements without inventing a prediction or series', () => {
  const s = basicFixtureSources(), caps = buildBasicCapabilities(s), r = report(s);
  assert.equal(caps.requirement.status, 'ready'); assert.equal(caps.prediction.status, 'blocked');
  assert.equal(r.headline.status, 'incomplete'); assert.equal(r.headline.amount.cents, null);
  assert.equal(r.assumptions.find(row => row.id === 'contribution').value.cents, null);
  assert.equal(r.assumptions.find(row => row.id === 'requirement-所设收益').value.cents, caps.requirement.value.set.monthly_cents);
  assert.deepEqual(r.series, []); assert.deepEqual(r.goals, []);
  assert.ok(r.missing.some(row => row.id.includes('CONTRIBUTION_UNKNOWN')));
});

test('explicit zero and negative contributions remain independent assumptions', () => {
  for (const cents of ['0', '-10000']) {
    const s = basicFixtureSources(basicInputFixtures.zero);
    s.profile.value.saved.profile.retire.basic.contribution.monthly_cents = cents;
    assert.equal(report(s).assumptions.find(row => row.id === 'contribution').value.cents, cents);
  }
});

test('no-margin and unmet FIRE targets never become complete safety conclusions', () => {
  const s = basicFixtureSources(basicInputFixtures.prediction), caps = buildBasicCapabilities(s);
  assert.equal(caps.prediction.status, 'ready');
  for (const [terminal, success, id] of [['no_margin', true, 'terminal-no-margin'], ['surplus', false, 'target-not-covered']]) {
    const changed = { ...caps, prediction: { status: 'ready', value: { ...caps.prediction.value, terminal, outcome: { ...caps.prediction.value.outcome, success, at_horizon: terminal === 'no_margin' ? 0 : 10000 } } } };
    const r = currentReportInput(s, changed, s.today);
    assert.equal(r.headline.status, 'incomplete'); assert.ok(r.missing.some(row => row.id === id));
  }
});

test('source errors and unknown budget stay partial without guessed zero amounts', () => {
  const s = basicFixtureSources(); s.profile.value.saved.profile.retire.spend_cents = null;
  const r = report(s); assert.equal(r.status, 'partial'); assert.equal(r.headline.status, 'incomplete');
  assert.equal(r.assumptions.find(row => row.id === 'budget').value.cents, null);
  s.profile.value.saved.profile.retire.basic.start = { kind: 'live' }; s.modules.wealth = true;
  s.snapshot = { status: 'error', value: { code: 'TEST', message: '虚构盘点读取失败' } };
  const error = report(s); assert.deepEqual(error.funds, []);
  assert.ok(error.missing.some(row => row.label.includes('读取失败')));
});

test('live accounts are stable aliases in complete and privacy copies; notes and names never transfer', () => {
  const s = fixture();
  for (const account of s.accounts.value) { account.fields.name = '秘密账户8888'; account.fields.notes = '秘密备注9999'; }
  s.snapshot.value.notes = '秘密备注9999';
  const r = report(s);
  assert.ok(r.funds.length > 0); assert.ok(r.funds.every(row => /^账户 \d+$/.test(row.name)));
  for (const out of [JSON.stringify(r), copyText(r, false), JSON.stringify(redactReport(r)), copyText(r, true)]) {
    assert.ok(!out.includes('秘密账户8888')); assert.ok(!out.includes('秘密备注9999'));
  }
  const aliases = r.funds.map(row => row.name);
  s.snapshot.value.entries.reverse(); assert.deepEqual(report(s).funds.map(row => row.name), aliases);
  const caps = buildBasicCapabilities(s);
  caps.annotations = [{ id: 'fictional-private-source', reason_code: 'DEBT_BALANCE_CHANGED', message: '秘密账户8888的余额已变化', effect: 'uncertain', treatment: 'omitted', source_ids: [], missing_fields: [], refinement: { owner: 'funds', field: 'debt' } }];
  assert.ok(!JSON.stringify(currentReportInput(s, caps, s.today)).includes('秘密账户8888'));
});

test('unconfirmed account purposes are not presented as invented available or restricted funds', () => {
  const s = fixture(); const id = s.snapshot.value.entries.find(row => row.side === 'asset').account_id;
  s.profile.value.saved.profile.retire.core.fund_rules = s.profile.value.saved.profile.retire.core.fund_rules.filter(row => row.account_id !== id);
  const r = report(s); assert.ok(r.missing.some(row => row.label.includes('本预览未将其列为可用资金或暂时取不出的钱')));
});

test('temporary, stale, disabled and unsaved contexts cannot masquerade as current saved reports', () => {
  const s = basicFixtureSources(), caps = buildBasicCapabilities(s);
  assert.throws(() => currentReportInput(s, { ...caps, context: { ...caps.context, source: 'temporary' } }, s.today), /来源已变化/);
  assert.throws(() => currentReportInput(s, { ...caps, context: { ...caps.context, generation: 'other' } }, s.today), /来源已变化/);
  assert.throws(() => currentReportInput(s, { ...caps, context: { ...caps.context, revision: 999 } }, s.today), /来源已变化/);
  s.modules.planning = false; assert.throws(() => report(s), /请先保存/);
  s.modules.planning = true; s.profile.value.saved = null; assert.throws(() => report(s), /请先保存/);
});

test('excluded future incomes are not listed as adopted conditions', () => {
  const s = basicFixtureSources(); s.profile.value.saved.profile.retire.simplified.future_incomes = [{ id: 'excluded', included: true, name: '不应出现', monthly_cents: '999999', start_month: '2050-06', end_month: null, role: 'other', basis: 'reference_month', basis_month: '2026-10', growth: 'fixed_nominal', source: null, source_checked_on: null, notes: '' }];
  assert.equal(report(s).assumptions.some(row => row.id === 'income-1'), false);
});

test('omitted unknown fee timing limits an otherwise successful prediction headline', () => {
  const s = basicFixtureSources(basicInputFixtures.prediction);
  const r = s.profile.value.saved.profile.retire;
  r.basic.contribution.monthly_cents = '10000000';
  r.spend_items = [{ id: 'unknown-fee', label: '虚构额外费用', monthly_cents: '10000', start_month: null, end_month: null, inflation_hundredths: null, essential: true, time_unconfirmed: true }];
  const caps = buildBasicCapabilities(s); assert.equal(caps.prediction.status, 'ready'); assert.equal(caps.prediction.value.outcome.success, true);
  assert.ok(caps.annotations.some(row => row.treatment === 'omitted' && row.effect === 'requirement_lower'));
  const output = currentReportInput(s, caps, s.today);
  assert.equal(output.headline.status, 'incomplete'); assert.ok(output.missing.some(row => row.impact === 'blocks_headline' && row.label.includes('费用')));
  assert.match(output.assumptions.find(row => row.id === 'coverage').value.text, /已纳入条件/);
  r.spend_items = []; assert.equal(report(s).headline.status, 'ok', 'preview-scope info alone must not erase a successful result');
});

test('future income first-payment basis uses the start month rather than a missing reference month', () => {
  const s = basicFixtureSources(); s.profile.value.saved.profile.retire.simplified.income_mode = 'manual';
  s.profile.value.saved.profile.retire.simplified.future_incomes = [{ id: 'income', included: true, name: '虚构养老金', monthly_cents: '100000', start_month: '2050-06', end_month: null, role: 'pension', basis: 'start_month', basis_month: null, growth: 'fixed_nominal', source: null, source_checked_on: null, notes: '' }];
  assert.match(report(s).assumptions.find(row => row.id === 'income-time-1').value.text, /金额基准 2050-06/);
});

test('excluded and unknown-use accounts do not shift aliases between full and privacy views', () => {
  const s = fixture(), assets = s.snapshot.value.entries.filter(row => row.side === 'asset');
  assert.ok(assets.length >= 2);
  s.profile.value.saved.profile.retire.core.fund_rules = s.profile.value.saved.profile.retire.core.fund_rules.filter(row => row.account_id !== assets[0].account_id);
  const second = s.profile.value.saved.profile.retire.core.fund_rules.find(row => row.account_id === assets[1].account_id); second.availability = 'excluded';
  const output = report(s); assert.deepEqual(output.funds.map(row => row.name), redactReport(output).funds.map(row => row.name));
  assert.ok(output.missing.some(row => row.label.includes('待核对来源')));
});
