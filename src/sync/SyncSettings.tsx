// 设置 › 数据管理 的同步区块。All copy and the available actions come from
// `syncView`; this file only wires them to the typed sync commands. WebDAV
// credentials never leave the local config, the passphrase is only kept in
// this component while the dialog is open, and a pulled snapshot is handed to
// the existing backup restore confirmation instead of restoring anything here.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../asset';
import { formatBytes } from '../auto-backup-format.ts';
import { FormRow } from '../FormControls';
import { t } from '../i18n.ts';
import {
  syncConfigGet,
  syncConfigSet,
  syncPullInspect,
  syncPush,
  syncResolveConflict,
  syncStatus,
  syncTestConnection,
  syncUnlock,
  type SyncConfigInput,
  type SyncPublicConfig,
  type SyncPullInspection,
  type SyncStatusResult,
} from './api';
import { syncView, type SyncAction, type SyncErrorLike } from './state';

type FormState = {
  baseUrl: string;
  username: string;
  password: string;
  basePath: string;
  deviceName: string;
};

const emptyForm: FormState = {
  baseUrl: '',
  username: '',
  password: '',
  basePath: '',
  deviceName: '',
};

/** A thrown command error, keeping the structured code for the view model. */
function asSyncError(error: unknown): SyncErrorLike {
  if (error && typeof error === 'object') {
    const value = error as SyncErrorLike;
    return { code: value.code ?? null, message: value.message ?? errorMessage(error) };
  }
  return { message: errorMessage(error) };
}

function formFromConfig(config: SyncPublicConfig): FormState {
  return {
    baseUrl: config.base_url,
    username: config.username,
    password: '',
    basePath: config.base_path,
    deviceName: config.device_name,
  };
}

