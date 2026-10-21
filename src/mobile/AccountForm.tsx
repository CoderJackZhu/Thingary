import { useRef, useState } from 'react';
import { errorMessage } from '../asset';
import { accountKindHint, assetKinds, liabilityKinds, selectAccountKind, storedPending, submit } from '../wealth';
import type { Account, AccountFields } from '../wealth';

export function AccountForm({ generation, today, onClose, onBusy, onPending }: { generation: string; today: string; onClose: (saved: boolean) => void; onBusy: (busy: boolean) => void; onPending: () => void }) {
  const [fields, setFields] = useState<AccountFields>({ name: '', institution: '', side: 'asset', kind: 'cash', counted: true, opened_on: today, closed_on: null, notes: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const counted = useRef<boolean | null>(null), sending = useRef(false);
  async function save() {
    if (sending.current || storedPending()) return;
    if (!fields.name.trim()) { setError('请填写账户名称。'); return; }
    sending.current = true; setBusy(true); onBusy(true); setError('');
    try {
      await submit<Account>({ command: 'wealth_account_save', label: '新增账户', input: { request_id: crypto.randomUUID(), generation, id: null, expected_revision: null, fields: { ...fields, name: fields.name.trim(), institution: fields.institution.trim() } } });
      onClose(true);
    } catch (cause) { setError(errorMessage(cause)); onPending(); }
    finally { sending.current = false; setBusy(false); onBusy(false); }
  }
  return <form className="mobile-card mobile-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h2>新增账户</h2><p className="mobile-muted">只记名称与类型，不需要卡号或登录信息。</p>
    <label>账户名称<input aria-label="账户名称" autoFocus value={fields.name} maxLength={80} disabled={busy} onChange={e => setFields(f => ({ ...f, name: e.target.value }))} placeholder="例如：日常储蓄卡"/></label>
    <label>类型<select aria-label="账户类型" value={fields.kind} disabled={busy} onChange={e => setFields(f => selectAccountKind(f, e.target.value, counted.current))}><optgroup label="资产">{assetKinds.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</optgroup><optgroup label="负债">{liabilityKinds.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</optgroup></select></label>
    {accountKindHint(fields.kind) && <p className="mobile-caption">{accountKindHint(fields.kind)}</p>}
    <label>平台（可选）<input aria-label="账户平台" value={fields.institution} maxLength={80} disabled={busy} onChange={e => setFields(f => ({ ...f, institution: e.target.value }))}/></label>
    <label className="mobile-check"><input type="checkbox" checked={fields.counted} disabled={busy || fields.kind === 'property'} onChange={e => { counted.current = e.target.checked; setFields(f => ({ ...f, counted: e.target.checked })); }}/>计入金融净资产</label>
    <p className="mobile-caption">人民币账户 · 从 {today} 开始盘点</p>
    {error && <p role="alert" className="mobile-error">{error}</p>}
    <div className="mobile-actions"><button type="button" disabled={busy} onClick={() => onClose(false)}>取消</button><button className="mobile-primary" disabled={busy}>{busy ? '保存中…' : '保存账户'}</button></div>
  </form>;
}
