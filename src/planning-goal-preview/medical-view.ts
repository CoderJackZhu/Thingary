import type { MedicalCheck } from '../plan-medical.ts';

/** Presentation only: incomplete facts and a projected shortfall need different actions. */
export function medicalView(m: MedicalCheck, topup: string | null | undefined) {
  const short = m.status === 'short';
  const pending = m.status === 'unknown' || short && topup == null;
  const title = m.status === 'unknown' ? '医保资料尚未填全' : short ? `按当前缴费计划，医保预计还差 ${m.short_months} 个月` : m.status === 'ok' ? '按当前缴费计划，预计满足年限' : '尚未进行医保年限核算';
  const explanation = m.status === 'unknown' ? `还缺：${m.missing.join('、')}。不知道可以留空。` : m.status === 'not_needed' ? '未进行核算不代表已满足退休医保条件。' : `到 ${m.at_month}，累计预计 ${m.projected_months} 个月／要求 ${m.required_months} 个月；本地预计 ${m.local_projected_months ?? '未核对'} 个月／要求 ${m.local_required_months} 个月。两项分别比较，不相加。`;
  return { pending, title, explanation, action: short ? '查看医保缺口与补缴安排' : '补充医保资料', next: short ? '处理医保缴费缺口' : '补充医保资料', guidance: short ? topup == null ? '资料已填全。按现有计划仍有年限缺口；可核实是否继续缴费，或填写自行取得的补缴估算。金额未知可暂时保留缺口。' : '已计入你填写的补缴估算；这不代表医保资格已经核定。' : '补齐缺少的资料后，才能区分已满足年限和仍有缺口。' };
}
