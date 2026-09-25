import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import type { CloseIntent } from './AssetEditor';

// No editor is mounted for a retained draft. Handle native close intents here
// without clearing the durable draft or treating a pending request as saved.
export function StoredDraftClose({ intent, onKeep }: { intent: CloseIntent; onKeep: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  async function finish() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await invoke('finish_close', { quit: intent === 'quit' }); onKeep(); }
    catch (e) { setNotice(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="editor" aria-labelledby="stored-draft-close-heading" onCancel={event => { event.preventDefault(); if (!lock.current) onKeep(); }}>
    <h2 id="stored-draft-close-heading">保留草稿后{intent === 'quit' ? '退出' : '关闭窗口'}？</h2>
    <p>草稿已保存在本机，下次打开仍可恢复。待确认的保存请求也会保留，恢复时会核对原请求，不代表已经保存成功。</p>
    {notice && <p role="status">{notice}</p>}
    <div className="actions"><button autoFocus disabled={busy} onClick={onKeep}>继续使用</button><button disabled={busy} onClick={() => void finish()}>保留草稿并{intent === 'quit' ? '退出' : '关闭窗口'}</button></div>
  </dialog>;
}
