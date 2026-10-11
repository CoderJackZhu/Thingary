import type { StoredProfile } from './plan';
import { medicalCheck, medicalMessage, medicalYears } from './plan-medical';
import { medicalSource } from './plan-params';
export function MedicalCard({ profile, today }: { profile: StoredProfile; today: string }) {
  const m = medicalCheck(profile, profile.retire.basic, today);
  if (m.status === 'not_needed') return null;
  return <article className="ui-card ui-content" aria-label="医保缴费年限">
    <h3>医保缴费年限</h3>
    {m.status === 'unknown' ? <p>{medicalMessage(m, null)}</p> : <>
      <p>到法定退休时（{m.at_month}）累计约 {medicalYears(m.projected_months!)} 年 / 需要 {medicalYears(m.required_months!)} 年</p>
      {m.local_required_months! > 0 && <p>本地实际缴费约 {medicalYears(m.local_projected_months!)} 年 / 需要 {medicalYears(m.local_required_months!)} 年</p>}
      <p>{m.status === 'ok' ? '已满足' : `还差 ${m.short_months} 个月`}</p>
      {m.status === 'short' && <p className="notice">{medicalMessage(m, profile.medical_topup_cents)}</p>}
    </>}
    <p className="muted small">未来月数按目标里确认的缴费安排{profile.retire.basic?.pension_contributions.stop_month ? `（缴到 ${profile.retire.basic.pension_contributions.stop_month}）` : ''}计算，不随上面“停止缴费的年龄”的选择变化；假设在同一参保地继续缴，停止月份不再缴费。法定退休月份含已选择的弹性提前或延后。年限和待遇以办理时经办机构认定为准。</p>
    {profile.region === 'beijing' ? <p className="muted small"><a href={medicalSource.url} target="_blank" rel="noreferrer">{medicalSource.source}</a> · {medicalSource.publisher} · 已核对官方原文 · {medicalSource.checked_on}</p> : <p className="muted small">你填写的要求</p>}
  </article>;
}
