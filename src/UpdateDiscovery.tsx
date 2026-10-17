import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { Switch } from './FormControls';
import { Icon } from './AssetViews';
import { SupportLink } from './SupportLink';
import { privacyMenuAllowed } from './privacy-lock';
import { choiceStorage } from './start-choice';
import { sourceLabel, type UpdateSource } from './update-check';
import {
  askCardRecentlyShown, autoCheckDelayMs, autoCheckHint, autoCheckScheduled, inviteBody, inviteTitle,
  manualOutcome, markAskCardShown, markUpdateInviteAsked, outcomeLine,
  stampLabel, updateInviteVisible, updateInviteAsked,
} from './update-discovery';
import type { UpdateDiscoveryState, UpdateRequestResult } from './update-discovery';

/** The one app-level controller for update discovery: startup scheduling,
 * the settings toggle, the unread dot and the about page all read this state.
 * The backend owns consent, throttling and dedup; this layer only renders and
 * forwards user actions. */
export type UpdateDiscovery = {
  state: UpdateDiscoveryState | null;
  hasRecords: boolean;
  demoActive: boolean;
  /** No edits, saves or receipt checks in progress. */
  idle: boolean;
  manualBusy: boolean;
  manualError: string;
  manualNote: string;
  manualCheck: () => Promise<void>;
  setConsent: (enabled: boolean) => Promise<string | null>;
  markSeen: (version: string) => Promise<void>;
  ignoreVersion: (version: string) => Promise<string | null>;
};

const UpdateDiscoveryContext = createContext<UpdateDiscovery | null>(null);

export function useUpdateDiscovery(): UpdateDiscovery {
  const context = useContext(UpdateDiscoveryContext);
  if (!context) throw new Error('UpdateDiscoveryProvider 未挂载');
  return context;
}

