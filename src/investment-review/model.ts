// 投资区间复盘组件的纯函数层（契约 docs/PLANNING_SIMPLIFICATION_CONTRACT.md §4；设计 docs/PRODUCT_BOUNDARIES_DESIGN.md §13）。
// 本模块只做载荷边界校验与展示格式化：不读取数据库、不查询重叠、不持久化，
// 也不实现损益公式——损益与余额变化永远来自注入端口返回的领域结果。
// 金额为十进制分字符串或 null；未知不是零，永不用 0 补齐。

export const CONTRACT_VERSION = 1;
/** 与领域层一致的上限：99999999999 分（financial_import_parser 同源）。 */
export const MAX_CENTS = 99_999_999_999;
export const SUPPORTED_KINDS = ['investment', 'mixed', 'fund', 'bond'] as const;
export const MAX_FLOW_NOTE_CHARS = 500;
export const MAX_ID_CHARS = 100;
export const MAX_SCOPE_MEMBERS = 1_000;

export type Cents = string; // canonical integer cents; inputs are nonnegative
export type DateOnly = string; // YYYY-MM-DD

export type FieldIssueV1 = { path: string; code: string; message: string };

export type AccountKind = (typeof SUPPORTED_KINDS)[number];

export type InvestmentScopeMemberV1 = {
  account_id: string;
  kind: AccountKind;
  counted: boolean;
  amount_cents: Cents | null;
};

export type InvestmentEndpointV1 = {
  snapshot_id: string;
  revision: number;
  date: DateOnly;
  members: InvestmentScopeMemberV1[];
};

export type InvestmentFlowV1 = {
  id: string;
  revision: number;
  from_snapshot_id: string;
  from_revision: number;
  /** 确认当时的计算内容键，由领域函数生成及复核；界面不拼接。 */
  from_value_key: string;
  to_snapshot_id: string;
  to_revision: number;
  to_value_key: string;
  from_date: DateOnly;
  to_date: DateOnly;
  scope_account_ids: string[];
  inflow_cents: Cents | null;
  outflow_cents: Cents | null;
  confirmed_complete: boolean;
  unsupported_movements: boolean;
  notes: string;
};

export type InvestmentReviewInputV1 = {
  contract_version: 1;
  from: InvestmentEndpointV1;
  to: InvestmentEndpointV1;
  flow: InvestmentFlowV1 | null;
  overlapping_active_flow_ids: string[];
};

export type InvestmentReviewValueV1 = {
  opening_cents: Cents;
  closing_cents: Cents;
  change_cents: Cents; // signed
  inflow_cents: Cents;
  outflow_cents: Cents;
  profit_cents: Cents; // signed; includes reflected income and costs
};

export type InvestmentReviewResultV1 =
  | { status: 'ready'; value: InvestmentReviewValueV1 }
  | {
      status: 'not_recorded' | 'needs_review' | 'not_comparable';
      reasons: string[];
      change_cents: Cents | null;
    }
  | { status: 'invalid'; issues: FieldIssueV1[] };

// ---------------------------------------------------------------- 状态理由

export const REVIEW_REASONS = [
  'missing_flow',
  'incomplete_flow',
  'stale_endpoints',
  'scope_changed',
  'missing_balance',
  'overlapping_flow',
  'unsupported_movement',
  'empty_scope',
] as const;

export const reasonLabel: Record<string, string> = {
  missing_flow: '未记录这一期间的投入与转出',
  incomplete_flow: '流动金额或完整性待核对',
  stale_movements: '相关资金流动已被更正，原确认失效，请重新核对',
  source_mismatch: '关联来源的日期或金额与流动不一致，请复核',
  source_deleted: '关联来源已被删除，关联失效，请复核',
  stale_endpoints: '起止盘点被更正，原有确认失效，需要重新核对',
  scope_changed: '两次盘点的投资范围（账户、类型或计入状态）不一致',
  missing_balance: '投资范围内有账户缺少有效余额',
  overlapping_flow: '与同一投资范围内其他活动汇总的区间重叠',
  unsupported_movement: '存在证券实物转入转出、杠杆借款或未解释的余额调整',
  empty_scope: '本期没有计入的投资账户；空范围不等于零收益',
};

