// 虚构预览夹具：全部为编造资料，仅驻留内存，刷新重置。
// 不读取 Store、不调用 IPC；保存结果按预览场景模拟，不代表真实保存或原生验收。
import type { FieldIssueV1, SaveContextV1, SaveOutcomeV1, SimplifiedPlanningFieldsV1, SimplifiedPlanningPortV1, SimplifiedPlanningReadV1 } from '../plan-simplified-contract.ts';
import { createSimplifiedPlanningPortV1 } from '../planning-simplified-port.ts';
import { simplifiedEmpty } from '../plan-simplified.ts';
import { t } from '../i18n.ts';
export type PreviewState = 'normal' | 'unknown' | 'empty' | 'legacy' | 'reject' | 'unresolved' | 'read-error';

const pensionIncome = (): SimplifiedPlanningFieldsV1['future_incomes'][number] => ({
  id: 'fictional-pension-1', name: '养老金', role: 'pension', included: true,
  monthly_cents: '400000', start_month: '2049-11', end_month: null,
  basis: 'start_month', basis_month: null, growth: 'fixed_nominal',
  source: '国家社会保险公共服务平台测算', source_checked_on: '2026-09-30', notes: '虚构样例',
});

const rentIncome = (): SimplifiedPlanningFieldsV1['future_incomes'][number] => ({
  id: 'fictional-rent-1', name: '租金', role: 'other', included: true,
  monthly_cents: '150000', start_month: '2049-10', end_month: '2070-09',
  basis: 'reference_month', basis_month: '2026-10', growth: 'constant_purchasing_power',
  source: null, source_checked_on: null, notes: '',
});

export const normalFields = (): SimplifiedPlanningFieldsV1 => ({
  contract_version: 1,
  time: { reference: { month: '2026-10', age_months: 436 }, target_month: '2049-10', horizon_month: '2086-10' },
  income_mode: 'manual',
  future_incomes: [pensionIncome(), rentIncome()],
  household: { mode: 'single', partner: null },
});

export const unknownFields = (): SimplifiedPlanningFieldsV1 => ({
  contract_version: 1,
  time: { reference: { month: '2026-10', age_months: 436 }, target_month: null, horizon_month: '2086-10' },
  income_mode: 'manual',
  future_incomes: [
    { ...pensionIncome(), monthly_cents: null, start_month: null },
    { ...rentIncome(), included: false },
  ],
  household: { mode: 'single', partner: null },
});

export const emptyFields = (): SimplifiedPlanningFieldsV1 => simplifiedEmpty();

export const legacyFields = (): SimplifiedPlanningFieldsV1 => ({
  contract_version: 1,
  time: { reference: null, target_month: null, horizon_month: null },
  income_mode: 'unconfirmed',
  future_incomes: [],
  household: { mode: 'single', partner: null },
});

const rejectedIssues = (): FieldIssueV1[] => [
  { path: 'time.target_month', code: 'invalid_month', message: t('月份须为 YYYY-MM') },
  { path: 'future_incomes.fictional-pension-1.name', code: 'required', message: t('请填写收入名称') },
];

/** 虚构端口：内存实现 Sol 的 D0 端口契约，按场景模拟保存结果。 */
export function fictionalPort(state: PreviewState): SimplifiedPlanningPortV1 {
  let revision = 3;
  let fields: SimplifiedPlanningFieldsV1 = state === 'unknown' ? unknownFields() : state === 'empty' ? emptyFields() : state === 'legacy' ? legacyFields() : normalFields();
  let pending: { fields: SimplifiedPlanningFieldsV1; context: SaveContextV1 } | null = null;
  return createSimplifiedPlanningPortV1({
    async read(): Promise<SimplifiedPlanningReadV1> {
      if (state === 'read-error') throw new Error(t('虚构读取失败：预览不读取真实资料。'));
      return { generation: 'fictional-preview-generation', revision, fields: structuredClone(fields),
        reset_reasons: state === 'legacy' ? ['time_unconfirmed', 'income_unconfirmed'] : [],
        capabilities: null };
    },
    async save(next: SimplifiedPlanningFieldsV1, _context: SaveContextV1): Promise<SaveOutcomeV1> {
      if (state === 'reject') return { status: 'rejected', issues: rejectedIssues() };
      if (state === 'unresolved') { pending = { fields: structuredClone(next), context: _context }; return { status: 'unresolved', request_id: _context.request_id }; }
      fields = structuredClone(next); revision += 1;
      return { status: 'saved', revision };
    },
    async saveSetup(): Promise<SaveOutcomeV1> { throw new Error(t('预览不模拟向导统一保存。')); },
    async resolve(context: SaveContextV1): Promise<SaveOutcomeV1> {
      if (pending && pending.context.request_id === context.request_id && pending.context.generation === context.generation) { fields = pending.fields; pending = null; revision += 1; return { status: 'saved', revision }; }
      return { status: 'rejected', issues: [] };
    },
  });
}
