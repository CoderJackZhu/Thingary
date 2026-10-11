// 投资区间复盘展示卡（契约 docs/PLANNING_SIMPLIFICATION_CONTRACT.md §4；设计 §10.5/§13.3）。
// 只渲染注入端口给出的 Input/Result：本组件不计算损益、不汇总两端余额、
// 不拼接内容键；余额变化与损益一律来自端口返回的领域结果。
import { useMemo } from 'react';
import type { InvestmentReviewInputV1 } from './model.ts';
import {
  formatCents,
  formatSignedCents,
  intervalLabel,
  kindLabel,
  parseReviewInput,
  parseReviewResult,
  reasonLabel,
  statusLabel,
} from './model.ts';

export type ReviewOuter =
  | { status: 'loading' }
  | { status: 'error'; code: string; message: string }
  | { status: 'empty' }
  | { status: 'ready'; input: unknown; result: unknown };

function ScopeTable({ input }: { input: InvestmentReviewInputV1 }) {
  const toById = new Map(input.to.members.map(m => [m.account_id, m]));
  return (
    <table className="ivr-table">
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
  );
}

function ReasonList({ reasons }: { reasons: string[] }) {
  return (
    <ul className="ivr-reasons">
      {reasons.map(r => (
        <li key={r}>{reasonLabel[r] ?? r}</li>
      ))}
    </ul>
  );
}

function ChangeLine({ change }: { change: string | null }) {
  const text = formatSignedCents(change);
  if (text === null) return null;
  return (
    <p className="ivr-change">
      本期余额变化 {text}（含资金流动和估值，不等于投资损益）
    </p>
  );
}

