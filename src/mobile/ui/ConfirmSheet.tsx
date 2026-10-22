import type { ReactNode } from 'react';
import { Button } from './Forms';
import { Sheet } from './Sheet';
import { Notice } from './States';

/**
 * Bottom sheet that asks before something is saved or changed; shows the error of a failed attempt.
 * `busy` disables the button and swaps its text for `busyLabel`; the sheet cannot be dismissed while busy.
 * For deletions use {@link DeleteSheet}, which fixes the wording.
 */
export function ConfirmSheet({ title, message, confirm, danger, busy, busyLabel = '正在保存…', error, onConfirm, onClose, children, disabled }: {
  title: string; message?: ReactNode; confirm: string; danger?: boolean; busy: boolean; busyLabel?: string; error?: string;
  onConfirm: () => void; onClose: () => void; children?: ReactNode; disabled?: boolean;
}) {
  return <Sheet title={title} onClose={() => { if (!busy) onClose(); }} doneLabel="取消">
    <div className="m-confirm">
      {message && <p className="m-confirm-text">{message}</p>}
      {children}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button variant={danger ? 'danger' : 'primary'} block disabled={busy || disabled} onClick={onConfirm}>{busy ? busyLabel : confirm}</Button>
    </div>
  </Sheet>;
}

export const recoverableLine = '可在「我的 › 最近删除」恢复';

/**
 * The one delete confirmation: title 「删除「X」？」, red 「删除」 button, 「正在删除…」 while busy.
 * `recoverable` adds 「可在「我的 › 最近删除」恢复」 for records that go to the recycle bin; leave it off for
 * permanent deletions and say so in `children`. `children` carries extra consequences (what else goes with it).
 */
export function DeleteSheet({ name, recoverable = true, busy, error, onConfirm, onClose, children, disabled }: {
  name: string; recoverable?: boolean; busy: boolean; error?: string; onConfirm: () => void; onClose: () => void; children?: ReactNode; disabled?: boolean;
}) {
  return <ConfirmSheet title={`删除「${name}」？`} confirm="删除" danger busy={busy} busyLabel="正在删除…" error={error} disabled={disabled} onConfirm={onConfirm} onClose={onClose}>
    {children}
    {recoverable && <p className="m-confirm-text m-confirm-recover">{recoverableLine}</p>}
  </ConfirmSheet>;
}
