import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { Switch } from './FormControls';
import { Icon } from './AssetViews';
import { SupportLink } from './SupportLink';
import { privacyMenuAllowed } from './privacy-lock';
import { sourceLabel, type UpdateSource } from './update-check';
import {
  autoCheckDelayMs, autoCheckHint, autoCheckScheduled, inviteBody, inviteTitle,
  manualOutcome, outcomeLine, stampLabel, updateInviteVisible,
} from './update-discovery';
import type { UpdateDiscoveryState, UpdateRequestResult } from './update-discovery';
import { t } from './i18n.ts';
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
  screenAvailable: boolean;
  visitKey: string;
  readError: string;
  reloadState: () => Promise<void>;
  manualBusy: boolean;
  manualError: string;
  manualNote: string;
  manualCheck: () => Promise<void>;
  setConsent: (enabled: boolean) => Promise<string | null>;
  markSeen: (version: string) => Promise<void>;
  ignoreVersion: (version: string) => Promise<string | null>;
};

const UpdateDiscoveryContext = createContext<UpdateDiscovery | null>(null);

function screenAvailable() {
  return privacyMenuAllowed() && !document.hidden &&
    (typeof document.hasFocus !== 'function' || document.hasFocus()) &&
    !document.documentElement?.hasAttribute('data-privacy-screen');
}

function useScreenAvailable() {
  const [available, setAvailable] = useState(screenAvailable);
  useEffect(() => {
    const refresh = () => setAvailable(screenAvailable());
    window.addEventListener('focus', refresh);
    window.addEventListener('blur', refresh);
    window.addEventListener('thingary-privacy-screen-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(refresh) : null;
    if (document.documentElement) observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-privacy-screen'] });
    refresh();
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('blur', refresh);
      window.removeEventListener('thingary-privacy-screen-changed', refresh);
      document.removeEventListener('visibilitychange', refresh);
      observer?.disconnect();
    };
  }, []);
  return available;
}

export function useUpdateDiscovery(): UpdateDiscovery {
  const context = useContext(UpdateDiscoveryContext);
  if (!context) throw new Error(t('UpdateDiscoveryProvider 未挂载'));
  return context;
}

