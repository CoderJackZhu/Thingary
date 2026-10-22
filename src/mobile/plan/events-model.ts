import type { StoredLifeEvent, StoredSpendItem } from "../../plan.ts";
import { pctToHundredths } from "../../plan.ts";
import { monthChildReachesAge } from "../../planning-basic-forms.ts";
import { validMonthV1 } from "../../plan-simplified.ts";
import { t as tr } from '../../i18n.ts';
/** UI defaults only. The shared event compiler and engine own every calculation. */
export const eventTemplates = [
  { id: "house", label: tr('买房'), years: 7 },
  { id: "car", label: tr('买车'), years: 2 },
  { id: "reno", label: tr('装修'), years: 2 },
  { id: "wedding", label: tr('婚礼与彩礼'), years: 2 },
  { id: "child", label: tr('生育与养孩子'), years: 2 },
  { id: "edu", label: tr('子女教育'), years: 5 },
  { id: "travel", label: tr('旅行'), years: 1 },
  { id: "other", label: tr('其他大额'), years: 3 },
] as const;
export function eventTemplate(
  key: string,
  today: string,
  id: string,
  hasHouse: boolean,
): StoredLifeEvent {
  const template =
    eventTemplates.find((t) => t.id === key) ?? eventTemplates[7];
  const date = `${Number(today.slice(0, 4)) + template.years}${today.slice(4, 7)}`;
  const base: StoredLifeEvent = {
    id,
    label: template.label,
    kind: "other",
    date,
    included: true,
    price_cents: "",
    down_cents: "",
    extra_cents: "0",
    loan_rate_hundredths: 350,
    loan_years: 1,
    holding_cents: "0",
    rent_saved_cents: "0",
    cycle_years: null,
    until_month: null,
    time_unconfirmed: false,
    resale_cents: "0",
  };
  if (key === "house")
    return {
      ...base,
      kind: "house",
      included: !hasHouse,
      price_cents: "150000000",
      down_cents: "45000000",
      extra_cents: "5000000",
      loan_years: 30,
      holding_cents: "80000",
      rent_saved_cents: "200000",
    };
  if (key === "car")
    return {
      ...base,
      kind: "car",
      price_cents: "10000000",
      down_cents: "10000000",
      loan_years: 3,
      holding_cents: "120000",
      cycle_years: 8,
      resale_cents: "2000000",
    };
  const prices: Record<string, string> = {
    reno: "20000000",
    wedding: "30000000",
    child: "3000000",
    edu: "4000000",
    travel: "2000000",
    other: "5000000",
  };
  const years =
    key === "child" ? 22 : key === "edu" ? 11 : key === "travel" ? 9 : null;
  return {
    ...base,
    price_cents: prices[key] ?? prices.other,
    down_cents: prices[key] ?? prices.other,
    holding_cents: key === "child" ? "300000" : "0",
    cycle_years: ["edu", "travel"].includes(key) ? 1 : null,
    until_month: years
      ? `${Number(date.slice(0, 4)) + years}${date.slice(4)}`
      : null,
  };
}
/** Kind changes drop controls that are no longer visible, as the desktop editor does. */
export function eventForKind(event: StoredLifeEvent): StoredLifeEvent {
  return {
    ...event,
    rent_saved_cents: event.kind === "house" ? event.rent_saved_cents : "0",
    cycle_years: event.kind === "house" ? null : event.cycle_years,
    until_month: event.kind === "house" ? null : event.until_month,
    resale_cents: event.kind === "car" ? event.resale_cents : "0",
    time_unconfirmed: false,
  };
}
export function validateEvent(event: StoredLifeEvent): string | null {
  if (!event.label.trim() || event.label.trim().length > 40)
    return tr('请填写名称（不超过 40 字）。');
  if (!validMonthV1(event.date)) return tr('请填写有效的计划月份。');
  const money = [
    event.price_cents,
    event.down_cents,
    event.extra_cents,
    event.holding_cents,
    event.rent_saved_cents,
    event.resale_cents,
  ];
  if (
    money.some((v) => !/^(0|[1-9]\d*)$/.test(v) || BigInt(v) > 99999999999n) ||
    BigInt(event.price_cents) <= 0n
  )
    return tr('请填写合法金额；总价须大于零。');
  if (BigInt(event.down_cents) > BigInt(event.price_cents))
    return tr('首付不能高于总价。');
  if (
    BigInt(event.down_cents) < BigInt(event.price_cents) &&
    (!Number.isInteger(event.loan_rate_hundredths) ||
      event.loan_rate_hundredths < 0 ||
      event.loan_rate_hundredths > 2000 ||
      !Number.isInteger(event.loan_years) ||
      event.loan_years < 1 ||
      event.loan_years > 40)
  )
    return tr('贷款利率须在 0 到 20% 之间，年限须是 1 到 40 的整数。');
  if (
    event.cycle_years !== null &&
    (!Number.isInteger(event.cycle_years) ||
      event.cycle_years < 1 ||
      event.cycle_years > 40)
  )
    return tr('重复周期须为 1 到 40 的整数年，留空表示一次。');
  if (
    event.until_month !== null &&
    (!validMonthV1(event.until_month) || event.until_month < event.date)
  )
    return tr('截止月份不能早于计划月份。');
  return null;
}
export const childEndMonth = monthChildReachesAge;
export function stageCost(input: {
  id: string;
  label: string;
  monthly: string;
  start: string;
  end: string;
  inflation: string;
  essential: boolean;
}): StoredSpendItem {
  if (!input.label.trim() || input.label.trim().length > 40)
    throw new Error(tr('请填写名称（不超过 40 字）。'));
  if (!/^[1-9]\d*$/.test(input.monthly) || BigInt(input.monthly) > 99999999999n)
    throw new Error(tr('每月金额须大于零。'));
  if ([input.start, input.end].some((v) => v !== "" && !validMonthV1(v)))
    throw new Error(tr('请填写有效月份，或留空。'));
  if (input.start && input.end && input.end <= input.start)
    throw new Error(tr('结束月份须晚于开始月份。'));
  const inflation =
    input.inflation.trim() === "" ? null : pctToHundredths(input.inflation);
  if (
    input.inflation.trim() !== "" &&
    (inflation === null || inflation < -1000 || inflation > 2000)
  )
    throw new Error(tr('每年上涨须为 -10 到 20% 之间，留空跟随通胀。'));
  return {
    id: input.id,
    label: input.label.trim(),
    monthly_cents: input.monthly,
    start_month: input.start || null,
    end_month: input.end || null,
    inflation_hundredths: inflation,
    essential: input.essential,
    time_unconfirmed: false,
  };
}
export function impactText(
  delay: number | null,
  base: number | null,
  after: number | null,
): string {
  return base === null
    ? tr('原计划在规划终点前尚未达成')
    : after === null
      ? tr('计入后在规划终点前尚未达成')
      : delay === 0
        ? tr('停工时间几乎无影响')
        : delay === null
          ? tr('影响未知')
          : tr('{v1}约 {v2} 个月', { v1: delay > 0 ? "推迟" : "提前", v2: Math.abs(delay) });
}
