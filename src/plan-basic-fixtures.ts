/** Strict fictional interface fixtures, never a production backend or calculator. */
import type { ProfileUpdate, BasicCapabilities, BasicFields } from './plan-basic-contract.ts';
export const unknownBasicUpdate = {
  request_id: '10000000-0000-4000-8000-000000000001', generation: 'fictional-generation', expected_revision: null, section: 'basic',
  fields: { birth_month: '1990-06', spend_cents: '400000', target_age: 60, horizon_age: 90, mode: 'traditional', real_return_before_hundredths: 0, real_return_after_hundredths: 0, volatility_hundredths: 500, emergency_months: 0, inflation_hundredths: 0, monetary_basis_date: '2026-10-07', confirm_legacy_replacement: false,
    basic: { contract_version: 1, start: { kind: 'simulation', id: 'fictional-simulation', available_cents: '10000000', date: '2026-09-30', notes: '严格虚构契约夹具' }, contribution: { id: 'fictional-contribution', monthly_cents: null }, retirement_income: { mode: 'excluded', selected: [] }, pension_contributions: { start_month: null, stop_month: null, base_cents: null }, contribution_costs: [], retirement_costs: [] } },
} satisfies ProfileUpdate;
export const basicInputFixtures = {
  unknown: unknownBasicUpdate.fields,
  zero: { ...unknownBasicUpdate.fields, basic: { ...unknownBasicUpdate.fields.basic, contribution: { id: 'fictional-contribution', monthly_cents: '0' } } },
  prediction: { ...unknownBasicUpdate.fields, basic: { ...unknownBasicUpdate.fields.basic, contribution: { id: 'fictional-contribution', monthly_cents: '500000' } } },
  missingCosts: { ...unknownBasicUpdate.fields, basic: { ...unknownBasicUpdate.fields.basic, retirement_costs: [] } },
  manual: { ...unknownBasicUpdate.fields, basic: { ...unknownBasicUpdate.fields.basic, retirement_income: { mode: 'manual', selected: [{ id: 'fictional-income', source_id: 'fictional-annuity', role: 'other' }] } } },
  legacy: null,
} satisfies Record<string, BasicFields | null>;
export const localErrorFixture = { status: 'blocked', missing: [{ code: 'SOURCE_ERROR', capability: 'funds', owner: 'service', field: 'snapshot', kind: 'read_error', message: '虚构来源读取失败' }] } satisfies BasicCapabilities['funds'];

import { project, outcome } from './plan-ledger.ts';
import type { Plan } from './plan-ledger.ts';
const fixturePlan = { now_months: 432, target_months: 720, horizon_months: 1080, search_cap_months: 840, mode: 'traditional', assets_cents: 10000000, saving_cents: 500000, saving_growth_hundredths: 0, r_before_hundredths: 0, r_after_hundredths: 0, inflation_hundredths: 0, volatility_hundredths: 500, items: [{ id: 'living', label: '虚构预算', monthly_cents: 400000, start_age: null, end_age: null, inflation_hundredths: null, essential: true }], incomes: [], pension_at: () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 1080 }), spends: [] } satisfies Plan;
const fixtureProjection = project(fixturePlan, 2026);
export const unknownCapabilityFixture = {
  context: { generation: 'fictional-generation', revision: 1, today: '2026-10-07', model_version: 'basic-1', modules: { planning: true, wealth: false }, start: { kind: 'simulation', id: 'fictional-simulation', date: '2026-09-30' }, monetary_basis_date: '2026-10-07', source: 'saved', write_version: 1 },
  funds: { status: 'ready', value: { available_cents: '10000000', restricted_cents: '0', debt_cents: '0', date: '2026-09-30', kind: 'simulation' } },
  requirement: { status: 'ready', value: { set: { status: 'found', monthly_cents: '470000', before_hundredths: 0, after_hundredths: 0 }, lower: { status: 'found', monthly_cents: '650000', before_hundredths: -200, after_hundredths: -200 }, upper: { status: 'found', monthly_cents: '330000', before_hundredths: 200, after_hundredths: 200 }, target_month: '2050-06', horizon_month: '2080-06', budget_scope: 'complete' } },
  prediction: { status: 'blocked', missing: [{ code: 'CONTRIBUTION_UNKNOWN', capability: 'prediction', owner: 'basic', field: 'basic.contribution.monthly_cents', message: '虚构夹具：预计投入未知', kind: 'assumption' }] },
  pension: { status: 'ready', value: { included: false, start_month: null, monthly_cents: null } },
} satisfies BasicCapabilities;
export const predictionCapabilityFixture = { ...unknownCapabilityFixture, prediction: { status: 'ready', value: { source: 'saved', contribution_cents: '500000', plan: fixturePlan, plan0: fixturePlan, projection: fixtureProjection, outcome: outcome(fixturePlan, fixtureProjection), terminal: 'surplus' } } } satisfies BasicCapabilities;
export const missingCostCapabilityFixture = { ...unknownCapabilityFixture, requirement: { status: 'blocked', missing: [{ code: 'COST_SCOPE_UNKNOWN', capability: 'requirement', owner: 'budget', field: 'basic.retirement_costs', message: '虚构房租作用域待核对', kind: 'assumption' }] } } satisfies BasicCapabilities;
