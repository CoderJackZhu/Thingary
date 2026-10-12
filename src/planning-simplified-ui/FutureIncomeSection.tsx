import { useEffect, useId, useState } from 'react';
import { Switch } from '../FormControls';
import type { FieldIssueV1, FutureIncomeV1, SimplifiedPlanningFieldsV1 } from '../plan-simplified-contract.ts';
import { basisSentence, duplicateNameIds, excludedIncomeNote, incomeState, incomeStateText, newIncome, startText, yuanText } from './income-view';
import { FutureIncomeFields } from './FutureIncomeFields';

/**
 * 第四问「以后还有哪些固定收入」：暂不计入／填写预计收入二选一，
 * 养老金是一种收入名称／角色，没有职工估算、地区参数或社保资料分支（设计 §4.2、§10.2）。
 * 删除收入只删除预测安排，不删除实际收入记录或金融账户。
 */
export function FutureIncomeSection({ fields, issues, busy, today, onOpenOfficial, onDraftChange, onEditingChange }: {
  fields: SimplifiedPlanningFieldsV1; issues: FieldIssueV1[]; busy: boolean; today: string;
  onOpenOfficial?: (url: string) => boolean; onDraftChange: (f: SimplifiedPlanningFieldsV1) => void; onEditingChange?: (active: boolean) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<FutureIncomeV1 | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const modeName = useId();
  const isEditing = adding !== null || editingId !== null;
  useEffect(() => { onEditingChange?.(isEditing); }, [isEditing, onEditingChange]);
  const mode = fields.income_mode;
  const patch = (v: Partial<SimplifiedPlanningFieldsV1>) => onDraftChange({ ...fields, ...v });
  const patchIncome = (id: string, v: Partial<FutureIncomeV1>) => patch({ future_incomes: fields.future_incomes.map(i => i.id === id ? { ...i, ...v } : i) });
  const note = excludedIncomeNote(fields);
  const duplicates = duplicateNameIds(fields);
  return <section className="form-block" aria-label="未来收入">
    <div className="plan-income-modes" role="radiogroup" aria-label="未来收入计入方式">
      <label className="plan-choice"><input type="radio" name={modeName} aria-label="暂不计入" checked={mode === 'excluded'} disabled={busy || isEditing} onChange={() => patch({ income_mode: 'excluded' })}/><span><strong>暂不计入（推荐先这样）</strong><small>先看只靠自己准备需要多少，之后随时可以加回来。</small></span></label>
      <label className="plan-choice"><input type="radio" name={modeName} aria-label="填写预计收入" checked={mode === 'manual'} disabled={busy || isEditing} onChange={() => patch({ income_mode: 'manual' })}/><span><strong>填写预计收入</strong><small>添加养老金或其他固定收入；金额和开始时间没定也可以先记着。</small></span></label>
      {mode === 'unconfirmed' && <p className="muted small">先选择本次怎么处理未来收入；没选时不会给出完整规划结论。</p>}
    </div>
    {mode === 'manual' && <>
      {fields.future_incomes.length === 0 && !adding && <p className="muted small">还没有添加收入。例如养老金、企业年金或租金。</p>}
      {fields.future_incomes.map(i => <div key={i.id} className="simplified-income-row">
        <div className="simplified-income-main">
          <div className="simplified-income-title"><strong>{i.name || '（未命名）'}</strong><span className="state">{incomeStateText[incomeState(i)]}</span></div>
          <div>{startText(i)} · {yuanText(i.monthly_cents)}{incomeState(i) === 'counted' ? '/月' : ''}</div>
          <small className="muted">{basisSentence(i)}</small>
        </div>
        <Switch label={`计入${i.name || '这项收入'}`} value={i.included} disabled={busy || isEditing} onChange={v => patchIncome(i.id, { included: v })}/>
        <div className="simplified-income-actions">
          <button type="button" disabled={busy || isEditing} onClick={() => { setEditingId(i.id); setAdding(null); setPendingDelete(null); }}>修改</button>
          {pendingDelete === i.id
            ? <><button type="button" className="danger" disabled={busy || isEditing} onClick={() => { patch({ future_incomes: fields.future_incomes.filter(x => x.id !== i.id) }); setPendingDelete(null); setEditingId(null); }}>确认删除</button><button type="button" disabled={busy || isEditing} onClick={() => setPendingDelete(null)}>不删</button></>
            : <button type="button" disabled={busy || isEditing} onClick={() => setPendingDelete(i.id)}>删除</button>}
        </div>
        {editingId === i.id && <FutureIncomeFields key={i.id} value={i} reference={fields.time.reference} issues={issues} busy={busy} today={today} onOpenOfficial={onOpenOfficial}
          onCancel={() => setEditingId(null)} onMerge={next => { patchIncome(i.id, next); setEditingId(null); }}/>}
      </div>)}
      {adding && <FutureIncomeFields key={adding.id} value={adding} reference={fields.time.reference} issues={issues} busy={busy} today={today} onOpenOfficial={onOpenOfficial}
        onCancel={() => setAdding(null)}
        onMerge={next => { patch({ future_incomes: [...fields.future_incomes, next] }); setAdding(null); }}/>}
      <div className="simplified-income-add">
        <button type="button" className="ui-btn" disabled={busy || isEditing} onClick={() => { setAdding(newIncome('pension')); setEditingId(null); setPendingDelete(null); }}>+ 养老金</button>
        <button type="button" className="ui-btn" disabled={busy || isEditing} onClick={() => { setAdding(newIncome('other')); setEditingId(null); setPendingDelete(null); }}>+ 其他收入</button>
      </div>
      {note && <p className="notice" role="status">{note}</p>}
      {duplicates.length > 0 && <p className="muted small">有名称相同的收入（靠记录区分，不自动合并）；保存前请核对是不是重复录入。</p>}
    </>}
  </section>;
}