export const statusLabel: Record<InvestmentReviewResultV1['status'], string> = {
  ready: '区间投资损益',
  not_recorded: '未记录',
  needs_review: '待复核',
  not_comparable: '不可比较',
  invalid: '输入无效',
};

export const kindLabel: Record<AccountKind, string> = {
  investment: '投资账户',
  mixed: '混合账户',
  fund: '基金账户',
  bond: '债券账户',
};

/** 区间写作 (期初, 期末]：含期末、不含期初，与流动合计的口径一致。 */
export function intervalLabel(fromDate: string, toDate: string): string {
  return `（${fromDate}, ${toDate}]`;
}

// ---------------------------------------------------------------- 校验

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CENTS_RE = /^(0|[1-9][0-9]{0,17})$/;

/** 真实日历日检查（拒绝 2026-02-30、2026-9-3）。 */
export function validDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10);
  if (m < 1 || m > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 规范非负整数分：无前导零、无符号、不超上限；未知用 null 不用 ''。 */
export function validCents(v: unknown, signed = false, limit = BigInt(MAX_CENTS)): v is string {
  if (typeof v !== 'string' || v === '-0') return false;
  const body = signed && v.startsWith('-') ? v.slice(1) : v;
  return (signed ? /^-?(0|[1-9][0-9]{0,17})$/ : CENTS_RE).test(v) && BigInt(body) <= limit;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const intAtLeast = (v: unknown, min: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const checkId = (v: unknown, path: string, issues: FieldIssueV1[]) => {
  if (typeof v !== 'string' || v.length === 0 || [...v].length > MAX_ID_CHARS)
    issues.push({ path, code: 'invalid_id', message: 'ID 必须是非空且不超过 100 字符的稳定字符串' });
};
const checkCentsField = (v: unknown, path: string, issues: FieldIssueV1[]) => {
  if (v === null) return;
  if (!validCents(v))
    issues.push({ path, code: 'invalid_cents', message: '金额必须是规范的非负整数分字符串（如 "1200"）或 null' });
};

export type ParseOk<T> = { ok: true; value: T };
export type ParseFail = { ok: false; issues: FieldIssueV1[] };

function checkEndpoint(raw: unknown, label: string, issues: FieldIssueV1[]): void {
  if (!isObj(raw)) {
    issues.push({ path: label, code: 'not_an_object', message: `${label} 必须是对象` });
    return;
  }
  checkId(raw.snapshot_id, `${label}.snapshot_id`, issues);
  if (!intAtLeast(raw.revision, 0)) issues.push({ path: `${label}.revision`, code: 'invalid_revision', message: '修订号必须是非负整数' });
  if (typeof raw.date !== 'string' || !validDate(raw.date)) issues.push({ path: `${label}.date`, code: 'invalid_date', message: '日期必须是真实的 YYYY-MM-DD' });
  if (!Array.isArray(raw.members)) {
    issues.push({ path: `${label}.members`, code: 'invalid_array', message: 'members 必须是数组' });
    return;
  }
  if (raw.members.length > MAX_SCOPE_MEMBERS)
    issues.push({ path: `${label}.members`, code: 'too_many_members', message: `投资范围成员超过 ${MAX_SCOPE_MEMBERS} 个` });
  const seen = new Set<string>();
  raw.members.forEach((m: unknown, index: number) => {
    if (!isObj(m)) {
      issues.push({ path: `${label}.members[${index}]`, code: 'not_an_object', message: '成员必须是对象' });
      return;
    }
    const base = typeof m.account_id === 'string' && m.account_id ? `${label}.members.${m.account_id}` : `${label}.members[${index}]`;
    checkId(m.account_id, `${base}.account_id`, issues);
    if (typeof m.kind !== 'string' || !SUPPORTED_KINDS.includes(m.kind as AccountKind))
      issues.push({
        path: `${base}.kind`,
        code: 'unsupported_kind',
        message: `账户类型必须是 investment/mixed/fund/bond；现金／存款、公积金和负债不混入投资范围`,
      });
    if (typeof m.counted !== 'boolean') issues.push({ path: `${base}.counted`, code: 'invalid_counted', message: 'counted 必须是布尔值' });
    checkCentsField(m.amount_cents, `${base}.amount_cents`, issues);
    if (typeof m.account_id === 'string' && m.account_id) {
      if (seen.has(m.account_id))
        issues.push({ path: `${label}.members`, code: 'duplicate_account', message: `投资范围中账户 ${m.account_id} 重复出现` });
      seen.add(m.account_id);
    }
  });
}

function checkFlow(raw: unknown, issues: FieldIssueV1[]): void {
  if (!isObj(raw)) {
    issues.push({ path: 'flow', code: 'not_an_object', message: 'flow 必须是对象或 null' });
    return;
  }
  checkId(raw.id, 'flow.id', issues);
  if (!intAtLeast(raw.revision, 0) || !intAtLeast(raw.from_revision, 0) || !intAtLeast(raw.to_revision, 0))
    issues.push({ path: 'flow.revision', code: 'invalid_revision', message: '流动记录的修订号必须是非负整数' });
  checkId(raw.from_snapshot_id, 'flow.from_snapshot_id', issues);
  checkId(raw.to_snapshot_id, 'flow.to_snapshot_id', issues);
  for (const key of ['from_value_key', 'to_value_key'] as const) {
    if (typeof raw[key] !== 'string' || raw[key].length === 0)
      issues.push({ path: `flow.${key}`, code: 'invalid_value_key', message: '计算内容键由领域函数生成及复核，不能为空或由界面拼接' });
  }
  for (const key of ['from_date', 'to_date'] as const) {
    if (typeof raw[key] !== 'string' || !validDate(raw[key]))
      issues.push({ path: `flow.${key}`, code: 'invalid_date', message: '日期必须是真实的 YYYY-MM-DD' });
  }
  if (typeof raw.from_date === 'string' && typeof raw.to_date === 'string' && validDate(raw.from_date) && validDate(raw.to_date) && raw.from_date >= raw.to_date)
    issues.push({ path: 'flow.to_date', code: 'invalid_interval', message: '流动区间同样要求 (期初, 期末]，期末必须晚于期初' });
  checkCentsField(raw.inflow_cents, 'flow.inflow_cents', issues);
  checkCentsField(raw.outflow_cents, 'flow.outflow_cents', issues);
  if (typeof raw.confirmed_complete !== 'boolean')
    issues.push({ path: 'flow.confirmed_complete', code: 'invalid_flag', message: '确认标记必须是布尔值' });
  if (typeof raw.unsupported_movements !== 'boolean')
    issues.push({ path: 'flow.unsupported_movements', code: 'invalid_flag', message: '未支持情形标记必须是布尔值' });
  if (raw.confirmed_complete === true) {
    for (const [key, has] of [['inflow_cents', raw.inflow_cents !== null], ['outflow_cents', raw.outflow_cents !== null]] as const)
      if (!has)
        issues.push({
          path: `flow.${key}`,
          code: 'confirmed_without_amount',
          message: '已确认完整时金额必须明确：未知请先留空并取消确认，零必须显式填 0',
        });
  }
  if (typeof raw.notes !== 'string' || [...raw.notes].length > MAX_FLOW_NOTE_CHARS)
    issues.push({ path: 'flow.notes', code: 'invalid_notes', message: `备注必须是不超过 ${MAX_FLOW_NOTE_CHARS} 字的字符串` });
  if (!Array.isArray(raw.scope_account_ids)) {
    issues.push({ path: 'flow.scope_account_ids', code: 'invalid_array', message: 'scope_account_ids 必须是数组' });
  } else {
    const seen = new Set<string>();
    for (const id of raw.scope_account_ids) {
      checkId(id, 'flow.scope_account_ids', issues);
      if (typeof id === 'string' && id) {
        if (seen.has(id)) issues.push({ path: 'flow.scope_account_ids', code: 'duplicate_account', message: `流动记录的投资范围中账户 ${id} 重复出现` });
        seen.add(id);
      }
    }
  }
}

/**
 * 严格校验投资复盘输入载荷（领域侧校验的镜像，可少不可代：UI 校验只为
 * 提前给出可读错误，后端验证不可省略）。通过时返回输入的深拷贝；不把本函数当作持久化白名单。
 */
export function parseReviewInput(raw: unknown): ParseOk<InvestmentReviewInputV1> | ParseFail {
  if (!isObj(raw)) return { ok: false, issues: [{ path: '', code: 'not_an_object', message: '输入必须是对象' }] };
  const issues: FieldIssueV1[] = [];
  if (raw.contract_version !== CONTRACT_VERSION)
    issues.push({ path: 'contract_version', code: 'unsupported_contract_version', message: `不支持的协议版本 ${String(raw.contract_version)}，本组件只接受 1` });
  checkEndpoint(raw.from, 'from', issues);
  checkEndpoint(raw.to, 'to', issues);
  const from = isObj(raw.from) ? raw.from : null;
  const to = isObj(raw.to) ? raw.to : null;
  if (
    from && to &&
    typeof from.date === 'string' && typeof to.date === 'string' &&
    validDate(from.date) && validDate(to.date) && from.date >= to.date
  )
    issues.push({ path: 'to.date', code: 'invalid_interval', message: `期末日期 ${to.date} 必须晚于期初日期 ${from.date}；区间为 (期初, 期末]` });
  if (raw.flow !== null) checkFlow(raw.flow, issues);
  if (!Array.isArray(raw.overlapping_active_flow_ids))
    issues.push({ path: 'overlapping_active_flow_ids', code: 'invalid_array', message: 'overlapping_active_flow_ids 必须是数组' });
  else for (const id of raw.overlapping_active_flow_ids) checkId(id, 'overlapping_active_flow_ids', issues);
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: structuredClone(raw) as InvestmentReviewInputV1 };
}

/** 结果载荷形状检查：只看形状与规范金额字符串，不复算任何数值。 */
export function parseReviewResult(raw: unknown): ParseOk<InvestmentReviewResultV1> | ParseFail {
  if (!isObj(raw)) return { ok: false, issues: [{ path: '', code: 'not_an_object', message: '结果必须是对象' }] };
  const issues: FieldIssueV1[] = [];
  if (raw.status === 'ready') {
    const v = raw.value;
    if (!isObj(v)) {
      issues.push({ path: 'value', code: 'not_an_object', message: 'ready 结果必须带 value' });
    } else {
      for (const key of ['opening_cents', 'closing_cents', 'inflow_cents', 'outflow_cents'] as const)
        if (!validCents(v[key], false, BigInt(MAX_CENTS) * BigInt(key === 'opening_cents' || key === 'closing_cents' ? MAX_SCOPE_MEMBERS : 1))) issues.push({ path: `value.${key}`, code: 'invalid_cents', message: `${key} 必须是规范的非负整数分字符串` });
      for (const key of ['change_cents', 'profit_cents'] as const)
        if (!validCents(v[key], true, BigInt(MAX_CENTS) * BigInt(MAX_SCOPE_MEMBERS + (key === 'profit_cents' ? 1 : 0)))) issues.push({ path: `value.${key}`, code: 'invalid_cents', message: `${key} 必须是规范的整数分字符串（可带负号）` });
    }
  } else if (raw.status === 'not_recorded' || raw.status === 'needs_review' || raw.status === 'not_comparable') {
    if (!Array.isArray(raw.reasons) || raw.reasons.length === 0 || raw.reasons.some(r => typeof r !== 'string' || !r))
      issues.push({ path: 'reasons', code: 'invalid_reasons', message: 'reasons 必须是非空字符串数组' });
    if (raw.change_cents !== null && !validCents(raw.change_cents, true, BigInt(MAX_CENTS) * BigInt(MAX_SCOPE_MEMBERS)))
      issues.push({ path: 'change_cents', code: 'invalid_cents', message: 'change_cents 必须是规范的整数分字符串（可带负号）或 null' });
  } else if (raw.status === 'invalid') {
    if (!Array.isArray(raw.issues) || raw.issues.length === 0 || raw.issues.some(i => !isObj(i) || typeof i.path !== 'string' || typeof i.code !== 'string' || typeof i.message !== 'string'))
      issues.push({ path: 'issues', code: 'invalid_issues', message: 'invalid 结果必须带字段问题数组' });
  } else {
    issues.push({ path: 'status', code: 'invalid_status', message: `未知结果状态 ${String(raw.status)}` });
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: structuredClone(raw) as InvestmentReviewResultV1 };
}

// ---------------------------------------------------------------- 展示格式化

/** 分字符串 → ¥ 显示。BigInt 逐位分组，不经过 Number；负号用 −。 */
export function formatCents(cents: string): string {
  const neg = cents.startsWith('-');
  const digits = neg ? cents.slice(1) : cents;
  const whole = digits.length > 2 ? digits.slice(0, -2) : '0';
  const frac = digits.length <= 2 ? digits.padStart(2, '0') : digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}¥${grouped}${frac === '00' ? '' : '.' + frac}`;
}

/** 带符号变化：正用 +，负用 −，未知返回 null（不显示 0）。 */
export function formatSignedCents(cents: string | null): string | null {
  if (cents === null) return null;
  return cents.startsWith('-') ? formatCents(cents) : `+${formatCents(cents)}`;
}

// ---------------------------------------------------------------- 核对草稿

/** 核对窗草稿：金额为规范分字符串，'' 表示未知（与 null 对应）。 */
export type FlowDraft = {
  inflow: string;
  outflow: string;
  confirmed: boolean;
  unsupported: boolean;
  notes: string;
};

export function emptyFlowDraft(): FlowDraft {
  return { inflow: '', outflow: '', confirmed: false, unsupported: false, notes: '' };
}

export function draftFromFlow(flow: InvestmentFlowV1 | null): FlowDraft {
  if (!flow) return emptyFlowDraft();
  return {
    inflow: flow.inflow_cents ?? '',
    outflow: flow.outflow_cents ?? '',
    confirmed: flow.confirmed_complete,
    unsupported: flow.unsupported_movements,
    notes: flow.notes,
  };
}

/** 草稿 → 提交载荷的流动字段补丁；'' 映射为 null（未知），'0' 保持显式零。 */
export function draftToFlowPatch(draft: FlowDraft): {
  inflow_cents: Cents | null;
  outflow_cents: Cents | null;
  confirmed_complete: boolean;
  unsupported_movements: boolean;
  notes: string;
} {
  return {
    inflow_cents: draft.inflow === '' ? null : draft.inflow,
    outflow_cents: draft.outflow === '' ? null : draft.outflow,
    confirmed_complete: draft.confirmed,
    unsupported_movements: draft.unsupported,
    notes: draft.notes,
  };
}

/** 元文本 → 分字符串；非法输入返回 null（调用方不更新）。'' → ''。 */
export function centsFromYuanText(text: string): string | null {
  if (text === '') return '';
  if (!/^\d{0,9}(\.\d{0,2})?$/.test(text) || text === '.' ) return null;
  const [whole, fraction = ''] = text.split('.');
  return (BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}

/** 分字符串 → 元文本（输入框显示）；'' → ''。 */
export function yuanTextFromCents(cents: string): string {
  if (cents === '') return '';
  const neg = cents.startsWith('-');
  const digits = neg ? cents.slice(1) : cents;
  const whole = digits.length > 2 ? digits.slice(0, -2) : '0';
  const frac = digits.length <= 2 ? digits.padStart(2, '0') : digits.slice(-2);
  const body = frac === '00' ? whole : `${whole}.${frac}`;
  return (neg ? '-' : '') + String(body);
}

/** 表单级检查：金额规范、备注长度、确认完整需要两个明确金额。 */
export function draftIssues(draft: FlowDraft): FieldIssueV1[] {
  const issues: FieldIssueV1[] = [];
  for (const [key, value] of [['inflow', draft.inflow], ['outflow', draft.outflow]] as const)
    if (value !== '' && !validCents(value))
      issues.push({ path: key, code: 'invalid_cents', message: '金额必须是规范的非负整数分字符串' });
  if ([...draft.notes].length > MAX_FLOW_NOTE_CHARS)
    issues.push({ path: 'notes', code: 'invalid_notes', message: `备注超过 ${MAX_FLOW_NOTE_CHARS} 字` });
  if (draft.confirmed && (draft.inflow === '' || draft.outflow === ''))
    issues.push({
      path: 'confirmed',
      code: 'confirmed_without_amount',
      message: '确认完整前需要两个金额：未知请先留空并取消确认，零必须显式填 0',
    });
  if (draft.confirmed && draft.unsupported)
    issues.push({
      path: 'confirmed',
      code: 'confirmed_with_unsupported',
      message: '存在未支持情形时不能确认简单损益完整，可保存备注后待复核',
    });
  return issues;
}
