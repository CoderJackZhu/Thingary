import { useEffect, useRef, useState } from 'react';
import { errorMessage, money } from '../asset';
import { CurrencyInput } from '../CurrencyInput';
import { HoldingInput } from '../HoldingInput';
import { currencyAmount, currencyCode, currencyDecimals } from '../currency';
import { enterJumpsAmount, kindLabel, quickFact, storedPending, submit } from '../wealth';
import type { Account, Draft, Pending, Summary } from '../wealth';
import { availableAccounts, balanceRequests, emptyBalance, saveInOrder } from './model';
import type { BalanceInput } from './model';

export function CheckInPage({ accounts, summary, draft, today, blocked, settled, onBusy, onPending, onReload, onNew }: { accounts: Account[]; summary: Summary; draft: Draft; today: string; blocked: boolean; settled: Pending | null; onBusy: (busy: boolean) => void; onPending: () => void; onReload: () => void; onNew: () => void }) {
  const [values, setValues] = useState<Record<string, BalanceInput>>({});
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    if (settled?.command !== 'wealth_quick_update' || !('changes' in settled.input)) return;
    const ids = settled.input.changes.map(change => change.account_id);
    setValues(old => Object.fromEntries(Object.entries(old).filter(([id]) => !ids.includes(id))));
    setError(''); setMessage('已确认该账户保存成功。剩余输入已保留，请核对后继续。');
  }, [settled]);
  const available = availableAccounts(accounts, summary.points, draft, today);
  const dirty = Object.keys(values).length;
  function update(id: string, key: keyof BalanceInput, value: string) { setValues(old => ({ ...old, [id]: { ...(old[id] ?? emptyBalance()), [key]: value } })); setError(''); }
  async function save() {
    if (sending.current || blocked || storedPending() || !dirty) return;
    setError(''); setMessage('');
    let requests;
    try { requests = balanceRequests(draft, available, values, () => crypto.randomUUID()); if (requests.length !== dirty) throw new Error('账户范围已变化，请取消本次输入后重新读取。'); }
    catch (cause) { setError(errorMessage(cause)); return; }
    sending.current = true; setBusy(true); onBusy(true);
    let saved = 0;
    try {
      await saveInOrder(requests, input => submit({ command: 'wealth_quick_update', input, label: `盘点 · ${accounts.find(a => a.id === input.changes[0].account_id)?.fields.name ?? '账户'}` }), id => {
        saved++; setValues(old => { const next = { ...old }; delete next[id]; return next; });
        setMessage(`已保存 ${saved} / ${requests.length} 个账户。`);
      });
      setMessage(`已保存 ${saved} 个账户。未填写的账户沿用已有金额，没有金额的仍为未知。`);
    } catch (cause) {
      setError(`已确认保存 ${saved} / ${requests.length} 个账户；已停止后续提交。${errorMessage(cause)}`);
      onPending();
    } finally { sending.current = false; setBusy(false); onBusy(false); onReload(); }
  }
  return <>
    <div className="mobile-row mobile-section-heading"><p className="mobile-caption">本次盘点 <time>{today}</time></p><button type="button" disabled={blocked || busy} onClick={onNew}>添加账户</button></div>
    {!accounts.length ? <section className="mobile-card mobile-placeholder"><h2>从第一个账户开始</h2><p className="mobile-muted">银行卡、基金、公积金，或信用卡欠款。先建账户，再填写余额。</p><button className="mobile-primary mobile-wide" disabled={blocked} onClick={onNew}>新建账户</button></section> : !available.length ? <section className="mobile-card"><h2>今天没有可更新的账户</h2><p className="mobile-muted">账户可能尚未启用、已经停用，或已有晚于今天的盘点。</p></section> : <form noValidate onSubmit={e => { e.preventDefault(); void save(); }} onKeyDown={e => {
      if (!enterJumpsAmount(e.key, e.nativeEvent.isComposing, e.target instanceof HTMLInputElement)) return;
      e.preventDefault();
      const fields = [...e.currentTarget.querySelectorAll<HTMLInputElement>('input:not(:disabled)')];
      fields[fields.indexOf(e.target as HTMLInputElement) + 1]?.focus();
    }}>
      <p className="mobile-caption">填写新余额，零余额明确填 0；留空的账户保留原状态。</p>
      {draft.existing && <p className="mobile-notice">今天已有盘点，本次更新会更正同一天的记录。</p>}
      {available.map(account => {
        const input = values[account.id] ?? emptyBalance(), code = currencyCode(account.fields.currency), fact = quickFact(draft, account.id);
        const prior = fact?.amount_cents == null ? '未知' : code !== 'CNY' && fact.original_minor != null ? currencyAmount(code, fact.original_minor) : money(fact.amount_cents);
        return <section className="mobile-card mobile-account" key={account.id} aria-label={account.fields.name}>
          <h2>{account.fields.name}</h2><p className="mobile-caption">{kindLabel(account.fields.kind)}{account.fields.institution ? ` · ${account.fields.institution}` : ''}{!account.fields.counted ? ' · 不计入净资产' : ''}</p>
          <p className="mobile-prior">原{account.fields.side === 'liability' ? '欠款' : '余额'} <strong>{prior}</strong></p>
          {account.fields.holding_mode ? <><label className="mobile-field">新份额（{account.fields.holding_unit ?? '份'}）<HoldingInput label={`${account.fields.name}新份额`} value={input.quantity} places={8} disabled={blocked || busy} onChange={v => update(account.id, 'quantity', v)}/></label><label className="mobile-field">单价（{code}）<HoldingInput label={`${account.fields.name}单价`} value={input.price} places={6} disabled={blocked || busy} onChange={v => update(account.id, 'price', v)}/></label></> : <label className="mobile-field">新{account.fields.side === 'liability' ? '欠款' : '余额'}（{code}）<CurrencyInput label={`${account.fields.name}新余额`} value={input.amount} places={currencyDecimals(code)} disabled={blocked || busy} onChange={v => update(account.id, 'amount', v)}/></label>}
          {code !== 'CNY' && <label className="mobile-field">汇率（每单位原币兑人民币）<CurrencyInput label={`${account.fields.name}汇率`} value={input.rate} places={6} disabled={blocked || busy} onChange={v => update(account.id, 'rate', v)}/></label>}
          {values[account.id] && <button type="button" className="mobile-reset" disabled={blocked || busy} onClick={() => setValues(old => { const next = { ...old }; delete next[account.id]; return next; })}>取消这行输入</button>}
        </section>;
      })}
      <section className="mobile-card mobile-save"><p className="mobile-caption">按账户依次保存。中途停止时，已保存的账户会保留；未确认前不会继续提交。</p>
        {message && <p role="status" className="mobile-notice">{message}</p>}{error && <p role="alert" className="mobile-error">{error}</p>}
        <button className="mobile-primary mobile-wide" disabled={blocked || busy || !dirty}>{busy ? '正在逐账户保存…' : `保存本次盘点${dirty ? `（${dirty} 个账户）` : ''}`}</button>
        {!!dirty && <button className="mobile-wide mobile-reset" type="button" disabled={blocked || busy} onClick={() => { setValues({}); setError(''); }}>取消本次输入</button>}
      </section>
    </form>}
  </>;
}
