// 规划模块第二阶段的内置参数（PLANNING_DESIGN §5.6）。政策与利率每年变化：每项带来源、
// 生效日期与核对状态，用户可在个人资料里覆盖；覆盖值优先，内置值随应用版本更新。
// 核对状态：official 取自官方文件原文；reported 来自媒体或第三方转述；unchecked 尚未核对。

export type Verified = 'official' | 'reported' | 'unchecked';
export type Region = 'beijing';

/** 利率与增长率一律用「万分比」整数：200 = 2.00%，与盘点比较的 rate_hundredths 同一约定。 */
export type RegionParams = {
  region: Region;
  name: string;
  /** 上年度全口径月平均工资（分）及其所属年度。 */
  avg_wage_cents: string;
  avg_wage_year: number;
  /** 月缴费基数上下限（分），自 base_effective 起适用。 */
  base_lower_cents: string;
  base_upper_cents: string;
  base_effective: string;
  /** 个人账户记账利率、公积金账户存款利率。 */
  notional_rate_hundredths: number;
  hpf_rate_hundredths: number;
};
export type ParamKey = Exclude<keyof RegionParams, 'region' | 'name' | 'avg_wage_year' | 'base_effective'>;
export type ParamSource = { key: ParamKey; label: string; verified: Verified; source: string; effective: string };

export const beijing: RegionParams = {
  region: 'beijing',
  name: '北京',
  avg_wage_cents: '1211600',
  avg_wage_year: 2025,
  base_lower_cents: '727000',
  base_upper_cents: '3634800',
  base_effective: '2026-07-01',
  notional_rate_hundredths: 150,
  hpf_rate_hundredths: 150,
};

export const paramSources: ParamSource[] = [
  { key: 'avg_wage_cents', label: '上年度月平均工资（北京 2025 年度）', verified: 'reported', source: '北京市人社局发布，经媒体转述；与缴费基数上下限互相印证，未取得原文', effective: '2026-07-01' },
  { key: 'base_upper_cents', label: '月缴费基数上限', verified: 'official', source: '北京市人社局、医保局、税务局《关于 2026 年度各项社会保险缴费工资基数上下限的通告》（2026-08-21）', effective: '2026-07-01' },
  { key: 'base_lower_cents', label: '月缴费基数下限', verified: 'official', source: '同上', effective: '2026-07-01' },
  { key: 'notional_rate_hundredths', label: '个人账户记账利率', verified: 'reported', source: '2025 年 1.5% 仅见媒体报道，未找到官方公告原文', effective: '2025-01-01' },
  { key: 'hpf_rate_hundredths', label: '公积金账户存款利率', verified: 'unchecked', source: '暂用 1.5%，未核对', effective: '' },
];

export const verifiedText: Record<Verified, string> = { official: '官方原文', reported: '媒体转述，未核对原文', unchecked: '未核对' };

/** 假设项：出厂预填值只是占位，界面上标明「这是假设」，由用户确认或修改。 */
export type Assumptions = { inflation_hundredths: number; wage_growth_hundredths: number; pp_return_hundredths: number };
export const defaultAssumptions: Assumptions = { inflation_hundredths: 200, wage_growth_hundredths: 300, pp_return_hundredths: 200 };

/** 个人养老金每年缴存上限（分）：国家规定 12000 元。 */
export const PERSONAL_PENSION_CAP_CENTS = 1_200_000;
/** 个人养老金领取时单独按 3% 缴个税。 */
export const PERSONAL_PENSION_TAX_HUNDREDTHS = 300;
/** 国发〔2005〕38 号附表：个人账户养老金计发月数，按退休年龄（岁）。 */
export const pensionMonths: Record<number, number> = {
  40: 233, 41: 230, 42: 226, 43: 223, 44: 220, 45: 216, 46: 212, 47: 207, 48: 204, 49: 199, 50: 195,
  51: 190, 52: 185, 53: 180, 54: 175, 55: 170, 56: 164, 57: 158, 58: 152, 59: 145, 60: 139,
  61: 132, 62: 125, 63: 117, 64: 109, 65: 101, 66: 93, 67: 84, 68: 75, 69: 65, 70: 56,
};

/** 用户在个人资料里覆盖的参数；缺省用内置值。 */
export type Overrides = { avg_wage_cents: string | null; base_lower_cents: string | null; base_upper_cents: string | null; notional_rate_hundredths: number | null; hpf_rate_hundredths: number | null };
export const noOverrides: Overrides = { avg_wage_cents: null, base_lower_cents: null, base_upper_cents: null, notional_rate_hundredths: null, hpf_rate_hundredths: null };
export const effectiveParams = (base: RegionParams, o: Overrides): RegionParams => ({
  ...base,
  avg_wage_cents: o.avg_wage_cents ?? base.avg_wage_cents,
  base_lower_cents: o.base_lower_cents ?? base.base_lower_cents,
  base_upper_cents: o.base_upper_cents ?? base.base_upper_cents,
  notional_rate_hundredths: o.notional_rate_hundredths ?? base.notional_rate_hundredths,
  hpf_rate_hundredths: o.hpf_rate_hundredths ?? base.hpf_rate_hundredths,
});
export const isOverridden = (key: ParamKey, o: Overrides) => o[key] !== null;
