import { useState } from 'react';
import { useDirtyGuard, useFormChanged } from '../nav-context';
import { invoke } from '@tauri-apps/api/core';
import { incomeCategories, isInvestmentIncome } from '../../income-classification';
import type { Income, IncomeFields, IncomeList } from '../../plan';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, DateField, DeleteSheet, FormGroup, FormRow, MoneyField, SelectField, Switch, TextAreaField } from '../ui';
import { blankIncome, changeIncomeCategory, incomeSave, validateIncome } from './forms';
import { dayLabel } from '../format';
import { EditorFrame, Loaded } from './parts';
import { trash, useRead, useSaver } from './read';
import { t } from '../../i18n.ts';
/** spending.incomeEdit: record or correct an income that actually arrived. */
export default function IncomeEdit({ params }: PageProps) {
  const id = typeof params.id === 'string' ? params.id : null;
  const read = useRead(async () => {
    const [list, defaults] = await Promise.all([invoke<IncomeList>('plan_income_list'), invoke<{ generation: string; hpf_cents: string | null }>('plan_income_defaults')]);
    const income = id ? list.rows.find(r => r.id === id) ?? null : null;
    if (id && !income) throw new Error(t('这条收入已不存在，可能已被删除。'));
    return { generation: list.generation, income, hpfDefault: defaults.hpf_cents ?? '' };
  }, id ?? 'new');
  return <Loaded nav read={read} what={t('收入')}>{data => <Form generation={data.generation} income={data.income} hpfDefault={data.hpfDefault}/>}</Loaded>;
}

function Form({ generation, income, hpfDefault }: { generation: string; income: Income | null; hpfDefault: string }) {
  const { today } = useSession(), saver = useSaver();
  const [f, setF] = useState<IncomeFields>(() => income?.fields ?? blankIncome(today, hpfDefault)), [problem, setProblem] = useState(''), [asking, setAsking] = useState(false);
  useDirtyGuard(useFormChanged(f));
  const [confirmed, setConfirmed] = useState(false), [edited, setEdited] = useState(false);
  const set = (patch: Partial<IncomeFields>) => { setProblem(''); setF(x => ({ ...x, ...patch })); };
  const investment = isInvestmentIncome(f), changed = investment && !isInvestmentIncome(income?.fields ?? {}) && f.hpf_cents !== null;
  function save() {
    const check = validateIncome(f, { original: income?.fields ?? null, depositConfirmed: confirmed });
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'plan_income_save', input: incomeSave(f, income, generation, requestId), label: t('收入 {date}', { date: f.date }) }), { close: true });
  }
  const remove = () => income && void saver.run(requestId => trash('income', income.id, income.revision, generation, t('收入 {date}', { date: f.date }), requestId), { close: true });
  return <EditorFrame title={income ? t('编辑收入') : t('记一笔收入')} onSave={save} busy={saver.busy} error={problem || (asking ? '' : saver.error)}>
    <p className="sp-note sp-note-pad">{t('记录实际到账的税后收入和公积金缴存，同日可多笔。缴存留空表示未知，填 0 表示明确没有。')}</p>
    <FormGroup footer={t('转入本金不属于收入，账户涨跌也不记在这里；旧记录保留未分类，不自动判断为工资。')}>
      <DateField label={t('到账日期')} value={f.date} max={today} onChange={v => set({ date: v })} disabled={saver.busy}/>
      <SelectField label={t('来源分类')} value={f.category ?? 'unclassified'} onChange={v => { setProblem(''); setConfirmed(false); setF(x => changeIncomeCategory(x, v as NonNullable<IncomeFields['category']>, !income, edited)); }}
        options={Object.entries(incomeCategories).map(([id, label]) => ({ id, label }))} disabled={saver.busy}/>
      <MoneyField label={t('税后到账')} value={f.net_cents} onChange={v => set({ net_cents: v })} hint={t('实际收到的净额；没有到账就填 0')} disabled={saver.busy}/>
      {(!investment || f.hpf_cents !== null) && <MoneyField label={t('公积金缴存')} value={f.hpf_cents ?? ''} onChange={v => { setEdited(true); set({ hpf_cents: v === '' ? null : v }); }} hint={!income && hpfDefault ? t('已带入最新一条的已知金额，可改；留空表示未知') : t('个人与单位合计；留空表示未知')} disabled={saver.busy}/>}
      {changed && <FormRow label={t('保留已有公积金缴存事实')}><Switch label={t('确认保留已有公积金缴存事实')} checked={confirmed} onChange={setConfirmed} disabled={saver.busy}/></FormRow>}
    </FormGroup>
    <FormGroup><TextAreaField label={t('备注')} value={f.notes ?? ''} onChange={notes => set({ notes })} disabled={saver.busy}/></FormGroup>
    {income && <Button variant="danger" block disabled={saver.busy} onClick={() => setAsking(true)}>{t('删除这条收入')}</Button>}
    {asking && <DeleteSheet name={t('{v1}的收入', { v1: dayLabel(f.date, today) })} busy={saver.busy} error={saver.error} onClose={() => setAsking(false)} onConfirm={remove}/>}
  </EditorFrame>;
}
