import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { incomeCategories, isInvestmentIncome } from '../../income-classification';
import type { Income, IncomeFields, IncomeList } from '../../plan';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, DateField, FormGroup, FormRow, MoneyField, SelectField, Switch, TextAreaField } from '../ui';
import { blankIncome, changeIncomeCategory, incomeSave, validateIncome } from './forms';
import { ConfirmSheet, EditorFrame, Loaded } from './parts';
import { trash, useRead, useSaver } from './read';

/** spending.incomeEdit: record or correct an income that actually arrived. */
export default function IncomeEdit({ params }: PageProps) {
  const id = typeof params.id === 'string' ? params.id : null;
  const read = useRead(async () => {
    const [list, defaults] = await Promise.all([invoke<IncomeList>('plan_income_list'), invoke<{ generation: string; hpf_cents: string | null }>('plan_income_defaults')]);
    const income = id ? list.rows.find(r => r.id === id) ?? null : null;
    if (id && !income) throw new Error('这条收入已不存在，可能已被删除。');
    return { generation: list.generation, income, hpfDefault: defaults.hpf_cents ?? '' };
  }, id ?? 'new');
  return <Loaded read={read} what="收入">{data => <Form generation={data.generation} income={data.income} hpfDefault={data.hpfDefault}/>}</Loaded>;
}

function Form({ generation, income, hpfDefault }: { generation: string; income: Income | null; hpfDefault: string }) {
  const { today } = useSession(), saver = useSaver();
  const [f, setF] = useState<IncomeFields>(() => income?.fields ?? blankIncome(today, hpfDefault)), [problem, setProblem] = useState(''), [asking, setAsking] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [edited, setEdited] = useState(false);
  const set = (patch: Partial<IncomeFields>) => { setProblem(''); setF(x => ({ ...x, ...patch })); };
  const investment = isInvestmentIncome(f), changed = investment && !isInvestmentIncome(income?.fields ?? {}) && f.hpf_cents !== null;
  function save() {
    const check = validateIncome(f, { original: income?.fields ?? null, depositConfirmed: confirmed });
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'plan_income_save', input: incomeSave(f, income, generation, requestId), label: `收入 ${f.date}` }), { close: true });
  }
  const remove = () => income && void saver.run(requestId => trash('income', income.id, income.revision, generation, `收入 ${f.date}`, requestId), { close: true });
  return <EditorFrame title={income ? '编辑收入' : '记一笔收入'} onSave={save} busy={saver.busy} error={problem || (asking ? '' : saver.error)}>
    <p className="sp-note sp-note-pad">记录实际到账的税后收入和公积金缴存，同日可多笔。缴存留空表示未知，填 0 表示明确没有。</p>
    <FormGroup footer="转入本金不属于收入，账户涨跌也不记在这里；旧记录保留未分类，不自动判断为工资。">
      <DateField label="到账日期" value={f.date} max={today} onChange={v => set({ date: v })} disabled={saver.busy}/>
      <SelectField label="来源分类" value={f.category ?? 'unclassified'} onChange={v => { setProblem(''); setConfirmed(false); setF(x => changeIncomeCategory(x, v as NonNullable<IncomeFields['category']>, !income, edited)); }}
        options={Object.entries(incomeCategories).map(([id, label]) => ({ id, label }))} disabled={saver.busy}/>
      <MoneyField label="税后到账" value={f.net_cents} onChange={v => set({ net_cents: v })} hint="实际收到的净额；没有到账就填 0" disabled={saver.busy}/>
      {(!investment || f.hpf_cents !== null) && <MoneyField label="公积金缴存" value={f.hpf_cents ?? ''} onChange={v => { setEdited(true); set({ hpf_cents: v === '' ? null : v }); }} hint={!income && hpfDefault ? '已带入最新一条的已知金额，可改；留空表示未知' : '个人与单位合计；留空表示未知'} disabled={saver.busy}/>}
      {changed && <FormRow label="保留已有公积金缴存事实"><Switch label="确认保留已有公积金缴存事实" checked={confirmed} onChange={setConfirmed} disabled={saver.busy}/></FormRow>}
    </FormGroup>
    <FormGroup><TextAreaField label="备注" value={f.notes ?? ''} onChange={notes => set({ notes })} disabled={saver.busy}/></FormGroup>
    {income && <Button variant="danger" block disabled={saver.busy} onClick={() => setAsking(true)}>删除这条收入</Button>}
    {asking && <ConfirmSheet title="删除这条收入？" confirm="移入最近删除" danger busy={saver.busy} error={saver.error} onClose={() => setAsking(false)} onConfirm={remove} message={`${f.date} 的这条收入会移入最近删除，可以恢复。`}/>}
  </EditorFrame>;
}