export function UpdateDiscoveryProvider({ children, invoke: call = invoke, idle, hasRecords, demoActive, visitKey = '' }: {
  invoke?: typeof invoke;
  children: ReactNode;
  /** No edits, saves or receipt checks in progress. */
  idle: boolean;
  hasRecords: boolean;
  demoActive: boolean;
  visitKey?: string;
}) {
  const [state, setState] = useState<UpdateDiscoveryState | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [readError, setReadError] = useState('');
  const available = useScreenAvailable();
  const latest = useRef<UpdateDiscoveryState | null>(null);
  const acceptState = useCallback((value: UpdateDiscoveryState) => {
    if (latest.current) {
      if (value.snapshot_revision !== undefined && latest.current.snapshot_revision !== undefined) {
        if (value.snapshot_revision < latest.current.snapshot_revision) return;
      } else if (value.preference_revision < latest.current.preference_revision) return;
    }
    latest.current = value;
    setState(value);
  }, []);
  const requested = useRef(false);
  const reloadState = useCallback(async () => {
    try { acceptState(await call<UpdateDiscoveryState>('update_state_get')); setReadError(''); }
    catch (e) { setReadError(errorMessage(e)); }
  }, [call, acceptState]);
  useEffect(() => {
    let live = true;
    void call<UpdateDiscoveryState>('update_state_get').then(value => { if (live) { acceptState(value); setReadError(''); } }).catch(e => { if (live) setReadError(errorMessage(e)); });
    return () => { live = false; };
  }, [call, acceptState]);
  // Startup round: about five calm, unlocked seconds after the shell became
  // interactive. The backend re-checks consent, the per-process budget and
  // the 24-hour interval, so an early or repeated call here stays harmless.
  useEffect(() => {
    if (!autoCheckScheduled(state, { idle, unlocked: available, checkedThisSession: requested.current })) return;
    const timer = window.setTimeout(() => {
      if (!screenAvailable() || latest.current?.consent !== 'enabled') return;
      requested.current = true;
      void call<UpdateRequestResult>('update_check_request', { mode: 'automatic' })
        .then(result => acceptState(result.state))
        .catch(() => { /* an automatic round never disturbs the user */ });
    }, autoCheckDelayMs);
    return () => window.clearTimeout(timer);
  }, [state, idle, call, available, acceptState]);
  const manualCheck = useCallback(async () => {
    if (manualBusy) return;
    setManualBusy(true); setManualError(''); setManualNote('');
    try {
      const result = await call<UpdateRequestResult>('update_check_request', { mode: 'manual' });
      acceptState(result.state);
      if (result.task?.cancelled) setManualNote(t('自动检查已取消，可点击手动检查。'));
      else if (result.task?.error) setManualError(result.task.error);
      else if (result.state.cache_unsaved) setManualNote(t('本次检查完成，但结果暂时无法保存在本机，下次启动可能不记得。'));
    } catch (e) {
      setManualError(errorMessage(e));
    } finally {
      setManualBusy(false);
    }
  }, [call, manualBusy, acceptState]);
  const setConsent = useCallback(async (enabled: boolean) => {
    const current = latest.current;
    if (!current) return t('更新设置暂不可用，请稍后再试。');
    try {
      acceptState(await call<UpdateDiscoveryState>('update_consent_set', { enabled, expectedRevision: current.preference_revision }));
      return null;
    } catch (e) {
      void reloadState();
      return errorMessage(e);
    }
  }, [call, acceptState, reloadState]);
  const markSeen = useCallback(async (version: string) => {
    try {
      acceptState(await call<UpdateDiscoveryState>('update_mark_seen', { version }));
      setManualNote(note => note === '已读状态暂时无法保存，下次启动可能再次提示。' ? '' : note);
    } catch {
      // The card is on screen right now; stop the duplicate hint for this
      // session but say plainly that it could not be saved.
      if (latest.current?.candidate?.version === version) acceptState({ ...latest.current, unread: false });
      setManualNote(t('已读状态暂时无法保存，下次启动可能再次提示。'));
    }
  }, [call, acceptState]);
  const ignoreVersion = useCallback(async (version: string) => {
    try {
      acceptState(await call<UpdateDiscoveryState>('update_ignore_version', { version }));
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  }, [call, acceptState]);
  return <UpdateDiscoveryContext.Provider value={{ state, hasRecords, demoActive, idle, screenAvailable: available, visitKey, readError, reloadState, manualBusy, manualError, manualNote, manualCheck, setConsent, markSeen, ignoreVersion }}>
    {children}
  </UpdateDiscoveryContext.Provider>;
}

/** One-time ask, only for a started personal library on an ordinary page. It
 * never stacks on the check-in reminder ask of the same page visit. */
export function UpdateInvite({ eligible = true }: { eligible?: boolean }) {
  const { state, hasRecords, demoActive, idle, screenAvailable: available, visitKey, setConsent } = useUpdateDiscovery();
  const [yieldedVisit, setYieldedVisit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const onAskShown = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind !== 'checkin') return;
      setYieldedVisit(visitKey);
    };
    window.addEventListener('thingary-ask-card-shown', onAskShown);
    return () => window.removeEventListener('thingary-ask-card-shown', onAskShown);
  }, [visitKey]);
  if (!eligible || yieldedVisit === visitKey || !idle || !available) return null;
  if (!updateInviteVisible(state, { asked: false, hasRecords, demoActive, busy: false })) return null;
  async function choose(enabled: boolean) {
    setBusy(true); setError('');
    const failure = await setConsent(enabled);
    setBusy(false);
    if (failure) { setError(failure); return; }
  }
  return <section className="ui-card ui-content update-invite" aria-labelledby="update-invite-heading">
    <div className="data-heading"><div><p className="eyebrow">{t('更新')}</p><h2 id="update-invite-heading">{inviteTitle}</h2></div><button type="button" className="ui-link" aria-label={t('关闭自动检查询问')} disabled={busy} onClick={() => void choose(false)}>{t('关闭')}</button></div>
    <p className="data-intro">{inviteBody}</p>
    <div className="checkin-reminder-ask-actions">
      <button type="button" className="primary" disabled={busy} onClick={() => void choose(true)}>{t('开启自动检查')}</button>
      <button type="button" disabled={busy} onClick={() => void choose(false)}>{t('保持手动检查')}</button>
    </div>
    {error && <p className="error" role="alert">{t('{error} 本次没有更改自动检查。', { error })}</p>}
  </section>;
}

/** The unread dot for the 设置 entry: the color is never the only signal —
 * the accessible name carries 有新版本 while the dot itself is decorative. */
export function UpdateUnreadDot() {
  const { state } = useUpdateDiscovery();
  return state?.unread ? <><span className="update-dot" aria-hidden="true"/><span className="update-unread-text"> {t('· 有新版本')}</span></> : null;
}

