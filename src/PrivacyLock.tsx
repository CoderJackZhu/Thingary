import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LogoMark } from './LogoMark';
import { errorMessage } from './asset';
import { coverKey, lockKey, initialPrivacyState, privacyTransition, readCoverPreference, readLockPreference, setPrivacyScreenBlocked, shouldCover, writePrivacyPreference } from './privacy-lock';
import type { LockPreference, PrivacyEvent } from './privacy-lock';
import './privacy-lock.css';

function storage() { try { return window.localStorage; } catch { return null; } }
const PrivacyContext = createContext<{
  cover: boolean; lock: LockPreference; available: boolean | null; checking: boolean;
  setCover: (value: boolean) => boolean; setLock: (value: LockPreference) => Promise<boolean>;
} | null>(null);

/** Startup children are never mounted until the native capability probe and
 * authentication finish. Later locks keep exactly the same child tree alive. */
export function PrivacyBoundary({ children }: { children: (onBusy: (busy: boolean) => void) => ReactNode }) {
  const [lock, updateLock] = useState(() => readLockPreference(storage()));
  const [cover, updateCover] = useState(() => readCoverPreference(storage()));
  const [state, updateState] = useState(() => initialPrivacyState(lock, Date.now()));
  const stateRef = useRef(state), lockRef = useRef(lock);
  const busy = useRef(false), authenticating = useRef(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const availableRef = useRef<boolean | null>(null);
  const [checking, setChecking] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const isBusy = () => busy.current || !!document.querySelector('dialog[open]:not(.privacy-screen)');
  const send = useCallback((event: PrivacyEvent) => {
    const effective = { ...lockRef.current, enabled: lockRef.current.enabled && availableRef.current === true };
    const next = privacyTransition(stateRef.current, event, effective);
    stateRef.current = next;
    setPrivacyScreenBlocked(next.locked);
    if (event.type !== 'activity') updateState(next);
  }, []);
  const onBusy = useCallback((value: boolean) => {
    busy.current = value;
    if (stateRef.current.deferred) send({ type: 'settled', now: Date.now(), busy: isBusy() });
  }, [send]);
  async function probe() {
    try {
      const value = await invoke<boolean>('privacy_auth_available');
      availableRef.current = value; setAvailable(value); setError('');
      if (!value) send({ type: 'disable', now: Date.now() });
      return value;
    } catch (e) { setError(errorMessage(e)); return false; }
  }
  async function unlock() {
    if (authenticating.current) return;
    authenticating.current = true; setChecking(true); setError('');
    try {
      const supported = availableRef.current ?? await probe();
      if (supported) {
        await invoke('privacy_authenticate');
        send({ type: 'unlock', now: Date.now() });
      }
    } catch (e) { setError(errorMessage(e)); }
    finally { authenticating.current = false; setChecking(false); }
  }
  useLayoutEffect(() => { setPrivacyScreenBlocked(stateRef.current.locked); }, []);
  useEffect(() => { void probe(); }, []);
  useEffect(() => { if (state.locked && available === true) void unlock(); }, [state.locked, available]);
  useEffect(() => {
    const away = () => send({ type: 'away', now: Date.now() });
    const returned = () => { if (!document.hidden) send({ type: 'return', now: Date.now(), busy: isBusy() }); };
    const visibility = () => { if (document.hidden) away(); else if (document.hasFocus()) returned(); };
    const activity = () => send({ type: 'activity', now: Date.now() });
    window.addEventListener('blur', away); window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', visibility);
    if (document.hidden || !document.hasFocus()) away();
    for (const name of ['keydown', 'pointerdown', 'pointermove', 'scroll', 'wheel']) window.addEventListener(name, activity, { capture: true, passive: true });
    const observer = new MutationObserver(() => { if (stateRef.current.deferred) send({ type: 'settled', now: Date.now(), busy: isBusy() }); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => {
      observer.disconnect(); window.removeEventListener('blur', away); window.removeEventListener('focus', returned); document.removeEventListener('visibilitychange', visibility);
      for (const name of ['keydown', 'pointerdown', 'pointermove', 'scroll', 'wheel']) window.removeEventListener(name, activity, true);
    };
  }, [send]);
  const covered = shouldCover(cover, state), blocked = state.locked || covered;
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-privacy-screen', blocked);
    if (blocked && !dialog.current?.open) dialog.current?.showModal();
    if (!blocked && dialog.current?.open) dialog.current.close();
  }, [blocked]);
  function setCover(value: boolean) {
    if (!writePrivacyPreference(storage(), coverKey, value)) return false;
    updateCover(value); return true;
  }
  async function setLock(value: LockPreference) {
    if (value.enabled && !lockRef.current.enabled) {
      if (availableRef.current !== true || authenticating.current) return false;
      authenticating.current = true; setChecking(true);
      try { await invoke('privacy_authenticate'); }
      finally { authenticating.current = false; setChecking(false); }
    }
    if (!writePrivacyPreference(storage(), lockKey, value)) return false;
    lockRef.current = value; updateLock(value);
    send({ type: value.enabled ? 'unlock' : 'disable', now: Date.now() });
    return true;
  }
  return <PrivacyContext.Provider value={{ cover, lock, available, checking, setCover, setLock }}>
    <div className="privacy-app" inert={blocked} aria-hidden={blocked || undefined}>{state.mounted && children(onBusy)}</div>
    <dialog ref={dialog} className="privacy-screen" aria-labelledby="privacy-screen-heading" onCancel={event => event.preventDefault()}>
      <div className="privacy-screen-content"><span className="privacy-mark"><LogoMark maskId="privacy-screen-logo"/></span>
        <h1 id="privacy-screen-heading">{state.locked ? '物谱已锁定' : '物谱内容已遮住'}</h1>
        {state.locked && <><p className="muted">验证身份后查看本机资料</p><button type="button" className="ui-btn primary" disabled={checking || (available === null && !error)} onClick={() => void unlock()}>{checking ? '正在验证…' : available === null && !error ? '正在检查…' : '解锁'}</button>{error && <p role="alert">{error}</p>}</>}
      </div>
    </dialog>
  </PrivacyContext.Provider>;
}

export function PrivacySettings() {
  const privacy = useContext(PrivacyContext);
  const [error, setError] = useState('');
  if (!privacy) return null;
  const windows = /Windows/i.test(navigator.userAgent);
  async function changeLock(value: LockPreference) {
    setError('');
    try { if (!await privacy!.setLock(value)) setError('无法保存隐私设置，请重试。'); }
    catch (e) { setError(errorMessage(e)); }
  }
  return <section className="privacy-settings" aria-labelledby="privacy-settings-heading">
    <h3 id="privacy-settings-heading">屏幕隐私</h3>
    <label className="privacy-toggle"><input type="checkbox" checked={privacy.cover} onChange={event => { setError(privacy.setCover(event.target.checked) ? '' : '无法保存隐私设置，请重试。'); }}/>窗口不在前台时遮住内容</label>
    <label className="privacy-toggle"><input type="checkbox" checked={privacy.lock.enabled} disabled={windows || privacy.available !== true || privacy.checking} onChange={event => void changeLock({ ...privacy.lock, enabled: event.target.checked })}/>打开物谱时需要验证身份</label>
    {windows ? <p className="muted small">Windows 版暂不支持</p> : privacy.available === false ? <p className="muted small">这台 Mac 没有设置登录密码或 Touch ID</p> : privacy.available === null ? <p className="muted small">暂未确认这台设备是否支持验证身份</p> : null}
    <label className="privacy-idle">闲置后重新验证<select value={privacy.lock.idleMinutes} disabled={!privacy.lock.enabled || privacy.available !== true || privacy.checking} onChange={event => void changeLock({ ...privacy.lock, idleMinutes: Number(event.target.value) })}><option value="0">从不</option><option value="5">5 分钟</option><option value="15">15 分钟</option><option value="60">1 小时</option></select></label>
    <p className="small muted">这只是防止旁人看到屏幕，不会加密资料库文件。可另行创建加密备份；本机资料库文件仍未加密。</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