export function SyncSettings({
  blocked,
  onPull,
}: {
  /** Another data operation owns the library right now. */
  blocked: boolean;
  /** Hands a read-only pull inspection to the existing restore confirmation. */
  onPull: (inspection: SyncPullInspection) => boolean;
}) {
  const [config, setConfig] = useState<SyncPublicConfig | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [status, setStatus] = useState<SyncStatusResult | null>(null);
  const [error, setError] = useState<SyncErrorLike | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'config' | 'test' | 'sync' | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [passOpen, setPassOpen] = useState(false);
  const [passError, setPassError] = useState('');
  const alive = useRef(true), lock = useRef(false), pendingSync = useRef(false);
  const urlInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: SyncPublicConfig | null = null;
      try {
        loaded = await syncConfigGet();
        if (!cancelled) { setConfig(loaded); setForm(formFromConfig(loaded)); }
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
      try {
        const next = await syncStatus();
        if (!cancelled) { setStatus(next); setError(null); }
      } catch (e) {
        if (!cancelled) setError(asSyncError(e));
      }
      // A push whose manifest reply was lost must be reconciled, not retried.
      if (!cancelled && loaded?.has_pending_push) setError({ code: 'SYNC_RESULT_UNKNOWN', message: '' });
    })();
    return () => { cancelled = true; };
  }, []);

  const setField = (key: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) =>
    setForm(previous => ({ ...previous, [key]: event.target.value }));

  const dirty = !!config && (
    form.baseUrl !== config.base_url ||
    form.username !== config.username ||
    form.basePath !== config.base_path ||
    form.deviceName !== config.device_name ||
    form.password !== ''
  );

  async function refreshStatus(): Promise<SyncStatusResult | null> {
    try {
      const next = await syncStatus();
      if (alive.current) { setStatus(next); setError(null); }
      return next;
    } catch (e) {
      if (alive.current) setError(asSyncError(e));
      return null;
    }
  }

  async function saveConfig() {
    if (busy) return;
    setBusy('config'); setActionError(''); setNotice('');
    try {
      const input: SyncConfigInput = {
        baseUrl: form.baseUrl.trim(),
        username: form.username.trim(),
        basePath: form.basePath.trim(),
        deviceName: form.deviceName.trim(),
      };
      if (form.password) input.password = form.password;
      await syncConfigSet(input);
      const next = await syncConfigGet();
      if (!alive.current) return;
      setConfig(next);
      setForm(formFromConfig(next));
      setNotice(t('同步设置已保存。'));
      setError(null);
      await refreshStatus();
    } catch (e) {
      if (alive.current) setActionError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function testConnection() {
    if (busy) return;
    if (!config?.enabled || dirty) { setActionError(t('请先保存设置，再测试连接。')); return; }
    setBusy('test'); setActionError(''); setNotice('');
    try {
      const result = await syncTestConnection();
      if (!alive.current) return;
      if (!result.ok) { setActionError(t('连接失败，请核对地址、用户名与应用密码。')); return; }
      const space = result.free_space != null ? t('可用空间 {v1}。', { v1: formatBytes(result.free_space) }) : '';
      setNotice(result.supports_etag
        ? t('连接成功，服务器支持条件写入。{v1}', { v1: space })
        : t('连接成功；此服务器无法防止同时写入。{v1}', { v1: space }));
    } catch (e) {
      if (alive.current) setActionError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  function openPassphrase(intent: 'sync' | 'unlock') {
    pendingSync.current = intent === 'sync';
    setPassError('');
    setPassOpen(true);
  }

  /** Status-driven sync steps; callers own the busy flag and error handling. */
  async function syncSteps() {
    const next = await syncStatus();
    if (!alive.current) return;
    setStatus(next); setError(null);
    if (next.state === 'local_ahead' || next.state === 'empty_remote') {
      const result = await syncPush();
      if (!alive.current) return;
      setNotice(t('已上传到云端（版本 {version}）。', { version: result.version }));
      await refreshStatus();
    } else if (next.state === 'remote_ahead') {
      await pullSnapshot();
    } else if (next.state === 'conflict') {
      setNotice(t('本机与云端都有改动，请选择保留本机、采用云端或取消。'));
    }
  }

  async function pullSnapshot() {
    const inspection = await syncPullInspect();
    if (!alive.current) return;
    if (!onPull(inspection)) {
      throw { code: 'SYNC_PULL', message: t('云端快照缺少可恢复的摘要，未改动本机资料。') };
    }
    setNotice(t('已读取云端快照，请在下方确认是否替换本机资料。'));
  }

  async function runSync() {
    if (busy || lock.current || blocked) return;
    lock.current = true; setBusy('sync'); setError(null); setActionError(''); setNotice('');
    try {
      await syncSteps();
    } catch (e) {
      if (alive.current) {
        const failure = asSyncError(e);
        setError(failure);
        if (failure.code === 'SYNC_LOCKED' || failure.code === 'SYNC_PASSPHRASE') openPassphrase('sync');
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function reconcile() {
    if (busy || lock.current) return;
    lock.current = true; setBusy('sync'); setError(null); setActionError(''); setNotice('');
    try {
      const next = await refreshStatus();
      if (alive.current && next) setNotice(t('已核对云端状态，未写入任何资料。'));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function resolve(choice: 'keep_local' | 'use_remote') {
    if (busy || lock.current || blocked) return;
    lock.current = true; setBusy('sync'); setError(null); setActionError(''); setNotice('');
    try {
      const result = await syncResolveConflict(choice);
      if (!alive.current) return;
      if (choice === 'use_remote') {
        const inspection = result as SyncPullInspection;
        if (!onPull(inspection)) {
          throw { code: 'SYNC_PULL', message: t('云端快照缺少可恢复的摘要，未改动本机资料。') };
        }
        setNotice(t('已读取云端快照，请在下方确认是否替换本机资料。'));
      } else {
        const pushed = result as { version: number };
        setNotice(t('已用本机资料覆盖云端（版本 {version}）。', { version: pushed.version }));
        await refreshStatus();
      }
    } catch (e) {
      if (alive.current) setError(asSyncError(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  }

  /** Cancel keeps the conflict as it is; only the local view is refreshed. */
  async function cancelConflict() {
    if (busy) return;
    setNotice(t('已取消，本机与云端均未改动。'));
    setError(null);
    await refreshStatus();
  }

  async function checkUpdates() {
    setActionError(''); setNotice('');
    try {
      await invoke('update_check_request', { mode: 'manual' });
      if (alive.current) setNotice(t('已开始检查更新，可在「设置 › 支持」查看结果。'));
    } catch (e) {
      if (alive.current) setActionError(errorMessage(e));
    }
  }

  async function unlock(passphrase: string) {
    if (busy) return;
    const continueSync = pendingSync.current;
    setBusy('sync'); setPassError('');
    try {
      await syncUnlock(passphrase);
      if (!alive.current) return;
      setPassOpen(false); pendingSync.current = false;
      if (continueSync) await syncSteps(); else await refreshStatus();
    } catch (e) {
      if (alive.current) setPassError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  function act(action: SyncAction) {
    switch (action.id) {
      case 'sync':
      case 'retry':
      case 'pull':
        void runSync();
        break;
      case 'reconcile':
        void reconcile();
        break;
      case 'unlock':
        openPassphrase('unlock');
        break;
      case 'configure':
        urlInput.current?.focus();
        break;
      case 'upgrade':
        void checkUpdates();
        break;
      case 'cancel':
        void cancelConflict();
        break;
      case 'keep_local':
        void resolve('keep_local');
        break;
      case 'use_remote':
        void resolve('use_remote');
        break;
    }
  }

  const view = syncView(status, error);
  const actions = [...(view.primaryAction ? [view.primaryAction] : []), ...view.secondaryActions];
  // Twice only when there is no cloud copy yet and this device never pushed.
  const firstTime = !!status && !status.remote && config?.last_synced_remote_version == null;
  const disabled = busy !== null || blocked;
  const showIntro = !config?.enabled || status?.state === 'unconfigured' || error?.code === 'SYNC_UNCONFIGURED';
  const ready = config !== null || status !== null || error !== null || loadError !== '';

  return <div className="sync-settings" aria-labelledby="sync-heading" aria-busy={busy !== null}>
    <div className="sync-head">
      <div>
        <h3 id="sync-heading">{t('同步')}</h3>
        <p>{t('手动把加密整库快照上传到你自己的 WebDAV，或从云端拉取。')}</p>
      </div>
    </div>

    {showIntro && <p className="notice">{t('只在你点同步时联网，只连接你自己的 WebDAV，服务器只看到加密数据。')}</p>}

    <div className="sync-form">
      <FormRow label={t('地址')} hint={t('WebDAV 地址，包含协议；例如坚果云、Nextcloud 或群晖。')}>
        <input ref={urlInput} type="url" spellCheck={false} autoComplete="off" aria-label={t('WebDAV 地址')} placeholder="https://dav.example.com/…" value={form.baseUrl} disabled={busy !== null} onChange={setField('baseUrl')}/>
      </FormRow>
      <FormRow label={t('用户名')}>
        <input spellCheck={false} autoComplete="username" aria-label={t('WebDAV 用户名')} value={form.username} disabled={busy !== null} onChange={setField('username')}/>
      </FormRow>
      <FormRow label={t('应用密码')} hint={t('优先使用 WebDAV 应用密码，不要填登录密码。保存后不会再次显示。')}>
        <input type="password" autoComplete="off" spellCheck={false} aria-label={t('WebDAV 应用密码')} placeholder={config?.has_password ? t('已保存') : t('请输入应用密码')} value={form.password} disabled={busy !== null} onChange={setField('password')}/>
      </FormRow>
      <FormRow label={t('路径')} hint={t('远端基础路径，留空表示 WebDAV 根目录。')}>
        <input spellCheck={false} autoComplete="off" aria-label={t('WebDAV 路径')} placeholder={t('留空为根目录')} value={form.basePath} disabled={busy !== null} onChange={setField('basePath')}/>
      </FormRow>
      <FormRow label={t('设备名')} hint={t('用来在云端区分这台设备。')}>
        <input spellCheck={false} autoComplete="off" aria-label={t('同步设备名')} placeholder={t('例如：我的 MacBook')} value={form.deviceName} disabled={busy !== null} onChange={setField('deviceName')}/>
      </FormRow>
    </div>

    <div className="sync-actions sync-config-actions">
      <button type="button" disabled={busy !== null || !config?.enabled || dirty} onClick={() => void testConnection()}>{busy === 'test' ? t('正在测试连接…') : t('测试连接')}</button>
      <button type="button" className="primary" disabled={busy !== null || !form.baseUrl.trim() || !form.username.trim() || !form.deviceName.trim() || (!form.password && !config?.has_password)} onClick={() => void saveConfig()}>{busy === 'config' ? t('正在保存…') : t('保存')}</button>
    </div>

    {ready && <div className={`sync-state ${view.tone}`}>
      <h3>{view.headline}</h3>
      <p>{view.detail}</p>
      {actions.length > 0 && <div className="sync-actions">
        {actions.map(action => <button
          key={action.id}
          type="button"
          className={[action.id === 'cancel' || action.destructive ? '' : 'primary', action.destructive ? 'danger' : ''].filter(Boolean).join(' ') || undefined}
          disabled={disabled}
          onClick={() => act(action)}
        >{action.label}</button>)}
      </div>}
      {actions.some(action => action.consequence) && <ul className="sync-consequences">
        {actions.filter(action => action.consequence).map(action => <li key={action.id}><strong>{action.label}</strong>：{action.consequence}</li>)}
      </ul>}
    </div>}

    {loadError && <p className="notice error" role="alert">{t('同步设置读取失败：{loadError}', { loadError })}</p>}
    {actionError && <p className="notice error" role="alert">{actionError}</p>}
    {error?.message && <p className="notice error" role="alert">{error.message}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    {passOpen && <PassphraseDialog
      firstTime={firstTime}
      busy={busy === 'sync'}
      error={passError}
      onCancel={() => { setPassOpen(false); setPassError(''); pendingSync.current = false; }}
      onSubmit={passphrase => void unlock(passphrase)}
    />}
  </div>;
}

function PassphraseDialog({ firstTime, busy, error, onCancel, onSubmit }: { firstTime: boolean; busy: boolean; error: string; onCancel: () => void; onSubmit: (passphrase: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  useEffect(() => { const opened = dialog.current; opened?.showModal(); return () => opened?.close(); }, []);
  const mismatch = firstTime && again.length > 0 && passphrase !== again;
  const incomplete = !passphrase || (firstTime && passphrase !== again);
  return <dialog ref={dialog} className="editor leave-confirm sync-passphrase" aria-labelledby="sync-passphrase-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="sync-passphrase-title">{firstTime ? t('设置同步口令') : t('输入同步口令')}</h2>
    <p className="muted">{firstTime
      ? t('第一次上传会创建同步口令，请输入两次。口令只在本次运行的内存中保留，不会保存到磁盘。')
      : t('口令只用于本次同步，保留在内存中，10 分钟后自动失效。')}</p>
    <p className="notice">{t('忘记口令后云端副本无法恢复，本机资料不受影响。')}</p>
    <label className="field"><span>{t('同步口令')}</span><input type="password" autoComplete="off" spellCheck={false} aria-label={t('同步口令')} value={passphrase} disabled={busy} onChange={event => setPassphrase(event.target.value)}/></label>
    {firstTime && <label className="field"><span>{t('再次输入同步口令')}</span><input type="password" autoComplete="off" spellCheck={false} aria-label={t('再次输入同步口令')} value={again} disabled={busy} onChange={event => setAgain(event.target.value)}/></label>}
    {(mismatch || error) && <p className="notice error" role="alert">{mismatch ? t('两次输入的口令不一致。') : error}</p>}
    <div className="leave-confirm-actions">
      <button type="button" disabled={busy} onClick={onCancel}>{t('取消')}</button>
      <button type="button" className="primary" disabled={busy || incomplete} onClick={() => onSubmit(passphrase)}>{firstTime ? t('设置口令并同步') : t('解锁并同步')}</button>
    </div>
  </dialog>;
}
