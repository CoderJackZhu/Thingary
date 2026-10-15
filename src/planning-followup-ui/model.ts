// 规划假设与资金流动的界面纯函数层（规则见 docs/PRODUCT_RULES.md）。
// 本目录组件只做展示与格式转换：不计算损益、不汇总区间流量、不生成内容依据键、
// 不推断来源关联；严格校验、分类、去重与状态优先级一律由注入端口背后的领域负责。
// 金额为十进制分字符串；未知用 null／''，永不用 0 补齐。全部端口来自 src/planning-followup-contract.ts。
import type {
  AssumptionReadV1, AssumptionValuesV1, MovementFieldsV1, MovementPurposeV1,
  MovementRecordV1, MovementSourceV1,
} from '../planning-followup-contract.ts';
import { MAX_FLOW_NOTE_CHARS, validCents, validDate } from '../investment-review/model.ts';

// ---------------------------------------------------------------- 假设编辑

/** 契约 §2：四个默认试算值（万分比整数）——0／0／2%／5%，非用户确认的配置。 */
export const ASSUMPTION_DEFAULTS: AssumptionValuesV1 = { real_return_before_hundredths: 0, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 };
export const ASSUMPTION_BOUNDS = {
  real_return_before_hundredths: [-1000, 2000], real_return_after_hundredths: [-1000, 2000],
  inflation_hundredths: [0, 2000], volatility_hundredths: [0, 6000],
} as const;
export type AssumptionKey = keyof AssumptionValuesV1;
export const assumptionFields: { key: AssumptionKey; label: string; hint: string }[] = [
  { key: 'real_return_before_hundredths', label: '退休前实际年收益（%）', hint: '扣除通胀与费用后的实际收益；默认 0 表示只跑平通胀。' },
  { key: 'real_return_after_hundredths', label: '退休后实际年收益（%）', hint: '同样按扣除通胀与费用后的实际收益填写。' },
  { key: 'inflation_hundredths', label: '通胀（%）', hint: '用于把未来金额换算回今天的购买力。' },
  { key: 'volatility_hundredths', label: '市场模拟年波动率（%）', hint: '只作用于市场路径模拟，不改变确定性基准公式；默认 5% 是程序试算值，不是资产配置的风险估计，允许填 0。' },
];

