import { useEffect, useRef, useState } from 'react';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow } from './FormControls';
import { MonthInput } from './DateInput';
import type { PlanningSources, ProfileState } from './plan';
import { useSectionSaver } from './planning-basic-data';
import { contributionCostDraft, contributionCostInput } from './planning-contribution-cost';
import { overlayPlanningDrafts } from './planning-draft';
import { buildBasicCapabilities } from './plan-basic';
import { forecastMoney } from './plan-format';

export function PlanningContributionCost({ sources, saved, reload, onPending, onClose }: {
  sources: PlanningSources; saved: NonNullable<ProfileState['saved']>; reload: () => void; onPending: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [d, setD] = useState(() => contributionCostDraft(saved)), [error, setError] = useState('');
  const frozen = saver.busy || saver.stuck, pc = saved.profile.retire.basic!.pension_contributions;
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  let preview = null, previewError = '';
  try {
    const caps = buildBasicCapabilities(overlayPlanningDrafts(sources, [contributionCostInput(d, saved)]));
    if (caps.requirement.status === 'ready') preview = caps.requirement.value.set;
    else previewError = caps.requirement.missing.map(x => x.message).join(' ');
  } catch (e) { previewError = e instanceof Error ? e.message : String(e); }
  async function save() {
    if (frozen) return;
    try {
      const input = contributionCostInput(d, saved);
      const caps = buildBasicCapabilities(overlayPlanningDrafts(sources, [input]));
      const invalid = caps.requirement.status === 'blocked' && caps.requirement.missing.find(x => x.code === 'COST_SCOPE_INVALID' || x.code === 'INPUT_INVALID');
      if (invalid) throw new Error(invalid.message);
      setError('');
      if (await saver.save(input)) onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor planning-contribution-dialog" aria-labelledby="contribution-cost-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 退休后续缴</p><h2 id="contribution-cost-heading">停工后，缴费的钱从哪里来？</h2></div><CloseButton type="button" aria-label="关闭续缴费用" disabled={saver.busy} onClick={onClose}/></header>
    <section className="form-block">
      <p>未来缴费安排：{pc.start_month ?? '开始月份待确认'} → {pc.stop_month ?? '停止月份待确认'}（停止月不再缴费）。</p>
      <p className="muted small">这里只确认停止工作后本人承担的现金费用。退休前的缴费应已扣在“每月能存的钱”里；金额按今天的购买力，不根据缴费基数猜测。</p>
      <FormRow label="退休后这笔费用怎么承担"><select aria-label="续缴费用处理方式" disabled={frozen} value={d.treatment} onChange={e => { const treatment = e.target.value as typeof d.treatment; setD(old => ({ ...old, treatment, monthly: ['external', 'excluded'].includes(treatment) ? '' : old.monthly })); }}>
        <option value="unknown">还不确定，保留待核对</option><option value="extra">本人支付，另外加在生活费上</option><option value="included">本人支付，已含在生活费里</option><option value="external">已确认由他人承担，无需本人支付</option><option value="excluded">这次先不计这笔费用</option>
      </select></FormRow>
      {!['external', 'excluded'].includes(d.treatment) && <FormRow label="本人每月支付" hint="包括本人需要支付的全部费用，不只是记入个人账户的8%；不清楚留空"><CentInput label="退休后每月续缴费用" disabled={frozen} value={d.monthly} onChange={monthly => setD(old => ({ ...old, monthly }))}/></FormRow>}
      {d.treatment !== 'excluded' && <FormRow label={d.treatment === 'external' ? '他人承担到哪个月停止' : '这笔费用到哪个月停止'} hint="停止月份不再付款；早于缴费结束时，剩余期间仍需核对"><MonthInput label="续缴费用停止月份" value={d.stop} min={pc.start_month ?? undefined} allowClear disabled={frozen} onChange={stop => setD(old => ({ ...old, stop }))}/></FormRow>}
      {d.treatment === 'included' && <p className="muted small">每月支付金额就是生活费里已经包含的部分；缴费开始前及结束后会释放这部分预算，不再重复加算。</p>}
      {d.treatment === 'excluded' && <p className="notice">养老金仍按未来继续缴费估算；忽略维持缴费的费用，可能让所需资金偏低。</p>}
      {(!pc.start_month || !pc.stop_month) && <p className="notice">未来缴费月份尚未确认。可先保存费用资料，再到退休收入里补齐缴费安排。</p>}
    </section>
    <section className="form-block" aria-label="续缴费用试算"><h3>按这次填写试算</h3>{preview && ['found', 'no_positive_contribution'].includes(preview.status) && 'monthly_cents' in preview ? <p>目标需要每月存约 {forecastMoney(preview.monthly_cents)}。</p> : <p>{previewError || '当前条件下暂未找到可行的月投入。'}</p>}<p className="muted small">尚未保存。未知金额或未覆盖的期间不会按零确认，结果仍带待核对说明。</p></section>
    {(error || saver.notice) && <p className="notice" role="alert">{error || saver.notice}</p>}
    <footer><button type="button" disabled={saver.busy} onClick={onClose}>取消</button><button className="primary" disabled={frozen}>{saver.busy ? '保存中…' : '保存续缴费用'}</button></footer>
  </form></dialog>;
}