export function InvestmentReviewCard({
  outer,
  onCheckFlow,
  onEditFlow,
  disabled = false,
}: {
  outer: ReviewOuter;
  /** 尚无流动记录时打开核对窗口。 */
  onCheckFlow?: () => void;
  /** 已有记录但需复核时重新核对。 */
  onEditFlow?: () => void;
  disabled?: boolean;
}) {
  const parsedInput = useMemo(() => (outer.status === 'ready' ? parseReviewInput(outer.input) : null), [outer]);
  const parsedResult = useMemo(() => (outer.status === 'ready' ? parseReviewResult(outer.result) : null), [outer]);

  if (outer.status === 'loading')
    return (
      <div className="ivr-state" role="status" aria-busy="true">
        投资区间核对读取中…
      </div>
    );
  if (outer.status === 'error')
    return (
      <div className="ivr-state ivr-error" role="alert">
        <h3>投资区间核对读取失败</h3>
        <p>{outer.message}</p>
        <p className="ivr-muted">
          错误码：{outer.code}。读取失败与未记录、不可比较是不同状态，可在来源处重试。
        </p>
      </div>
    );
  if (outer.status === 'empty')
    return (
      <div className="ivr-state" role="status">
        <h3>本期还没有可比较的投资盘点</h3>
        <p className="ivr-muted">需要两次完整盘点中的同一投资范围才能核对区间损益；没有投资账户时也不用填写资金流动。</p>
      </div>
    );
  if (parsedInput && !parsedInput.ok)
    return (
      <div className="ivr-state ivr-error" role="alert">
        <h3>投资区间输入无法识别</h3>
        <ul>
          {parsedInput.issues.slice(0, 8).map(i => (
            <li key={i.path + i.code}>
              {i.path || '（根）'}：{i.message}
            </li>
          ))}
        </ul>
      </div>
    );
  if (parsedResult && !parsedResult.ok)
    return (
      <div className="ivr-state ivr-error" role="alert">
        <h3>投资区间结果无法识别</h3>
        <ul>
          {parsedResult.issues.slice(0, 8).map(i => (
            <li key={i.path + i.code}>
              {i.path || '（根）'}：{i.message}
            </li>
          ))}
        </ul>
      </div>
    );
  if (!parsedInput || !parsedResult) return null;
  const input = parsedInput.value;
  const result = parsedResult.value;

  return (
    <section className="ivr-card" aria-label="投资账户区间核对">
      <header className="ivr-head">
        <div>
          <p className="ivr-eyebrow">规划 · 收入与复盘</p>
          <h3>投资账户：期初 → 期末</h3>
          <p className="ivr-meta">
            区间 {intervalLabel(input.from.date, input.to.date)} · 投资范围 {input.from.members.length} 个账户
          </p>
        </div>
      </header>
      <ScopeTable input={input} />

      <div className="ivr-result" aria-live="polite">
        {result.status === 'ready' && (
          <>
            <p className="ivr-profit">
              区间投资损益 <strong>{formatSignedCents(result.value.profit_cents)}</strong>
              <span className="ivr-muted">（含估值变化、已反映的利息分红与费用；不是收益率）</span>
            </p>
            <details className="ivr-basis">
              <summary>查看依据</summary>
              <table className="ivr-table">
                <tbody>
                  <tr>
                    <th scope="row">期初投资总值</th>
                    <td className="ivr-num">{formatCents(result.value.opening_cents)}</td>
                    <th scope="row">期末投资总值</th>
                    <td className="ivr-num">{formatCents(result.value.closing_cents)}</td>
                  </tr>
                  <tr>
                    <th scope="row">余额变化</th>
                    <td className="ivr-num">{formatSignedCents(result.value.change_cents)}</td>
                    <th scope="row">期间外部转入</th>
                    <td className="ivr-num">{formatCents(result.value.inflow_cents)}</td>
                  </tr>
                  <tr>
                    <th scope="row">期间对外转出</th>
                    <td className="ivr-num">{formatCents(result.value.outflow_cents)}</td>
                    <th scope="row">计算式</th>
                    <td>期末 − 期初 − 转入 + 转出</td>
                  </tr>
                </tbody>
              </table>
              <p className="ivr-muted">已记录的分红／利息只作核对线索，不在总损益上再加一次。</p>
            </details>
          </>
        )}

        {result.status === 'not_recorded' && (
          <>
            <p className="ivr-statusline">
              <span className="ivr-badge">未记录</span>
              未填写这一期间的投入与转出，暂不能区分投资损益。
            </p>
            <ChangeLine change={result.change_cents} />
            <ReasonList reasons={result.reasons} />
            {onCheckFlow && (
              <button type="button" className="ivr-btn" disabled={disabled} onClick={onCheckFlow}>
                核对资金流动
              </button>
            )}
          </>
        )}

        {result.status === 'needs_review' && (
          <>
            <p className="ivr-statusline">
              <span className="ivr-badge ivr-warn">待复核</span>
              损益暂不可用，需要先完成核对：
            </p>
            <ChangeLine change={result.change_cents} />
            <ReasonList reasons={result.reasons} />
            {(onEditFlow ?? onCheckFlow) && (
              <button
                type="button"
                className="ivr-btn"
                disabled={disabled}
                onClick={() => (onEditFlow ?? onCheckFlow)!()}
              >
                重新核对资金流动
              </button>
            )}
          </>
        )}

        {result.status === 'not_comparable' && (
          <>
            <p className="ivr-statusline">
              <span className="ivr-badge ivr-warn">不可比较</span>
              本期投资范围不可比较，不计算区间损益，也不默认零收益。
            </p>
            <ReasonList reasons={result.reasons} />
            <p className="ivr-muted">仍可查看上方逐账户余额事实；范围恢复一致后才能核对损益。</p>
          </>
        )}

        {result.status === 'invalid' && (
          <>
            <p className="ivr-statusline">
              <span className="ivr-badge ivr-error">输入无效</span>
              领域拒绝了本次输入，请核对以下字段后重试：
            </p>
            <ul className="ivr-reasons">
              {result.issues.map(i => (
                <li key={i.path + i.code}>
                  {i.path}：{i.message}
                </li>
              ))}
            </ul>
            {(onEditFlow ?? onCheckFlow) && (
              <button
                type="button"
                className="ivr-btn"
                disabled={disabled}
                onClick={() => (onEditFlow ?? onCheckFlow)!()}
              >
                重新核对资金流动
              </button>
            )}
          </>
        )}
      </div>

      {input.flow && (
        <p className="ivr-muted ivr-flownote">
          已有核对记录（{statusLabel[result.status]}
          ）：期间外部转入 {input.flow.inflow_cents === null ? '未知' : formatCents(input.flow.inflow_cents)}、对外转出{' '}
          {input.flow.outflow_cents === null ? '未知' : formatCents(input.flow.outflow_cents)}
          {input.flow.confirmed_complete ? '，已确认完整' : '，尚未确认完整'}。
        </p>
      )}
    </section>
  );
}
