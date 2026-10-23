import { useEffect, useRef } from 'react';
import { t } from './i18n.ts';
/** Asked before the sidebar leaves a page with an unsaved finance or planning form. */
export function LeaveConfirm({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opened = dialog.current; opened?.showModal(); return () => opened?.close(); }, []);
  return <dialog ref={dialog} className="editor leave-confirm" aria-labelledby="leave-confirm-title" onCancel={event => { event.preventDefault(); onStay(); }}>
    <h2 id="leave-confirm-title">{t('放弃未保存的输入？')}</h2>
    <p className="muted">{t('离开后，当前表单里填的内容不会保存。')}</p>
    <div className="leave-confirm-actions"><button type="button" autoFocus onClick={onStay}>{t('继续编辑')}</button><button type="button" className="danger" onClick={onLeave}>{t('放弃并离开')}</button></div>
  </dialog>;
}
