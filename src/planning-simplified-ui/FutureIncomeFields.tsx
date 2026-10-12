import { useState } from 'react';
import { MonthInput, DateInput } from '../DateInput';
import { CentInput, FormRow, Segments, Switch } from '../FormControls';
import type { FieldIssueV1, FutureIncomeV1, TimeInputV1 } from '../plan-simplified-contract.ts';
import { ageToMonthV1, validMonthV1 } from '../plan-simplified.ts';
import { ageMonthsOf, basisSentence, issuesFor } from './income-view';
import { OfficialToolLink } from './OfficialToolLink';

/**
 * 单笔未来收入编辑。主层只有名称、金额、开始时间与是否计入；
 * 结束时间、金额基准、增长口径和来源放在「更多条件」，但默认口径常显（设计 §10.3）。
 * 未知金额／时间可留空保存为不完整安排，不装成 0 或完整结果。
 */
export function FutureIncomeFields({ value, reference, issues, busy, today, onOpenOfficial, onMerge, onCancel }: {
  value: FutureIncomeV1; reference: TimeInputV1['reference']; issues: FieldIssueV1[]; busy: boolean; today: string;
  onOpenOfficial?: (url: string) => boolean; onMerge: (next: FutureIncomeV1) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<FutureIncomeV1>(() => structuredClone(value));
  const [ageStart, setAgeStart] = useState('');
  const [err, setErr] = useState('');
  const patch = (v: Partial<FutureIncomeV1>) => setD(x => ({ ...x, ...v }));
  const own = issuesFor(issues, `future_incomes.${value.id}`);
  const convertStart = () => {
    const age = ageMonthsOf(ageStart, '');
    if (age === null) { setErr('年龄请填 0—120 的整数。'); return; }
    if (!reference) { setErr('先在时间安排里确认年龄参考，或直接填写开始年月。'); return; }
    try { setErr(''); patch({ start_month: ageToMonthV1(reference, age) }); } catch { setErr('换算月份超出范围，请直接填写开始年月。'); }
  };
  function done() {
    if (!d.name.trim()) { setErr('请填写名称。'); return; }
    if (d.monthly_cents !== null && (!/^(0|[1-9]\d*)$/.test(d.monthly_cents) || BigInt(d.monthly_cents) > 99999999999n)) { setErr('每月预计净到账金额须为非负金额，最多两位小数。未知请留空。'); return; }
    if (d.basis === 'reference_month' && !validMonthV1(d.basis_month ?? '')) { setErr('请确认购买力基准月，或改用「领取时的金额」。'); return; }
    setErr('');
    onMerge({ ...d, name: d.name.trim() });
  }
  return <div className="simplified-income-editor" role="group" aria-label="编辑未来收入">
    <FormRow label="名称">
      <input aria-label="收入名称" value={d.name} disabled={busy} placeholder={d.role === 'pension' ? '例如 养老金' : '例如 租金、企业年金'} onChange={e => patch({ name: e.target.value })}/>
    </FormRow>
    <FormRow label="这笔收入是什么" hint="养老金只影响是否显示官方工具链接">
      <select aria-label="收入类型" value={d.role} disabled={busy} onChange={e => patch({ role: e.target.value as FutureIncomeV1['role'] })}>
        <option value="pension">养老金</option><option value="other">其他固定收入</option>
      </select>
    </FormRow>
    {d.role === 'other' && <p className="muted small">已纳入规划的自有投资，其利息和分红包含在总回报假设里，不要在这里重复添加。这里只填养老金、租金等另外的净收入。</p>}
    <FormRow label="每月预计净到账金额" hint="留空表示还不知道；不知道不当作 0。官方测算结果由你自己填在这里">
      <CentInput signed label="每月预计净到账金额" value={d.monthly_cents ?? ''} disabled={busy} placeholder="例如 4000.00" onChange={v => patch({ monthly_cents: v === '' ? null : v })}/>
    </FormRow>
    <FormRow label="开始领取时间" hint="留空表示还没定；开始月在停止工作之前也只向前续算，不补发">
      <MonthInput yearIntent="long" label="开始领取时间" value={d.start_month ?? ''} disabled={busy} allowClear onChange={v => patch({ start_month: v === '' ? null : v })}/>
    </FormRow>
    {reference
      ? <div className="simplified-age-start">
        <label>习惯用年龄？几岁开始领取<input aria-label="开始领取年龄" inputMode="numeric" placeholder="例如 63" value={ageStart} disabled={busy} onChange={e => setAgeStart(e.target.value)}/></label>
        <button type="button" className="ui-btn" disabled={busy || ageStart.trim() === ''} onClick={convertStart}>换算成开始月份</button>
      </div>
      : <p className="muted small">想按年龄填写开始时间时，先在时间安排里确认年龄参考。</p>}
    <FormRow label="计入这项收入" hint="关掉后保留记录，本次计算不采用">
      <Switch label="计入这项收入" value={d.included} disabled={busy} onChange={v => patch({ included: v })}/>
    </FormRow>
    <p className="simplified-basis" role="status">{basisSentence(d)}</p>
    <details className="simplified-more">
      <summary>更多条件（结束时间、金额口径、来源）</summary>
      <div className="simplified-more-body">
        <FormRow label="结束时间" hint="留空：持续到规划终点">
          <MonthInput yearIntent="long" label="结束时间" value={d.end_month ?? ''} disabled={busy} allowClear onChange={v => patch({ end_month: v === '' ? null : v })}/>
        </FormRow>
        <FormRow label="金额按什么填写" hint="默认按领取时的金额，与官方测算数字更容易对应">
          <Segments label="金额按什么填写" value={d.basis} disabled={busy}
            options={[{ value: 'start_month', label: '领取时的金额' }, { value: 'reference_month', label: '某个月的购买力' }]}
            onChange={v => patch({ basis: v, basis_month: v === 'start_month' ? null : d.basis_month ?? today.slice(0, 7) })}/>
        </FormRow>
        {d.basis === 'reference_month' && <FormRow label="购买力基准月" hint="金额按这个月的购买力填写；保存后不随打开页面移动">
          <MonthInput yearIntent="past" label="购买力基准月" value={d.basis_month ?? ''} max={today.slice(0, 7)} disabled={busy} onChange={v => patch({ basis_month: v === '' ? null : v })}/>
        </FormRow>}
        <FormRow label="领取后的增长" hint="这是通用假设，不代表实际待遇调整">
          <Segments label="领取后的增长" value={d.growth} disabled={busy}
            options={[{ value: 'fixed_nominal', label: '固定金额' }, { value: 'constant_purchasing_power', label: '保持购买力' }]}
            onChange={v => patch({ growth: v })}/>
        </FormRow>
        <FormRow label="来源（选填）" hint="比如官方平台名称或自己备注的出处；不标为系统已核验">
          <input aria-label="收入来源" value={d.source ?? ''} disabled={busy} placeholder="例如 国家社会保险公共服务平台测算" onChange={e => patch({ source: e.target.value === '' ? null : e.target.value })}/>
        </FormRow>
        <FormRow label="来源核对日期（选填）">
          <DateInput yearIntent="past" label="来源核对日期" value={d.source_checked_on ?? ''} max={today} disabled={busy} allowClear onChange={v => patch({ source_checked_on: v === '' ? null : v })}/>
        </FormRow>
        <FormRow label="备注（选填）">
          <textarea aria-label="收入备注" value={d.notes} disabled={busy} rows={2} onChange={e => patch({ notes: e.target.value })}/>
        </FormRow>
      </div>
    </details>
    {d.role === 'pension' && <OfficialToolLink onOpen={onOpenOfficial}/>}
    {own.map(i => <p key={i.path} className="error" role="alert">{i.message}</p>)}
    {err && <p className="error" role="alert">{err}</p>}
    <div className="rs-actions">
      <button type="button" className="ui-btn" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="primary" disabled={busy} onClick={done}>完成</button>
    </div>
  </div>;
}