export function UpdateDiscoveryProvider({ children, invoke: call = invoke, idle, hasRecords, demoActive }: {
  invoke?: typeof invoke;
  children: ReactNode;
  /** No edits, saves or receipt checks in progress. */
  idle: boolean;
  hasRecords: boolean;
  demoActive: boolean;
}) {
  const [state, setState] = useState<UpdateDiscoveryState | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState('');
  const [manualNote, setManualNote] = useState('');
  const requested = useRef(false);
  useEffect(() => {
    let live = true;
    void call<UpdateDiscoveryState>('update_state_get').then(value => { if (live) setState(value); }).catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [call]);
  // Startup round: about five calm, unlocked seconds after the shell became
  // interactive. The backend re-checks consent, the per-process budget and
  // the 24-hour interval, so an early or repeated call here stays harmless.
  useEffect(() => {
    if (!autoCheckScheduled(state, { idle, unlocked: privacyMenuAllowed(), checkedThisSession: requested.current })) return;
    const timer = window.setTimeout(() => {
      requested.current = true;
      void call<UpdateRequestResult>('update_check_request', { mode: 'automatic' })
        .then(result => setState(result.state))
        .catch(() => { /* an automatic round never disturbs the user */ });
    }, autoCheckDelayMs);
    return () => window.clearTimeout(timer);
  }, [state, idle, call]);
  const manualCheck = useCallback(async () => {
    if (manualBusy) return;
    setManualBusy(true); setManualError(''); setManualNote('');
    try {
      const result = await call<UpdateRequestResult>('update_check_request', { mode: 'manual' });
      setState(result.state);
      if (result.task?.error) setManualError(result.task.error);
      else if (result.state.cache_unsaved) setManualNote('本次检查完成，但结果暂时无法保存在本机，下次启动可能不记得。');
      else if (result.task?.cancelled) setManualNote('自动检查已取消，可点击手动检查。');
    } catch (e) {
      setManualError(errorMessage(e));
    } finally {
      setManualBusy(false);
    }
  }, [call, manualBusy]);
  const setConsent = useCallback(async (enabled: boolean) => {
    const current = state;
    if (!current) return '更新设置暂不可用，请稍后再试。';
    try {
      setState(await call<UpdateDiscoveryState>('update_consent_set', { enabled, expectedRevision: current.preference_revision }));
      return null;
    } catch (e) {
      void call<UpdateDiscoveryState>('update_state_get').then(fresh => setState(fresh)).catch(() => {});
      return errorMessage(e);
    }
  }, [call, state]);
  const markSeen = useCallback(async (version: string) => {
    try {
      setState(await call<UpdateDiscoveryState>('update_mark_seen', { version }));
    } catch {
      // The card is on screen right now; stop the duplicate hint for this
      // session but say plainly that it could not be saved.
      setState(current => (current && current.candidate?.version === version ? { ...current, unread: false } : current));
      setManualNote('已读状态暂时无法保存，下次启动可能再次提示。');
    }
  }, [call]);
  const ignoreVersion = useCallback(async (version: string) => {
    try {
      setState(await call<UpdateDiscoveryState>('update_ignore_version', { version }));
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  }, [call]);
  return <UpdateDiscoveryContext.Provider value={{ state, hasRecords, demoActive, idle, manualBusy, manualError, manualNote, manualCheck, setConsent, markSeen, ignoreVersion }}>
    {children}
  </UpdateDiscoveryContext.Provider>;
}

/** One-time ask, only for a started personal library on an ordinary page. It
 * never stacks on the check-in reminder ask of the same page visit. */
export function UpdateInvite() {
  const { state, hasRecords, demoActive, idle, setConsent } = useUpdateDiscovery();
  const [asked, setAsked] = useState(() => updateInviteAsked(choiceStorage()));
  const [yielded, setYielded] = useState(() => askCardRecentlyShown(choiceStorage(), 'checkin', Date.now()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const onAskShown = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind !== 'checkin') return;
      markAskCardShown(choiceStorage(), 'checkin', Date.now());
      setYielded(true);
    };
    window.addEventListener('thingary-ask-card-shown', onAskShown);
    return () => window.removeEventListener('thingary-ask-card-shown', onAskShown);
  }, []);
  if (yielded || asked || !idle) return null;
  if (!updateInviteVisible(state, { asked, hasRecords, demoActive, busy })) return null;
  async function choose(enabled: boolean) {
    setBusy(true); setError('');
    const failure = await setConsent(enabled);
    setBusy(false);
    if (failure) { setError(failure); return; }
    markUpdateInviteAsked(choiceStorage());
    setAsked(true);
  }
  return <section className="ui-card ui-content update-invite" aria-labelledby="update-invite-heading">
    <div className="data-heading"><div><p className="eyebrow">更新</p><h2 id="update-invite-heading">{inviteTitle}</h2></div></div>
    <p className="data-intro">{inviteBody}</p>
    <div className="checkin-reminder-ask-actions">
      <button type="button" className="primary" disabled={busy} onClick={() => void choose(true)}>开启自动检查</button>
      <button type="button" disabled={busy} onClick={() => void choose(false)}>保持手动检查</button>
    </div>
    {error && <p className="error" role="alert">{error} 本次没有更改自动检查。</p>}
  </section>;
}

/** The unread dot for the 设置 entry: the color is never the only signal —
 * the accessible name carries 有新版本 while the dot itself is decorative. */
export function UpdateUnreadDot() {
  const { state } = useUpdateDiscovery();
  return state?.unread ? <span className="update-dot" aria-hidden="true"/> : null;
}

/** The sidebar 设置 button, owning its unread naming. */
export function SettingsEntry({ active, disabled, onOpen }: { active: boolean; disabled: boolean; onOpen: () => void }) {
  const { state } = useUpdateDiscovery();
  const unread = !!state?.unread;
  return <button className={active ? 'nav-active' : ''} aria-current={active ? 'page' : undefined} aria-label={unread ? '设置 · 有新版本' : undefined} disabled={disabled} onClick={onOpen}><Icon name="settings"/><span>设置</span>{unread && <span className="update-dot" aria-hidden="true"/>}</button>;
}

