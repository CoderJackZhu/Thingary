/** Fictional current interface examples, using the actual pure domain calculator. */
import { buildBasicCapabilities } from './plan-basic.ts';
import { defaultRetire } from './plan.ts';
import { emptyCore } from './plan-core.ts';
import type { BasicFields, ProfileUpdate, PlanningSources, BasicCapabilities } from './plan-basic-contract.ts';
export const unknownBasicUpdate = {
  "request_id": "10000000-0000-4000-8000-000000000001",
  "generation": "fictional-generation",
  "expected_revision": null,
  "section": "basic",
  "fields": {
    "spend_cents": "400000",
    "mode": "traditional",
    "real_return_before_hundredths": 0,
    "real_return_after_hundredths": 0,
    "volatility_hundredths": 500,
    "emergency_months": 0,
    "inflation_hundredths": 0,
    "monetary_basis_date": "2026-10-07",
    "basic": {
      "contract_version": 1,
      "start": {
        "kind": "simulation",
        "id": "fictional-simulation",
        "available_cents": "10000000",
        "date": "2026-09-30",
        "notes": "严格虚构契约夹具"
      },
      "contribution": {
        "id": "fictional-contribution",
        "monthly_cents": null
      },
      "contribution_costs": [],
      "retirement_costs": []
    }
  }
} satisfies ProfileUpdate;
export const basicInputFixtures = {
 unknown: unknownBasicUpdate.fields,
 zero: { ...unknownBasicUpdate.fields, basic: { ...unknownBasicUpdate.fields.basic, contribution: { id: 'fictional-contribution', monthly_cents: '0' } } },
 prediction: { ...unknownBasicUpdate.fields, basic: { ...unknownBasicUpdate.fields.basic, contribution: { id: 'fictional-contribution', monthly_cents: '500000' } } },
 missingCosts: unknownBasicUpdate.fields, legacy: null,
} satisfies Record<string, BasicFields | null>;
export function basicFixtureSources(fields: BasicFields = basicInputFixtures.unknown): PlanningSources {
 const generation = 'fictional-generation', { inflation_hundredths, monetary_basis_date, ...general } = fields;
 return { generation, write_version:1, today:'2026-10-12', modules:{planning:true,wealth:false},
 profile:{status:'ready',value:{generation,saved:{revision:1,updated_at:'2026-10-12T00:00:00Z',profile:{assumptions:{inflation_hundredths},retire:{...structuredClone(defaultRetire),...structuredClone(general),setup_completed:true,core:emptyCore(monetary_basis_date),simplified:{contract_version:1,time:{reference:null,target_month:'2050-06',horizon_month:'2080-05'},income_mode:'excluded',future_incomes:[]}}}}}},
 snapshot:{status:'ready',value:null},accounts:{status:'ready',value:[]},incomes:{status:'ready',value:[]},review:{status:'error',value:{code:'FICTIONAL',message:'虚构历史未知'}} };
}
export const unknownCapabilityFixture = buildBasicCapabilities(basicFixtureSources());
export const predictionCapabilityFixture = buildBasicCapabilities(basicFixtureSources(basicInputFixtures.prediction));
export const missingCostCapabilityFixture = buildBasicCapabilities(basicFixtureSources());
export const localErrorFixture = {status:'blocked',missing:[{code:'SOURCE_ERROR',capability:'funds',owner:'service',field:'snapshot',kind:'read_error',message:'虚构读取失败'}]} satisfies BasicCapabilities['funds'];
