import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { sourceLabel, updateSummary, type UpdateOutcome, type UpdateSource, type UpdateDownload } from './update-check';
import { SupportLink } from './SupportLink';

/** The app's only network request, made when the button is pressed: one read of
 * the public release list. It never sends library data and never installs
 * anything; updating stays a manual, backup-first step. */
export function UpdateCheck({ showVersion = true, compact = false, versionLabel }: { showVersion?: boolean; compact?: boolean; versionLabel?: string }) {
  const [version, setVersion] = useState(''), [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null), [error, setError] = useState('');
  useEffect(() => { if (showVersion) void invoke<string>('app_version').then(setVersion).catch(() => {}); }, [showVersion]);
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
  async function download(v: string, file: UpdateDownload) {
    setError('');
    try { await invoke('update_open_download', { version: v, source: file.source, name: file.name }); }
    catch (e) { setError(errorMessage(e)); }
  }
  const latest = outcome?.update_available ? outcome.latest : null;
  const checkButton = <button type="button" className="ui-btn" disabled={busy} onClick={() => void check()}>{busy ? '正在检查…' : '检查更新'}</button>;
  return <section className={compact ? 'update-check update-check-inline' : 'ui-card ui-content update-check'} aria-labelledby="update-check-heading">
    {compact ? <>
      <div className="support-version-row"><h3 id="update-check-heading" tabIndex={-1}>{versionLabel || (version ? `版本 ${version}` : '版本暂不可用')}</h3>{checkButton}</div>
      <p className="muted small support-update-hint">手动检查，不自动下载或安装。</p>
    </> : <>
      <div className="data-heading"><div><p className="eyebrow">版本</p><h2 id="update-check-heading" tabIndex={-1}>检查更新</h2></div>{version && <span>当前版本 {version}</span>}</div>
      <p className="data-intro">物谱平时不联网。只有点下面的按钮，才会向 Gitee 和 GitHub 各查询一次公开的版本列表，只读取版本号和发布说明，不发送你的资料或设备信息。物谱不会自动下载或替换应用，更新要你自己确认。</p>
      <p className="support-actions">{checkButton}<SupportLink target="update">更新与换机说明</SupportLink></p>
    </>}
    {outcome && <p className="update-check-result" role="status">{updateSummary(outcome)}</p>}
    {latest && <>
      <p className="notice">更新前请先到「设置 › 数据管理」做一次<strong>完整备份并异地保存</strong>：新版如果升级资料格式，旧版将不能打开升级后的资料。安装步骤见使用指南的「更新、换 Mac 与卸载」。</p>
      {latest.downloads.length > 0 && <div className="support-download">
        <p>{latest.downloads[0].label}{latest.downloads[0].size ? ` · 约 ${Math.ceil(latest.downloads[0].size / 1048576)} MB` : ''}</p>
        <button type="button" className="primary" onClick={() => void download(latest.version, latest.downloads[0])}>下载{outcome?.platform.startsWith('Mac') ? ' Mac' : ' Windows'} 安装包</button>
        <p className="muted small">在浏览器中下载。下载后退出物谱，再运行安装包或替换应用。</p>
        {latest.downloads.length > 1 && <details><summary>其他下载来源</summary>{latest.downloads.slice(1).map(file => <p key={file.source}><button type="button" className="ui-btn" onClick={() => void download(latest.version, file)}>从 {sourceLabel[file.source]} 下载</button><span className="muted small"> {file.label}</span></p>)}</details>}
      </div>}
      <details><summary>发布说明</summary><pre className="update-check-notes">{latest.notes || '这个版本没有填写发布说明。'}</pre></details>
      {compact && <p><SupportLink target="update">更新与换机说明</SupportLink></p>}
      <details><summary>发布页与手动下载</summary><p className="update-check-pages">{latest.sources.map(source => <button key={source} type="button" className="ui-btn" onClick={() => void openPage(latest.version, source)}>打开 {sourceLabel[source]} 发布页</button>)}</p></details>
    </>}
    {outcome?.newer_unavailable && <div className="support-update-unavailable"><p className="muted small">版本 {outcome.newer_unavailable.version} 暂未提供适合当前设备的安装包，无需下载其他平台的文件。</p><details><summary>查看该版本发布页</summary>{outcome.newer_unavailable.sources.map(source => <button key={source} type="button" className="ui-btn" onClick={() => void openPage(outcome.newer_unavailable!.version, source)}>查看 {sourceLabel[source]} 发布页</button>)}</details></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
