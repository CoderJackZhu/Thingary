import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import type { IncomeDraft } from './income-scope.ts';
import { t } from '../i18n.ts';
/** Temporary generic future income assumptions; never writes the saved plan. */
export function IncomeSection({ value, onChange }: { value: IncomeDraft; onChange: (value: IncomeDraft) => void }) {
  const setItem = (id: string, patch: Partial<IncomeDraft['items'][number]>) => onChange({ ...value, items: value.items.map(x => x.id === id ? { ...x, ...patch } : x) });
  const add = () => {
    let n = 1; while (value.items.some(x => x.id === `career-trial-${n}`)) n++;
    onChange({ ...value, items: [...value.items, { id: `career-trial-${n}`, name: '', role: 'other', included: true, monthly_cents: null, start_month: null, end_month: null, basis: 'start_month', basis_month: null, growth: 'fixed_nominal', source: null, source_checked_on: null, notes: '' }] });
  };
  return <section className="career-input" id="career-income"><h2>{t('本次未来收入怎么计入')}</h2>
    <FormRow label={t('本次收入口径')} hint={t('仅用于本次试算，关闭后丢弃；不会更改原计划。')}><select aria-label={t('本次未来收入口径')} value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as IncomeDraft['mode'] })}>
      <option value="saved">{t('沿用原计划选择')}</option><option value="manual">{t('使用手填的未来收入')}</option><option value="excluded">{t('本次不计未来收入')}</option>
    </select></FormRow>
    <label className="career-check"><input type="checkbox" checked={!!value.excludePools} onChange={e => onChange({ ...value, excludePools: e.target.checked })}/>{t('本次不计暂时取不出的钱转为可用资金（偏保守）')}</label>
    <p className="career-footnote">{t('养老金也只使用你从官方工具获取后填写的金额和月份，不计算资格、待遇或缴费变化。原有账户与盘点不会被更改。')}</p>
    {value.mode === 'manual' && <>
      {value.items.map((item, i) => <div key={item.id} className="career-income-item">
        <label className="career-check"><input type="checkbox" checked={item.included} onChange={e => setItem(item.id, { included: e.target.checked })}/>{t('计入')} {item.name || t('第 {v1} 笔收入', { v1: i + 1 })}</label>
        {item.included && <>
          <FormRow label={t('收入名称')}><input aria-label={t('第 {v1} 笔收入名称', { v1: i + 1 })} value={item.name} onChange={e => setItem(item.id, { name: e.target.value })}/></FormRow>
          <FormRow label={t('每月金额（元）')}><CentInput label={t('第 {v1} 笔未来月收入', { v1: i + 1 })} value={item.monthly_cents ?? ''} onChange={v => setItem(item.id, { monthly_cents: v === '' ? null : v })}/></FormRow>
          <FormRow label={t('开始月份')}><MonthInput label={t('第 {v1} 笔收入开始月份', { v1: i + 1 })} value={item.start_month ?? ''} onChange={v => setItem(item.id, { start_month: v || null })}/></FormRow>
          <FormRow label={t('结束月份')} hint={t('结束月仍计入；留空表示持续到规划终点。')}><MonthInput label={t('第 {v1} 笔收入结束月份', { v1: i + 1 })} value={item.end_month ?? ''} onChange={v => setItem(item.id, { end_month: v || null })}/></FormRow>
          <FormRow label={t('金额对应的月份')} hint={t('选择这笔收入按哪个月份的金额填写，用于统一购买力。')}><select aria-label={t('第 {v1} 笔收入金额基准', { v1: i + 1 })} value={item.basis} onChange={e => setItem(item.id, { basis: e.target.value as typeof item.basis })}><option value="start_month">{t('开始月份的金额')}</option><option value="reference_month">{t('指定月份的金额')}</option></select></FormRow>
          {item.basis === 'reference_month' && <MonthInput label={t('第 {v1} 笔收入基准月份', { v1: i + 1 })} value={item.basis_month ?? ''} onChange={v => setItem(item.id, { basis_month: v || null })}/>}
          <label className="career-check"><input type="checkbox" checked={item.growth === 'constant_purchasing_power'} onChange={e => setItem(item.id, { growth: e.target.checked ? 'constant_purchasing_power' : 'fixed_nominal' })}/>{t('随通胀变化，保持购买力（不选则账面金额不变）')}</label>
        </>}
        <button type="button" onClick={() => onChange({ ...value, items: value.items.filter(x => x.id !== item.id) })}>{t('删除此临时收入')}</button>
      </div>)}
      <button type="button" onClick={add}>{t('添加一笔临时未来收入')}</button>
    </>}
  </section>;
}
