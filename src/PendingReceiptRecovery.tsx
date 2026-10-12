import { useRef, useState } from 'react';
import { errorMessage } from './asset';
import { resolvePending, type Pending } from './wealth';

/** A read-only recovery entry remains available even when its business module is hidden. */
export function PendingReceiptRecovery({ pending, disabled, onResolved, onImport }: {
  pending: Pending; disabled: boolean; onResolved: (outcome: 'saved' | 'unsaved' | 'stale') => void; onImport: () => void;
}) {
  const checking = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function verify() {
    if (disabled || checking.current) return;
    checking.current = true; setBusy(true); setError('');
    try {
      const outcome = await resolvePending(pending);
      onResolved(outcome);
    } catch (cause) { setError(errorMessage(cause) + ' 原请求已保留，可稍后重试核对。'); }
    finally { checking.current = false; setBusy(false); }
  }
  return <section className="notice pending-receipt-recovery" aria-label="保存结果核对">
    <p role="status">上次「{pending.label}」的保存结果未确认。核对前暂停新增、切页和切换资料；核对不会再次保存。</p>
    {pending.command === 'financial_import_commit'
      ? <button type="button" disabled={disabled} onClick={onImport}>前往数据管理核对导入</button>
      : <button type="button" disabled={disabled || busy} onClick={() => void verify()}>{busy ? '正在核对…' : '核对保存结果'}</button>}
    {disabled && <p className="muted small">请先关闭当前表单，或使用当前页面的“核对结果”入口。</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
