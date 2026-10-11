// 资金流动核对窗（设计 docs/PRODUCT_BOUNDARIES_DESIGN.md §13.2）：两个金额 + 一次完整性确认。
// 受控组件：草稿由父级持有（onDraftChange 只改内存，关闭不存草稿）；onSubmit 表达
// 提交意图，真正的保存／回执由端口背后的 Store 负责。金额输入只在元文本与分字符
// 串之间转换，损益永远不在此计算。
import { useEffect, useId, useRef, useState } from 'react';
import type { FieldIssueV1, FlowDraft, InvestmentReviewInputV1 } from './model.ts';
import {
  centsFromYuanText,
  draftIssues,
  formatCents,
  intervalLabel,
  kindLabel,
  yuanTextFromCents,
} from './model.ts';

function FlowAmountInput({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string; // 规范分字符串；'' = 未知
  disabled: boolean;
  onChange: (cents: string) => void;
}) {
  const [raw, setRaw] = useState(() => yuanTextFromCents(value));
  const hintId = useId();
  useEffect(() => {
    // 外部值变化（如重新打开带值）时同步显示；当前文本等价则不打断输入。
    if ((centsFromYuanText(raw) ?? null) !== value) setRaw(yuanTextFromCents(value));
  }, [value]);
  return (
    <div className="ivr-field">
      <label className="ivr-field-label">
        {label}
        <input
          className="ivr-amount"
          aria-label={label}
          aria-describedby={hintId}
          inputMode="decimal"
          placeholder="未知可先留空"
          disabled={disabled}
          value={raw}
          onChange={e => {
            const next = e.target.value;
            const cents = centsFromYuanText(next);
            if (cents === null) return; // 非法输入不更新，也不丢已有草稿
            setRaw(next);
            onChange(cents);
          }}
        />
      </label>
      {hint && (
        <p className="ivr-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function InvestmentFlowDialog({
  input,
  initial,
  issues,
  busy = false,
  onDraftChange,
  onSubmit,
  onCancel,
}: {
  input: InvestmentReviewInputV1 | null;
  initial: FlowDraft;
  /** 上次提交被领域端口拒绝时返回的字段问题。 */
  issues: FieldIssueV1[];
  busy?: boolean;
  onDraftChange: (draft: FlowDraft) => void;
  onSubmit: (draft: FlowDraft) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [localIssues, setLocalIssues] = useState<FieldIssueV1[]>([]);
  useEffect(() => {
    dialogRef.current?.showModal();
    return () => dialogRef.current?.close();
  }, []);
  const patch = (fields: Partial<FlowDraft>) => onDraftChange({ ...initial, ...fields });

  function submit() {
    if (busy) return;
    const local = draftIssues(initial);
    if (local.length) {
      setLocalIssues(local);
      return;
    }
    setLocalIssues([]);
    onSubmit(initial);
  }

  const toById = new Map((input?.to.members ?? []).map(m => [m.account_id, m]));
  return (
    <dialog
      ref={dialogRef}
      className="ivr-dialog"
      aria-labelledby="ivr-flow-heading"
      onCancel={e => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        noValidate
        onSubmit={e => {
          e.preventDefault();
          submit();
        }}
      >
        <header className="ivr-dialog-head">
          <div>
            <p className="ivr-eyebrow">规划 · 收入与复盘</p>
            <h3 id="ivr-flow-heading">核对资金流动</h3>
            {input ? (
              <p className="ivr-meta">
                区间 {intervalLabel(input.from.date, input.to.date)}（含期末、不含期初）· 投资范围{' '}
                {input.from.members.length} 个账户
              </p>
            ) : (
              <p className="ivr-meta">区间资料不可用，请从复盘页重新打开。</p>
            )}
          </div>
          <button type="button" className="ivr-close" aria-label="关闭资金流动核对" disabled={busy} onClick={onCancel}>
            ×
          </button>
        </header>

        {input && (
          <table className="ivr-table ivr-dialog-accounts">
            <thead>
              <tr>
                <th scope="col">账户</th>
                <th scope="col">类型</th>
                <th scope="col">计入</th>
                <th scope="col">期初余额</th>
                <th scope="col">期末余额</th>
              </tr>
            </thead>
            <tbody>
              {input.from.members.map(m => {
                const to = toById.get(m.account_id);
                return (
                  <tr key={m.account_id} className={m.counted ? undefined : 'ivr-uncounted'}>
                    <td>{m.account_id}</td>
                    <td>{kindLabel[m.kind]}</td>
                    <td>{m.counted ? '计入' : '不计入'}</td>
                    <td className="ivr-num">{m.amount_cents === null ? '未知' : formatCents(m.amount_cents)}</td>
                    <td className="ivr-num">{!to ? '—' : to.amount_cents === null ? '未知' : formatCents(to.amount_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <FlowAmountInput
          label="期间从范围外转入的资金合计（元）"
          hint="不含已留在范围内的利息／分红；本人投资账户之间互转在组合内抵消，不填入。"
          value={initial.inflow}
          disabled={busy}
          onChange={cents => patch({ inflow: cents })}
        />
        <FlowAmountInput
          label="期间转到范围外的资金合计（元）"
          hint="包含取回资金及转出的现金收益（转到范围外的分红已包含在内，不再另加）；不含应计入损益的投资手续费／税费。"
          value={initial.outflow}
          disabled={busy}
          onChange={cents => patch({ outflow: cents })}
        />

        <label className="ivr-choice">
          <input
            type="checkbox"
            disabled={busy}
            checked={initial.unsupported}
            onChange={e => patch({ unsupported: e.target.checked })}
          />
          <span>
            期间有证券实物转入转出、杠杆借款或未解释的余额调整
            <span className="ivr-muted">（可保存备注，但勾选后不能确认简单损益完整）</span>
          </span>
        </label>
        <label className="ivr-choice">
          <input
            type="checkbox"
            disabled={busy || initial.unsupported}
            checked={initial.confirmed && !initial.unsupported}
            onChange={e => patch({ confirmed: e.target.checked })}
          />
          <span>
            已核对这一期间全部转入转出
            <span className="ivr-muted">（金额可先留空保存；确认完整时零也必须显式填 0，留空表示未知）</span>
          </span>
        </label>

        <label className="ivr-field-label">
          备注（选填）
          <textarea
            aria-label="资金流动备注"
            disabled={busy}
            value={initial.notes}
            onChange={e => patch({ notes: e.target.value })}
          />
        </label>

        {(localIssues.length > 0 || issues.length > 0) && (
          <div className="ivr-notice" role="alert">
            {(localIssues.length ? localIssues : issues).map(i => (
              <p key={i.path + i.code}>
                {i.path ? `${i.path}：` : ''}
                {i.message}
              </p>
            ))}
          </div>
        )}

        <footer className="ivr-dialog-foot">
          <button type="button" className="ivr-btn" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="ivr-btn ivr-primary" disabled={busy}>
            {busy ? '保存中…' : '保存核对结果'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