const downloadLabel = (platform: string) => platform.startsWith('Mac') ? '下载 Mac 安装包' : platform.startsWith('Windows') ? '下载 Windows 安装包' : '下载安装包';
const mirror = (source: string): string => sourceLabel[source as UpdateSource] ?? source;

/** Manual check button + auto toggle + dated discovery, one shared state. */
export function UpdateCheck({ showVersion = true, compact = false, versionLabel }: { showVersion?: boolean; compact?: boolean; versionLabel?: string }) {
  const { state, manualBusy, manualError, manualNote, manualCheck, setConsent, markSeen, ignoreVersion } = useUpdateDiscovery();
  const [version, setVersion] = useState('');
  const [toggleError, setToggleError] = useState('');
  const [toggleBusy, setToggleBusy] = useState(false);
  const [ignoreBusy, setIgnoreBusy] = useState(false);
  const [seenOnce, setSeenOnce] = useState('');
  useEffect(() => { if (showVersion) void invoke<string>('app_version').then(setVersion).catch(() => {}); }, [showVersion]);
  const candidate = state?.candidate ?? null;
  const card = useRef<HTMLDivElement | null>(null);
  const recorded = useRef(false);
  // "Seen" means the version card is actually on screen: mounted, unfolded,
  // the window foregrounded and no lock screen covering it. A hidden mount or
  // a folded parent never clears the dot.
  useEffect(() => {
    recorded.current = false;
    const element = card.current;
    if (!candidate || !element || document.hidden || !privacyMenuAllowed()) return;
    if (seenOnce === candidate.version) return;
    const record = () => {
      if (recorded.current || document.hidden || !privacyMenuAllowed()) return;
      recorded.current = true;
      setSeenOnce(candidate.version);
      void markSeen(candidate.version);
    };
    if (typeof IntersectionObserver === 'undefined') { record(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { record(); observer.disconnect(); }
    }, { threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [candidate, markSeen, seenOnce]);
  async function openPage(pageVersion: string, source: string) {
    setToggleError('');
    try { await invoke('update_open_release', { version: pageVersion, source }); }
    catch (e) { setToggleError(errorMessage(e)); }
  }
  async function download(pageVersion: string, source: string, name: string) {
    setToggleError('');
    try { await invoke('update_open_download', { version: pageVersion, source, name }); }
    catch (e) { setToggleError(errorMessage(e)); }
  }
  const currentLabel = versionLabel || (version ? `版本 ${version}` : '版本暂不可用');
  const consentValue = state ? state.consent === 'enabled' : false;
  const lastAttempt = state?.last_attempt_at ? stampLabel(state.last_attempt_at) : '';
  const lastSuccess = state?.last_success_at ? stampLabel(state.last_success_at) : '';
  return <section className={compact ? 'update-check update-check-inline' : 'ui-card ui-content update-check'} aria-labelledby="update-check-heading">
    <div className="support-version-row"><h3 id="update-check-heading" tabIndex={-1}>{currentLabel}</h3><button type="button" className="ui-btn" disabled={manualBusy} onClick={() => void manualCheck()}>{manualBusy ? '正在检查…' : '检查更新'}</button></div>
    <div className="update-auto-row">
      <div className="update-auto-toggle"><Switch label="启动时检查更新" value={consentValue} disabled={!state || toggleBusy || state.preferences_status === 'damaged'} onChange={value => { setToggleBusy(true); setToggleError(''); void setConsent(value).then(failure => { setToggleBusy(false); if (failure) setToggleError(failure); }); }}/><span id="update-auto-label">启动时检查更新</span></div>
      <p className="muted small">{autoCheckHint}</p>
      <p className="muted small">{lastSuccess ? `上次成功检查：${lastSuccess}` : lastAttempt ? `上次尝试检查：${lastAttempt}（未成功）` : '尚未检查过。'}</p>
    </div>
    {state?.preferences_status === 'damaged' && <p className="error" role="alert">自动检查的设置文件读取失败：{state.preferences_problem ?? '文件无法识别'}。在这里切换开关会用你本次的选择重建设置；原文件以 update-preferences.invalid.json 保留供检查。</p>}
    {manualError && <p className="error" role="alert">{manualError}</p>}
    {manualNote && <p className="notice" role="status">{manualNote}</p>}
    {state && !manualBusy && !manualError && !manualNote && (state.update_available || state.newer_unavailable || state.last_success_at) && <p className="update-check-result muted small" role="status">{outcomeLine(manualOutcome(state, null, null))}</p>}
    {candidate && <div className="support-download" ref={card}>
      <p>有新版本 <strong>{candidate.version}</strong>{candidate.published_at ? ` · ${candidate.published_at.slice(0, 10)} 发布` : ''}<span className="muted small"> · 当前使用 {state?.current_version}</span></p>
      {!state?.candidate_fresh && <p className="muted small">上次发现该版本：{stampLabel(candidate.confirmed_at)}，已超过 7 天，请重新检查确认仍可下载。</p>}
      {state?.ignored_version === candidate.version && <p className="muted small">已忽略这个版本的提醒；仍可手动下载。</p>}
      {candidate.downloads.length > 0 && <>
        <p>{candidate.downloads[0].label}{candidate.downloads[0].size ? ` · 约 ${Math.ceil(candidate.downloads[0].size / 1048576)} MB` : ''}</p>
        <p className="support-actions">
          <button type="button" className="primary" onClick={() => void download(candidate.version, candidate.downloads[0].source, candidate.downloads[0].name)}>{downloadLabel(state?.platform_label ?? '')}</button>
          <button type="button" className="ui-btn" disabled={ignoreBusy} onClick={() => { setIgnoreBusy(true); void ignoreVersion(candidate.version).then(failure => { setIgnoreBusy(false); if (failure) setToggleError(failure); }); }}>{state?.ignored_version === candidate.version ? '已忽略此版本' : '忽略此版本'}</button>
        </p>
        <p className="muted small">在浏览器中下载。下载后退出物谱，再运行安装包或替换应用；下载不代表已安装。</p>
        {candidate.downloads.length > 1 && <details><summary>其他下载来源</summary>{candidate.downloads.slice(1).map(file => <p key={file.source}><button type="button" className="ui-btn" onClick={() => void download(candidate.version, file.source, file.name)}>从 {mirror(file.source)} 下载</button><span className="muted small"> {file.label}</span></p>)}</details>}
      </>}
      <p className="notice">更新前请先到「设置 › 数据管理」做一次<strong>完整备份并异地保存</strong>：新版如果升级资料格式，旧版将不能打开升级后的资料。安装步骤见使用指南的「更新、换机与卸载」。</p>
      <details><summary>发布说明</summary><pre className="update-check-notes">{candidate.notes || '这个版本没有填写发布说明。'}</pre></details>
      {compact && <p><SupportLink target="update">更新与换机说明</SupportLink></p>}
      <details><summary>发布页与手动下载</summary><p className="update-check-pages">{candidate.sources.map(source => <button key={source} type="button" className="ui-btn" onClick={() => void openPage(candidate.version, source)}>打开 {mirror(source)} 发布页</button>)}</p></details>
    </div>}
    {state?.newer_unavailable && <div className="support-update-unavailable"><p className="muted small">版本 {state.newer_unavailable.version} 暂未提供适合当前设备的安装包，无需下载其他平台的文件。</p><details><summary>查看该版本发布页</summary>{state.newer_unavailable.sources.map(source => <button key={source} type="button" className="ui-btn" onClick={() => void openPage(state.newer_unavailable!.version, source)}>查看 {mirror(source)} 发布页</button>)}</details></div>}
    {toggleError && <p className="error" role="alert">{toggleError}</p>}
  </section>;
}