/** 万分比整数 → 百分数文本（200 → '2'，250 → '2.5'，-100 → '-1'）。仅展示格式化。 */
export function hundredthsToPctText(v: number): string {
  const neg = v < 0, abs = Math.abs(Math.trunc(v)), whole = Math.floor(abs / 100), frac = abs % 100;
  return `${neg ? '-' : ''}${frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0+$/, '')}`}`;
}

/** 百分数文本 → 万分比整数；语法非法返回 null（不静默变 0）。边界由领域严格校验。 */
export function pctTextToHundredths(text: string): number | null {
  const s = text.trim();
  if (!/^-?\d{0,2}(\.\d{0,2})?$/.test(s) || s === '' || s === '-' || s === '.' || s === '-.') return null;
  const neg = s.startsWith('-'), [whole, frac = ''] = s.replace(/^-/, '').split('.');
  const value = (BigInt(whole || '0') * 100n + BigInt((frac + '00').slice(0, 2))) * (neg ? -1n : 1n);
  return Number(value);
}

export function assumptionValuesOf(draft: Record<AssumptionKey, string>): AssumptionValuesV1 | null {
  const out = {} as Record<AssumptionKey, number>;
  for (const { key } of assumptionFields) {
    const v = pctTextToHundredths(draft[key]);
    if (v === null) return null;
    out[key] = v;
  }
  return out as AssumptionValuesV1;
}

export const confirmationText: Record<AssumptionReadV1['confirmation'], string> = {
  unconfirmed: '试算值，未确认：这些值只是试算假设，还没有经你确认。',
  confirmed: '已核对：当前保存的值与你确认过的假设一致。',
  needs_review: '条件已变，请确认：之前确认的值后来被修改。',
};

/** 未核对／待核对不阻断试算，但界面不得把它们说成用户已确认的配置。 */
export function assumptionSummary(read: AssumptionReadV1): string {
  const v = read.values;
  return `退休前 ${hundredthsToPctText(v.real_return_before_hundredths)}% · 退休后 ${hundredthsToPctText(v.real_return_after_hundredths)}% · 通胀 ${hundredthsToPctText(v.inflation_hundredths)}% · 波动率 ${hundredthsToPctText(v.volatility_hundredths)}%`;
}

// ---------------------------------------------------------------- 资金流动

export const purposeLabel: Record<MovementPurposeV1, string> = {
  own_transfer: '本人账户转账',
  external_funding: '外部投入／取回',
  living_payment: '生活支付',
  income_distribution: '投资现金收入分配',
  investment_cost: '投资费用／税费',
};
export const purposeHint: Record<MovementPurposeV1, string> = {
  own_transfer: '两个本人账户之间的转账；同一条记录维护两端，不需要各记一次。',
  external_funding: '账户与外部之间的非投资收益本金移动：外部投入为 外部→账户，取回本金为 账户→外部。',
  living_payment: '从账户（含投资账户）对外支付的生活费；直接用投资账户付款也属于投资范围流出。',
  income_distribution: '已归属投资账户的现金收益（如分红转出）向其他账户或外部分配；留存投资账户内的分红无需记录。',
  investment_cost: '账户向外部支付的投资费用／税费；已扣在投资余额内的费用属于净损益，不要另记取回。',
};
export const sourceStatusText: Record<MovementRecordV1['source_status'], string> = {
  disabled: '来源模块已关闭',
  unlinked: '未关联来源',
  matched: '已关联来源',
  needs_review: '来源待复核',
  deleted: '来源已删除',
};
/** 契约 §4 在 FollowupIssue 上扩展的失效码；旧投资核对理由沿用 investment-review 的文案。 */
export const followupReasonText: Record<string, string> = {
  movements_disabled: '资金流动记录已关闭，明细核对暂不可用；手填合计仍可使用',
  stale_movements: '相关资金流动已被更正，原确认失效，请重新核对',
  source_mismatch: '关联来源的日期或金额与流动不一致，请复核',
  source_deleted: '关联来源已被删除，关联失效，请复核',
};

export const endpointText = (endpoint: MovementFieldsV1['from'], accountNames: Record<string, string>): string =>
  endpoint.kind === 'account' ? accountNames[endpoint.account_id] ?? `历史账户 ${endpoint.account_id}` : `外部：${endpoint.label}`;

/** 表单草稿：金额为元文本对应的规范分字符串（'' = 未填）；关闭即丢弃，不存草稿。 */
export type MovementFormDraft = {
  date: string; amount: string;
  fromKind: 'account' | 'external'; fromAccount: string; fromExternal: string;
  toKind: 'account' | 'external'; toAccount: string; toExternal: string;
  purpose: MovementPurposeV1; source: MovementSourceV1 | null; notes: string;
};

export function draftFromMovement(record: MovementRecordV1 | null): MovementFormDraft {
  const f = record?.fields;
  return {
    date: f?.date ?? '', amount: f ? f.amount_cents === '0' ? '' : f.amount_cents : '',
    fromKind: f?.from.kind ?? 'account', fromAccount: f?.from.kind === 'account' ? f.from.account_id : '', fromExternal: f?.from.kind === 'external' ? f.from.label : '',
    toKind: f?.to.kind ?? 'account', toAccount: f?.to.kind === 'account' ? f.to.account_id : '', toExternal: f?.to.kind === 'external' ? f.to.label : '',
    purpose: f?.purpose ?? 'own_transfer', source: f?.source ?? null, notes: f?.notes ?? '',
  };
}

export function draftToFields(d: MovementFormDraft): MovementFieldsV1 {
  return {
    date: d.date.trim(), amount_cents: d.amount,
    from: d.fromKind === 'account' ? { kind: 'account', account_id: d.fromAccount } : { kind: 'external', label: d.fromExternal.trim() },
    to: d.toKind === 'account' ? { kind: 'account', account_id: d.toAccount } : { kind: 'external', label: d.toExternal.trim() },
    purpose: d.purpose, source: d.source, notes: d.notes,
  };
}

/** 表单级语法检查（可少不可代）：真实日历日、非零正金额、两端结构。语义校验由领域负责。 */
export function movementDraftIssues(d: MovementFormDraft): { path: string; code: string; message: string }[] {
  const issues: { path: string; code: string; message: string }[] = [];
  if (!validDate(d.date.trim())) issues.push({ path: 'date', code: 'invalid_date', message: '日期必须是真实有效的 YYYY-MM-DD，按实际结算日填写。' });
  if (d.amount === '') issues.push({ path: 'amount_cents', code: 'missing_amount', message: '金额无法确定时不能保存成虚构事实：请补齐金额，或取消后先记在区间备注里。' });
  else if (!validCents(d.amount) || d.amount === '0') issues.push({ path: 'amount_cents', code: 'invalid_cents', message: '金额必须是非零的正金额。' });
  for (const [side, kind, account, label] of [['from', d.fromKind, d.fromAccount, d.fromExternal], ['to', d.toKind, d.toAccount, d.toExternal]] as const) {
    if (kind === 'external' && label.trim() === '') issues.push({ path: side, code: 'missing_external_label', message: side === 'from' ? '转出端为范围外对象时，请说明对象（例如“转入银行”）。' : '转入端为范围外对象时，请说明对象。' });
    if (kind === 'account' && account === '') issues.push({ path: side, code: 'missing_account', message: side === 'from' ? '请选择转出端账户。' : '请选择转入端账户。' });
  }
  if (d.fromKind === 'account' && d.toKind === 'account' && d.fromAccount !== '' && d.fromAccount === d.toAccount) issues.push({ path: 'to', code: 'same_account', message: '一笔流动的两端不能是同一个账户。' });
  if (d.fromKind === 'external' && d.toKind === 'external') issues.push({ path: 'from', code: 'no_account_end', message: '至少一端必须是本应用的账户；没有账户请先创建账户。' });
  if ([...d.notes].length > MAX_FLOW_NOTE_CHARS) issues.push({ path: 'notes', code: 'invalid_notes', message: `备注必须是不超过 ${MAX_FLOW_NOTE_CHARS} 字的字符串。` });
  return issues;
}

export { formatCents, formatSignedCents, intervalLabel, validDate, validCents, centsFromYuanText, yuanTextFromCents } from '../investment-review/model.ts';
