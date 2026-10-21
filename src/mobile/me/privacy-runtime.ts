// Screen privacy for the iPhone UI: 身份验证 (面容 ID on iOS) lock, 闲置后重新验证 and 切到后台时遮挡.
// Same preferences, keys and state machine as the desktop PrivacyBoundary (privacy-lock.ts); this file is the
// DOM-level counterpart because the app shell is owned by the foundation. It is installed once by the first
// module that loads (总览 or 我的) and covers the whole page with its own overlay.
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { coverKey, initialPrivacyState, lockKey, privacyTransition, readCoverPreference, readLockPreference, setPrivacyScreenBlocked, shouldCover, writePrivacyPreference } from '../../privacy-lock';
import type { LockPreference, PrivacyEvent, PrivacyState } from '../../privacy-lock';
import { storedPending } from '../../wealth';

export type PrivacySnapshot = { cover: boolean; lock: LockPreference; available: boolean | null; checking: boolean; locked: boolean; error: string };

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
let started = false;
let lock: LockPreference = { enabled: false, idleMinutes: 0 }, cover = false;
let state: PrivacyState = initialPrivacyState(lock, 0);
let available: boolean | null = null, checking = false, error = '';
let overlay: HTMLElement | null = null;
const listeners = new Set<() => void>();
let snapshot: PrivacySnapshot = { cover, lock, available, checking, locked: false, error };

function publish() {
  snapshot = { cover, lock, available, checking, locked: state.locked, error };
  render();
  listeners.forEach(listener => listener());
}
export const privacySnapshot = (): PrivacySnapshot => snapshot;
export function subscribePrivacy(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Editing, saving or an unresolved receipt delays the lock until it settles (desktop: open dialogs and pending requests). */
const busy = (): boolean => !!storedPending() || !!document.querySelector('.m-modal, .m-sheet-layer');
function send(event: PrivacyEvent) {
  const effective = { ...lock, enabled: lock.enabled && available === true };
  const next = privacyTransition(state, event, effective);
  const changed = next.locked !== state.locked || next.away !== state.away || next.deferred !== state.deferred;
  state = next;
  setPrivacyScreenBlocked(next.locked);
  if (changed) publish();
}

async function probe(): Promise<boolean> {
  try {
    const value = await invoke<boolean>('privacy_auth_available');
    available = value; error = '';
    if (!value) send({ type: 'disable', now: Date.now() });
    publish();
    return value;
  } catch (cause) { error = errorMessage(cause); publish(); return false; }
}
export async function unlock(): Promise<void> {
  if (checking) return;
  checking = true; error = ''; publish();
  try {
    const supported = available ?? await probe();
    if (supported) { await invoke('privacy_authenticate'); send({ type: 'unlock', now: Date.now() }); }
  } catch (cause) { error = errorMessage(cause); }
  finally { checking = false; publish(); }
}
/** Turn the lock on or off. Turning it on first needs a successful system verification, like the desktop. */
export async function setLock(value: LockPreference): Promise<boolean> {
  if (value.enabled && !lock.enabled) {
    if (available !== true || checking) return false;
    checking = true; publish();
    try { await invoke('privacy_authenticate'); } finally { checking = false; publish(); }
  }
  if (!writePrivacyPreference(storage(), lockKey, value)) return false;
  lock = value;
  send({ type: value.enabled ? 'unlock' : 'disable', now: Date.now() });
  publish();
  return true;
}
export function setCover(value: boolean): boolean {
  if (!writePrivacyPreference(storage(), coverKey, value)) return false;
  cover = value; publish();
  return true;
}
export const probePrivacy = (): Promise<boolean> => probe();

function render() {
  if (!overlay) return;
  const covered = shouldCover(cover, state), blocked = state.locked || covered;
  const root = document.getElementById('root');
  if (root) { root.toggleAttribute('inert', blocked); if (blocked) root.setAttribute('aria-hidden', 'true'); else root.removeAttribute('aria-hidden'); }
  document.documentElement.toggleAttribute('data-privacy-screen', blocked);
  overlay.hidden = !blocked;
  if (!blocked) return;
  overlay.querySelector('h1')!.textContent = state.locked ? '物谱已锁定' : '物谱内容已遮住';
  const sub = overlay.querySelector<HTMLElement>('.me-lock-sub')!, button = overlay.querySelector<HTMLButtonElement>('button')!, alert = overlay.querySelector<HTMLElement>('[role=alert]')!;
  sub.hidden = button.hidden = !state.locked;
  button.disabled = checking || (available === null && !error);
  button.textContent = checking ? '正在验证…' : available === null && !error ? '正在检查…' : '解锁';
  alert.textContent = state.locked ? error : '';
  if (state.locked && !button.disabled) button.focus({ preventScroll: true });
}

function build(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'me-lock'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'me-lock-title');
  el.innerHTML = '<div class="me-lock-box"><span class="me-lock-mark" aria-hidden="true"></span><h1 id="me-lock-title"></h1><p class="me-lock-sub">验证身份后查看本机资料</p><button type="button" class="m-button m-button-primary"></button><p role="alert" class="me-lock-error"></p></div>';
  el.querySelector('button')!.addEventListener('click', () => void unlock());
  return el;
}

/** Idempotent. Call before the first page renders so a locked library is never shown. */
export function installPrivacy(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  lock = readLockPreference(storage()); cover = readCoverPreference(storage());
  state = initialPrivacyState(lock, Date.now());
  setPrivacyScreenBlocked(state.locked);
  overlay = build(); document.body.appendChild(overlay);
  const away = () => send({ type: 'away', now: Date.now() });
  const returned = () => { if (!document.hidden) send({ type: 'return', now: Date.now(), busy: busy() }); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) away(); else returned(); });
  window.addEventListener('pagehide', away);
  window.addEventListener('pageshow', returned);
  window.addEventListener('blur', away); window.addEventListener('focus', returned);
  for (const name of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(name, () => send({ type: 'activity', now: Date.now() }), { capture: true, passive: true });
  new MutationObserver(() => { if (state.deferred) send({ type: 'settled', now: Date.now(), busy: busy() }); }).observe(document.body, { subtree: true, childList: true });
  publish();
  if (lock.enabled) void probe().then(() => { if (state.locked) void unlock(); });
  else void probe();
}

/** Face ID is the iOS name for the system verification; elsewhere the generic name is used. */
export const authName = (userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string => /iPhone|iPad|iPod/i.test(userAgent) ? '面容 ID' : '身份验证';
