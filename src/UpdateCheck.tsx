import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { sourceLabel, updateSummary, type UpdateOutcome, type UpdateSource } from './update-check';

/** The app's only network request, made when the button is pressed: one read of
 * the public release list. It never sends library data and never installs
 * anything; updating stays a manual, backup-first step. */
export function UpdateCheck() {
  const [version, setVersion] = useState(''), [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null), [error, setError] = useState('');
  useEffect(() => { void invoke<string>('app_version').then(setVersion).catch(() => {}); }, []);
  async function check() {
    setBusy(true); setError('');
    try { setOutcome(await invoke<UpdateOutcome>('update_check')); }
    catch (e) { setOutcome(null); setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function openPage(v: string, source: UpdateSource) {
    setError('');
    try { await invoke('update_open_release', { version: v, source }); }
    catch (e) { setError(errorMessage(e)); }
  }
  const latest = outcome?.update_available ? outcome.latest : null;
  return <section className="ui-card ui-content update-check" aria-labelledby="update-check-heading">
    <div className="data-heading"><div><p className="eyebrow">版本</p><h2 id="update-check-heading">检查更新</h2></div>{version && <span>当前版本 {version}</span>}</div>
    <p className="data-intro">物谱平时不联网。只有点下面的按钮，才会向 Gitee 和 GitHub 各查询一次公开的版本列表，只读取版本号和发布说明，不发送你的资料或设备信息。物谱不会自动下载或替换应用，更新要你自己确认。</p>
    <p><button type="button" className="ui-btn" disabled={busy} onClick={() => void check()}>{busy ? '正在检查…' : '检查更新'}</button></p>
    {outcome && <p className="update-check-result" role="status">{updateSummary(outcome)}</p>}
    {latest && <>
      <details><summary>发布说明</summary><pre className="update-check-notes">{latest.notes || '这个版本没有填写发布说明。'}</pre></details>
      <p className="notice">更新前请先在本页做一次<strong>完整备份并异地保存</strong>：新版如果升级资料格式，旧版将不能打开升级后的资料。安装步骤见使用指南的「更新、换 Mac 与卸载」。</p>
      <p className="update-check-pages">{latest.sources.map((source, i) => <button key={source} type="button" className={i === 0 ? 'primary' : 'ui-btn'} onClick={() => void openPage(latest.version, source)}>在浏览器中打开 {sourceLabel[source]} 下载页</button>)}</p>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