/** The sidebar 设置 button, owning its unread naming. */
export function SettingsEntry({ active, disabled, onOpen }: { active: boolean; disabled: boolean; onOpen: () => void }) {
  const { state } = useUpdateDiscovery();
  const unread = !!state?.unread;
  return <button className={active ? 'nav-active' : ''} aria-current={active ? 'page' : undefined} aria-label={unread ? t('设置 · 有新版本') : undefined} disabled={disabled} onClick={onOpen}><Icon name="settings"/><span>{t('设置')}</span>{unread && <span className="update-dot" aria-hidden="true"/>}</button>;
}

const downloadLabel = (platform: string) => platform.startsWith('Mac') ? t('下载 Mac 安装包') : platform.startsWith('Windows') ? t('下载 Windows 安装包') : t('下载安装包');
const mirror = (source: string): string => sourceLabel[source as UpdateSource] ?? source;

/** Manual check button + auto toggle + dated discovery, one shared state. */
export function UpdateCheck({ showVersion = true, compact = false, versionLabel }: { showVersion?: boolean; compact?: boolean; versionLabel?: string }) {
  const { state, readError, reloadState, screenAvailable: available, manualBusy, manualError, manualNote, manualCheck, setConsent, markSeen, ignoreVersion } = useUpdateDiscovery();
  const [version, setVersion] = useState('');
  const [toggleError, setToggleError] = useState('');
  const [toggleBusy, setToggleBusy] = useState(false);
  const [ignoreBusy, setIgnoreBusy] = useState(false);
  const [seenOnce, setSeenOnce] = useState('');
  useEffect(() => { if (showVersion) void invoke<string>('app_version').then(setVersion).catch(() => {}); }, [showVersion]);
  const candidate = state?.candidate ?? null;
  const seenKey = candidate ? `${candidate.version}:${state?.preferences_status}` : '';
  const card = useRef<HTMLDivElement | null>(null);
  const recorded = useRef(false);
  // "Seen" means the version card is actually on screen: mounted, unfolded,
  // the window foregrounded and no lock screen covering it. A hidden mount or
  // a folded parent never clears the dot.
  useEffect(() => {
    recorded.current = false;
    const element = card.current;
    if (!candidate || !element || !available) return;
    if (seenOnce === seenKey) return;
    const record = () => {
      if (recorded.current || !screenAvailable()) return;
      recorded.current = true;
      setSeenOnce(seenKey);
      void markSeen(candidate.version);
    };
    if (typeof IntersectionObserver === 'undefined') { if (element.getClientRects().length && !element.closest('[hidden]')) record(); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { record(); observer.disconnect(); }
    }, { threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [candidate, markSeen, seenOnce, seenKey, available]);
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
  const currentLabel = versionLabel || (version ? t('版本 {version}', { version }) : t('版本暂不可用'));
  const consentValue = state ? state.consent === 'enabled' : false;
  const lastAttempt = state?.last_attempt_at ? stampLabel(state.last_attempt_at) : '';
  const lastSuccess = state?.last_success_at ? stampLabel(state.last_success_at) : '';
  return <section className={compact ? 'update-check update-check-inline' : 'ui-card ui-content update-check'} aria-labelledby="update-check-heading">
    <div className="support-version-row"><h3 id="update-check-heading" tabIndex={-1}>{currentLabel}</h3><button type="button" className="ui-btn" disabled={manualBusy} onClick={() => void manualCheck()}>{manualBusy ? t('正在检查…') : t('检查更新')}</button></div>
    <div className="update-auto-row">
      <div className="update-auto-toggle"><Switch label={t('启动时检查更新')} value={consentValue} disabled={!state || toggleBusy || state.preferences_status === 'damaged'} onChange={value => { setToggleBusy(true); setToggleError(''); void setConsent(value).then(failure => { setToggleBusy(false); if (failure) setToggleError(failure); }); }}/><span id="update-auto-label">{t('启动时检查更新')}</span></div>
      <p className="muted small">{autoCheckHint}</p>
      <p className="muted small">{lastSuccess ? t('上次成功检查：{lastSuccess}', { lastSuccess }) : lastAttempt ? t('上次尝试检查：{lastAttempt}（未成功）', { lastAttempt }) : t('尚未检查过。')}</p>
    </div>
    {readError && <p className="error" role="alert">{t('更新设置读取失败：{readError}', { readError })} <button type="button" className="ui-link" onClick={() => void reloadState()}>{t('重新读取更新设置')}</button></p>}
    {state?.preferences_status === 'damaged' && <div className="error" role="alert"><p>{t('自动检查的设置文件读取失败：')}{state.preferences_problem ?? t('文件无法识别')}。</p>{state.preferences_repairable !== false ? <><p>{t('请重新选择是否自动检查；重建前会保留损坏原文件，不影响资料。')}</p><button type="button" disabled={toggleBusy} onClick={() => { setToggleBusy(true); void setConsent(false).then(failure => { setToggleBusy(false); setToggleError(failure ?? ''); }); }}>{t('保持手动并修复设置')}</button><button type="button" disabled={toggleBusy} onClick={() => { setToggleBusy(true); void setConsent(true).then(failure => { setToggleBusy(false); setToggleError(failure ?? ''); }); }}>{t('开启自动检查并修复设置')}</button></> : <p>{t('设置来自较新版本，已保留原文件。请升级后再修改，仍可手动检查更新。')}</p>}</div>}
    {manualError && <p className="error" role="alert">{manualError}</p>}
    {manualNote && <p className="notice" role="status">{manualNote}</p>}
    {state && !manualBusy && !manualError && !manualNote && (state.update_available || state.newer_unavailable || state.last_success_at) && <p className="update-check-result muted small" role="status">{outcomeLine(manualOutcome(state, null, null))}</p>}
    {candidate && <div className="support-download" ref={card}>
      <p>{!state?.candidate_fresh || state.last_unreachable.length === 2 ? t('上次发现版本 ') : t('有新版本 ')}<strong>{candidate.version}</strong>{candidate.published_at ? t(' · {v1} 发布', { v1: candidate.published_at.slice(0, 10) }) : ''}<span className="muted small"> {t('· 当前使用 {current_version}', { current_version: state?.current_version })}</span></p>
      {!state?.candidate_fresh && <p className="muted small">{t('上次发现该版本：{v1}，已超过 7 天，请重新检查确认仍可下载。', { v1: stampLabel(candidate.confirmed_at) })}</p>}
      {state?.ignored_version === candidate.version && <p className="muted small">{t('已忽略这个版本的提醒；仍可手动下载。')}</p>}
      {candidate.downloads.length > 0 && <>
        <p>{candidate.downloads[0].label}{candidate.downloads[0].size ? t(' · 约 {v1} MB', { v1: Math.ceil(candidate.downloads[0].size / 1048576) }) : ''}</p>
        <p className="support-actions">
          <button type="button" className="primary" onClick={() => void download(candidate.version, candidate.downloads[0].source, candidate.downloads[0].name)}>{downloadLabel(state?.platform_label ?? '')}</button>
          <button type="button" className="ui-btn" disabled={ignoreBusy} onClick={() => { setIgnoreBusy(true); void ignoreVersion(candidate.version).then(failure => { setIgnoreBusy(false); if (failure) setToggleError(failure); }); }}>{state?.ignored_version === candidate.version ? t('已忽略此版本') : t('忽略此版本')}</button>
        </p>
        <p className="muted small">{t('在浏览器中下载。下载后退出物谱，再运行安装包或替换应用；下载不代表已安装。')}</p>
        {candidate.downloads.length > 1 && <details><summary>{t('其他下载来源')}</summary>{candidate.downloads.slice(1).map(file => <p key={file.source}><button type="button" className="ui-btn" onClick={() => void download(candidate.version, file.source, file.name)}>{t('从 {v1} 下载', { v1: mirror(file.source) })}</button><span className="muted small"> {file.label}</span></p>)}</details>}
      </>}
      <p className="notice">{t('更新前请先到「设置 › 数据管理」做一次')}<strong>{t('完整备份并异地保存')}</strong>{t('：新版如果升级资料格式，旧版将不能打开升级后的资料。安装步骤见使用指南的「更新、换机与卸载」。')}</p>
      <details><summary>{t('发布说明')}</summary><pre className="update-check-notes">{candidate.notes || t('这个版本没有填写发布说明。')}</pre></details>
      {compact && <p><SupportLink target="update">{t('更新与换机说明')}</SupportLink></p>}
      <details><summary>{t('发布页与手动下载')}</summary><p className="update-check-pages">{candidate.sources.map(source => <button key={source} type="button" className="ui-btn" onClick={() => void openPage(candidate.version, source)}>{t('打开 {v1} 发布页', { v1: mirror(source) })}</button>)}</p></details>
    </div>}
    {state?.newer_unavailable && <div className="support-update-unavailable"><p className="muted small">{t('版本 {version} 暂未提供适合当前设备的安装包，无需下载其他平台的文件。', { version: state.newer_unavailable.version })}</p><details><summary>{t('查看该版本发布页')}</summary>{state.newer_unavailable.sources.map(source => <button key={source} type="button" className="ui-btn" onClick={() => void openPage(state.newer_unavailable!.version, source)}>{t('查看 {v1} 发布页', { v1: mirror(source) })}</button>)}</details></div>}
    {toggleError && <p className="error" role="alert">{toggleError}</p>}
  </section>;
}
