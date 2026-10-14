import { useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { supportUrls, type SupportTarget } from './support';

/** Only a fixed destination ID crosses IPC; never pass a URL from the page. */
export function SupportLink({ target, children }: { target: SupportTarget; children: ReactNode }) {
  const [error, setError] = useState('');
  return <span className="support-link"><a href={supportUrls[target]} onClick={async e => {
    e.preventDefault(); setError('');
    try { await invoke('support_open', { target }); }
    catch (e) { setError(errorMessage(e)); }
  }}>{children}</a>{error && <span className="support-link-error" role="alert">{error} 请复制地址到浏览器：<code>{supportUrls[target]}</code></span>}</span>;
}
