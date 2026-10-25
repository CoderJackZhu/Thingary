// 设置 › 数据管理 的同步区块。All copy and the available actions come from
// `syncView`; this file only wires them to the typed sync commands. WebDAV
// credentials never leave the local config, the passphrase is only kept in
// this component while the dialog is open, and a pulled snapshot is handed to
// the existing backup restore confirmation instead of restoring anything here.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../asset';
import { formatBytes, formatWhen } from '../auto-backup-format.ts';
import { FormRow, Segments, Switch } from '../FormControls';
import { t } from '../i18n.ts';
import {
  syncCompareRemote,
  syncConfigGet,
  syncConfigSet,
  syncDisable,
  syncForgetPassphrase,
  syncPassphraseReveal,
  syncSetAutoCheck,
  syncPullInspect,
  syncPush,
  syncReconcile,
  syncResolveConflict,
  syncStatus,
  syncTestConnection,
  syncUnlock,
  type SyncConfigInput,
  type SyncPublicConfig,
  type SyncPullInspection,
  type SyncStatusResult,
} from './api';
import { reportSync } from './auto';
import { lastSyncInfo, reconcileNotice, syncView, type SyncAction, type SyncErrorLike } from './state';
import { getSyncSettingsPreview } from './preview-state';

type FormState = {
  baseUrl: string;
  username: string;
  password: string;
  basePath: string;
  deviceName: string;
};

const PROVIDERS = [
  { id: 'jianguoyun', url: 'https://dav.jianguoyun.com/dav/' },
  { id: 'nextcloud', url: 'https://你的域名/remote.php/dav/files/你的用户名/' },
  { id: 'synology', url: 'https://你的域名:5006/' },
] as const;

function providerLabel(id: string) {
  switch (id) {
    case 'jianguoyun': return t('坚果云');
    case 'nextcloud': return 'Nextcloud';
    case 'synology': return t('群晖');
    default: return t('其他');
  }
}

function providerHint(id: string | null) {
  switch (id) {
    case 'jianguoyun': return t('在坚果云网页「账户信息 › 安全选项 › 第三方应用管理」添加应用，把生成的密码填到下面；用户名是你的坚果云邮箱。');
    case 'nextcloud': return t('把地址里的域名和用户名换成你自己的；密码请在「设置 › 安全」里创建应用密码。');
    case 'synology': return t('在群晖套件中心安装并启用 WebDAV Server，地址用 HTTPS 的 5006 端口。');
    case 'other': return t('填写你的 WebDAV 地址（需要 https）、用户名和应用密码。');
    default: return t('选一个会自动填好地址；其他服务选「其他」后自己填。');
  }
}

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
  const [busy, setBusy] = useState<'config' | 'test' | 'sync' | 'disable' | null>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [passOpen, setPassOpen] = useState(false);
  const [passError, setPassError] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableError, setDisableError] = useState('');
  const [compare, setCompare] = useState<{ remote: SyncPullInspection } | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [method, setMethod] = useState<'none' | 'webdav'>('none');
  const pendingPush = useRef(false);
  const alive = useRef(true), lock = useRef(false), pendingSync = useRef(false);
  const urlInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await syncConfigGet();
        if (cancelled) return;
        setConfig(loaded); setForm(formFromConfig(loaded));
        if (loaded.enabled || loaded.base_url || loaded.has_pending_push) setMethod('webdav');
        pendingPush.current = loaded.has_pending_push;
        if (loaded.has_pending_push || !loaded.enabled) {
          setError({ code: loaded.has_pending_push ? 'SYNC_RESULT_UNKNOWN' : 'SYNC_UNCONFIGURED', message: '' });
        } else {
          // Fictional preview states are supplied synchronously by the
          // development-only bootstrap, never by a sync_status invocation.
          const preview = getSyncSettingsPreview();
          if (preview) { setStatus(preview.status); setError(preview.error); }
        }
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
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
      const latestConfig = await syncConfigGet();
      if (alive.current) {
        pendingPush.current = latestConfig.has_pending_push;
        setStatus(next); setConfig(latestConfig); reportSync(latestConfig.enabled, next.state);
        setError(latestConfig.has_pending_push ? { code: 'SYNC_RESULT_UNKNOWN', message: '' } : null);
      }
      return next;
    } catch (e) {
      if (alive.current) {
        const failure = asSyncError(e);
        if (failure.code === 'SYNC_RESULT_UNKNOWN') pendingPush.current = true;
        setError(failure);
      }
      return null;
    }
  }

  async function saveConfig() {
    if (busy || pendingPush.current || !config) return;
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
      if (!alive.current) return;
      setStatus(null); setError(null);
      const next = await syncConfigGet();
      if (!alive.current) return;
      setConfig(next);
      setForm(formFromConfig(next));
      reportSync(next.enabled, null);
      setNotice(t('同步设置已保存。'));
      pendingPush.current = next.has_pending_push;
      setError(next.has_pending_push ? { code: 'SYNC_RESULT_UNKNOWN', message: '' } : null);
    } catch (e) {
      if (alive.current) setActionError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function testConnection() {
    if (busy || pendingPush.current) return;
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
    if (busy || lock.current || blocked || pendingPush.current || !config?.enabled) return;
    lock.current = true; setBusy('sync'); setError(null); setActionError(''); setNotice('');
    try {
      await syncSteps();
    } catch (e) {
      if (alive.current) {
        const failure = asSyncError(e);
        if (failure.code === 'SYNC_RESULT_UNKNOWN') pendingPush.current = true;
        setError(failure);
        if (failure.code === 'SYNC_LOCKED' || failure.code === 'SYNC_PASSPHRASE') openPassphrase('sync');
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function checkCloud() {
    if (busy || lock.current || blocked || pendingPush.current || !config?.enabled) return;
    lock.current = true; setBusy('sync'); setActionError(''); setNotice('');
    try { await refreshStatus(); }
    finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function reconcile() {
    if (busy || lock.current || blocked || !config?.enabled) return;
    lock.current = true; setBusy('sync'); setActionError(''); setNotice('');
    try {
      const result = await syncReconcile();
      if (!alive.current) return;
      pendingPush.current = false;
      setError(null);
      setNotice(reconcileNotice(result));
      await refreshStatus();
    } catch (e) {
      if (alive.current) {
        if (pendingPush.current) {
          setError({ code: 'SYNC_RESULT_UNKNOWN', message: '' });
          setActionError(errorMessage(e));
        } else setError(asSyncError(e));
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function resolve(choice: 'keep_local' | 'use_remote') {
    if (busy || lock.current || blocked || pendingPush.current || !config?.enabled) return;
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
      if (alive.current) {
        const failure = asSyncError(e);
        if (failure.code === 'SYNC_RESULT_UNKNOWN') pendingPush.current = true;
        setError(failure);
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  }

  /** Shows how many records each side holds; restores nothing. */
  async function compareSides() {
    if (busy || lock.current) return;
    lock.current = true; setBusy('sync'); setActionError('');
    try {
      const remote = await syncCompareRemote();
      if (alive.current) setCompare({ remote });
    } catch (e) {
      if (alive.current) {
        const failure = asSyncError(e);
        if (failure.code === 'SYNC_LOCKED' || failure.code === 'SYNC_PASSPHRASE') { setError(failure); openPassphrase('unlock'); }
        else setActionError(failure.message ?? '');
      }
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

  async function unlock(passphrase: string, remember: boolean) {
    if (busy) return;
    const continueSync = pendingSync.current;
    setBusy('sync'); setPassError('');
    let unlocked = false;
    try {
      await syncUnlock(passphrase, remember);
      if (!alive.current) return;
      unlocked = true;
      setConfig(await syncConfigGet());
      setPassOpen(false); pendingSync.current = false;
      if (continueSync) await syncSteps(); else await refreshStatus();
    } catch (e) {
      if (alive.current) {
        if (!unlocked) setPassError(errorMessage(e));
        else {
          const failure = asSyncError(e);
          if (failure.code === 'SYNC_RESULT_UNKNOWN') pendingPush.current = true;
          setError(failure);
        }
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  async function disableSync(forgetCredentials: boolean) {
    if (busy || lock.current || blocked || pendingPush.current || !config?.enabled) return;
    lock.current = true; setBusy('disable'); setDisableError('');
    try {
      await syncDisable(forgetCredentials);
      if (!alive.current) return;
      const disabledConfig: SyncPublicConfig = {
        ...config, enabled: false, has_pending_push: false,
        ...(forgetCredentials ? { base_url: '', username: '', base_path: '', has_password: false, has_remembered_passphrase: false, auto_check: false, last_synced_at: null, last_synced_remote_version: null } : {}),
      };
      setConfig(disabledConfig); setForm(formFromConfig(disabledConfig)); reportSync(false, null);
      setStatus(null); setError({ code: 'SYNC_UNCONFIGURED', message: '' }); setMethod('none');
      setNotice(t('同步已停用，不会删除云端数据。')); setActionError('');
      setPassOpen(false); setDisableOpen(false);
      pendingSync.current = false;
    } catch (e) {
      if (alive.current) setDisableError(errorMessage(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function revealPassphrase() {
    if (revealed !== null) { setRevealed(null); return; }
    try { setRevealed(await syncPassphraseReveal()); } catch (e) { setActionError(errorMessage(e)); }
  }

  async function forgetPassphrase() {
    try {
      await syncForgetPassphrase(); setRevealed(null);
      setConfig(await syncConfigGet());
      setNotice(t('已不再记住口令，下次同步需要重新输入。'));
    } catch (e) { setActionError(errorMessage(e)); }
  }

  async function toggleAutoCheck(value: boolean) {
    try { await syncSetAutoCheck(value); setConfig(await syncConfigGet()); } catch (e) { setActionError(errorMessage(e)); }
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
      case 'check':
        void checkCloud();
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
      case 'compare':
        void compareSides();
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

  function pickMethod(next: 'none' | 'webdav') {
    if (next === 'none' && config?.enabled) { setDisableError(''); setDisableOpen(true); return; }
    setMethod(next);
  }

  const view = syncView(status, error, config);
  const actions = [...(view.primaryAction ? [view.primaryAction] : []), ...view.secondaryActions];
  // Twice only when there is no cloud copy yet and this device never pushed.
  const firstTime = !!status && !status.remote && config?.last_synced_remote_version == null;
  const disabled = busy !== null || blocked;
  const configDisabled = busy !== null || pendingPush.current || config === null;
  const history = config?.enabled ? lastSyncInfo(config, status) : null;
  const showIntro = !config?.enabled || status?.state === 'unconfigured' || error?.code === 'SYNC_UNCONFIGURED';
  const ready = config !== null || status !== null || error !== null || loadError !== '';

  return <div className="sync-settings" aria-labelledby="sync-heading" aria-busy={busy !== null}>
    <div className="sync-head">
      <div>
        <h3 id="sync-heading">{t('同步')}</h3>
        <p>{t('把加密整库快照同步到你自己的 WebDAV，在多台设备间使用同一份资料。')}</p>
      </div>
    </div>

    <FormRow label={t('同步方式')} hint={t('默认不同步，资料只在本机。')}>
      <Segments label={t('同步方式')} value={method} disabled={busy !== null || pendingPush.current} onChange={pickMethod} options={[{ value: 'none', label: t('不同步') }, { value: 'webdav', label: 'WebDAV' }]}/>
    </FormRow>

    {method === 'none' && !loadError && <p className="notice">{t('不会联网。需要在多台设备之间同步时，选择 WebDAV。')}</p>}

    {method === 'webdav' && <>
    {showIntro && <p className="notice">{t('只连接你自己的 WebDAV，服务器只看到加密数据。填好并保存后即可同步。')}</p>}

    <div className="sync-form">
      <FormRow label={t('服务商')} hint={providerHint(provider)}>
        <div className="sync-actions">
          {PROVIDERS.map(p => <button key={p.id} type="button" aria-pressed={provider === p.id} disabled={configDisabled} onClick={() => { setProvider(p.id); setForm(previous => ({ ...previous, baseUrl: p.url })); }}>{providerLabel(p.id)}</button>)}
          <button type="button" aria-pressed={provider === 'other'} disabled={configDisabled} onClick={() => setProvider('other')}>{providerLabel('other')}</button>
        </div>
      </FormRow>
      <FormRow label={t('地址')} hint={t('WebDAV 地址，包含协议；例如坚果云、Nextcloud 或群晖。')}>
        <input ref={urlInput} type="url" spellCheck={false} autoComplete="off" aria-label={t('WebDAV 地址')} placeholder="https://dav.example.com/…" value={form.baseUrl} disabled={configDisabled} onChange={setField('baseUrl')}/>
      </FormRow>
      <FormRow label={t('用户名')}>
        <input spellCheck={false} autoComplete="username" aria-label={t('WebDAV 用户名')} value={form.username} disabled={configDisabled} onChange={setField('username')}/>
      </FormRow>
      <FormRow label={t('应用密码')} hint={t('优先使用 WebDAV 应用密码，不要填登录密码。保存后不会再次显示。')}>
        <input type="password" autoComplete="off" spellCheck={false} aria-label={t('WebDAV 应用密码')} placeholder={config?.has_password ? t('已保存') : t('请输入应用密码')} value={form.password} disabled={configDisabled} onChange={setField('password')}/>
      </FormRow>
      <FormRow label={t('路径')} hint={t('远端基础路径，留空表示 WebDAV 根目录。')}>
        <input spellCheck={false} autoComplete="off" aria-label={t('WebDAV 路径')} placeholder={t('留空为根目录')} value={form.basePath} disabled={configDisabled} onChange={setField('basePath')}/>
      </FormRow>
      <FormRow label={t('设备名')} hint={t('用来在云端区分这台设备。')}>
        <input spellCheck={false} autoComplete="off" aria-label={t('同步设备名')} placeholder={t('例如：我的 MacBook')} value={form.deviceName} disabled={configDisabled} onChange={setField('deviceName')}/>
      </FormRow>
    </div>

    <div className="sync-actions sync-config-actions">
      <button type="button" disabled={configDisabled || !config?.enabled || dirty} onClick={() => void testConnection()}>{busy === 'test' ? t('正在测试连接…') : t('测试连接')}</button>
      <button type="button" className="primary" disabled={configDisabled || !form.baseUrl.trim() || !form.username.trim() || !form.deviceName.trim() || (!form.password && !config?.has_password)} onClick={() => void saveConfig()}>{busy === 'config' ? t('正在保存…') : t('保存')}</button>
      {config?.enabled && <button type="button" disabled={configDisabled || blocked} onClick={() => { setDisableError(''); setDisableOpen(true); }}>{t('停用同步')}</button>}
    </div>

    {config?.enabled && <div className="sync-form sync-extras">
      <FormRow label={t('同步口令')} hint={config.has_remembered_passphrase ? t('已记住在这台设备；换新设备时需要它。') : t('未记住：每次同步都要输入。')}>
        <div className="sync-actions">
          {config.has_remembered_passphrase && <button type="button" disabled={busy !== null} onClick={() => void revealPassphrase()}>{revealed === null ? t('查看口令') : t('隐藏口令')}</button>}
          {config.has_remembered_passphrase && <button type="button" disabled={busy !== null} onClick={() => void forgetPassphrase()}>{t('不再记住')}</button>}
          {!config.has_remembered_passphrase && <button type="button" disabled={busy !== null} onClick={() => openPassphrase('unlock')}>{t('输入并记住口令')}</button>}
        </div>
      </FormRow>
      {revealed !== null && <p className="notice sync-revealed" role="status">{t('同步口令：')}<code>{revealed}</code></p>}
      <FormRow label={t('打开物谱时检查云端')} hint={t('打开或前后台切换时核对云端；本机有改动且已记住口令时会自动上传加密快照，但不会自动替换本机资料。')}>
        <Switch label={t('打开物谱时检查云端')} value={config.auto_check} disabled={busy !== null} onChange={value => void toggleAutoCheck(value)}/>
      </FormRow>
    </div>}

    {history && <p className="sync-history">{t('上次同步：{time}；云端版本：{version}；设备名：{device}', history)}</p>}

    {ready && (config?.enabled || error?.code !== 'SYNC_UNCONFIGURED') && <div className={`sync-state ${view.tone}`}>
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

    </>}

    {compare && status?.state === 'conflict' && <CompareTable local={status.local.table_counts} remote={compare.remote}/>}

    {loadError && <p className="notice error" role="alert">{t('同步设置读取失败：{loadError}', { loadError })}</p>}
    {actionError && <p className="notice error" role="alert">{actionError}</p>}
    {error?.message && <p className="notice error" role="alert">{error.message}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}

    {passOpen && <PassphraseDialog
      firstTime={firstTime}
      busy={busy === 'sync'}
      error={passError}
      onCancel={() => { setPassOpen(false); setPassError(''); pendingSync.current = false; }}
      onSubmit={(passphrase, remember) => void unlock(passphrase, remember)}
    />}
    {disableOpen && <DisableSyncDialog busy={busy === 'disable'} error={disableError} onCancel={() => setDisableOpen(false)} onDisable={forget => void disableSync(forget)}/>}
  </div>;
}

function DisableSyncDialog({ busy, error, onCancel, onDisable }: { busy: boolean; error: string; onCancel: () => void; onDisable: (forget: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opened = dialog.current; opened?.showModal(); return () => opened?.close(); }, []);
  return <dialog ref={dialog} className="editor leave-confirm sync-disable" aria-labelledby="sync-disable-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="sync-disable-title">{t('停用同步')}</h2>
    <p className="muted">{t('停用后不再连接 WebDAV，不会删除云端数据，也不会改动本机资料。请选择是否保留连接信息。')}</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="sync-disable-actions">
      <button type="button" disabled={busy} onClick={onCancel}>{t('取消')}</button>
      <button type="button" disabled={busy} onClick={() => onDisable(false)}>{t('停用并保留已保存的连接信息')}</button>
      <button type="button" className="danger" disabled={busy} onClick={() => onDisable(true)}>{t('停用并清除连接信息和密码')}</button>
    </div>
  </dialog>;
}

function PassphraseDialog({ firstTime, busy, error, onCancel, onSubmit }: { firstTime: boolean; busy: boolean; error: string; onCancel: () => void; onSubmit: (passphrase: string, remember: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [remember, setRemember] = useState(true);
  useEffect(() => { const opened = dialog.current; opened?.showModal(); return () => opened?.close(); }, []);
  const mismatch = firstTime && again.length > 0 && passphrase !== again;
  const incomplete = !passphrase || (firstTime && passphrase !== again);
  return <dialog ref={dialog} className="editor leave-confirm sync-passphrase" aria-labelledby="sync-passphrase-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="sync-passphrase-title">{firstTime ? t('设置同步口令') : t('输入同步口令')}</h2>
    <p className="muted">{firstTime
      ? t('第一次上传会创建同步口令，请输入两次。口令只在本次运行的内存中保留，不会保存到磁盘。')
      : t('口令只用于本次同步，保留在内存中，10 分钟后自动失效。')}</p>
    <p className="notice">{firstTime
      ? t('请把口令记在密码本里：换新设备时需要同样的口令才能取回云端资料。忘记口令后云端副本无法恢复，本机资料不受影响。')
      : t('忘记口令后云端副本无法恢复，本机资料不受影响。')}</p>
    <label className="field"><span>{t('同步口令')}</span><input type="password" autoComplete="off" spellCheck={false} aria-label={t('同步口令')} value={passphrase} disabled={busy} onChange={event => setPassphrase(event.target.value)}/></label>
    {firstTime && <label className="field"><span>{t('再次输入同步口令')}</span><input type="password" autoComplete="off" spellCheck={false} aria-label={t('再次输入同步口令')} value={again} disabled={busy} onChange={event => setAgain(event.target.value)}/></label>}
    <label className="sync-remember"><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)}/> {t('在这台设备记住口令，之后不用再输入')}</label>
    {(mismatch || error) && <p className="notice error" role="alert">{mismatch ? t('两次输入的口令不一致。') : error}</p>}
    <div className="leave-confirm-actions">
      <button type="button" disabled={busy} onClick={onCancel}>{t('取消')}</button>
      <button type="button" className="primary" disabled={busy || incomplete} onClick={() => onSubmit(passphrase, remember)}>{firstTime ? t('设置口令并同步') : t('解锁并同步')}</button>
    </div>
  </dialog>;
}

// `table` is the local SQLite table counted by the fingerprint; `field` the same thing in the cloud summary.
const COMPARE_ROWS: { table: string; field: string; label: () => string }[] = [
  { table: 'assets', field: 'assets', label: () => t('物品') },
  { table: 'wishlist_items', field: 'wishes', label: () => t('心愿') },
  { table: 'fin_accounts', field: 'accounts', label: () => t('账户') },
  { table: 'fin_snapshots', field: 'snapshots', label: () => t('盘点') },
  { table: 'expenses', field: 'expenses', label: () => t('支出') },
  { table: 'recurring_plans', field: 'plans', label: () => t('周期计划') },
];

function CompareTable({ local, remote }: { local: Record<string, number>; remote: SyncPullInspection }) {
  const counts = (remote.summary ?? {}) as unknown as Record<string, number>;
  return <table className="sync-compare">
    <caption>{t('云端由「{device}」更新于 {time}', { device: remote.device_name, time: formatWhen(remote.created_at) })}</caption>
    <thead><tr><th/><th>{t('本机')}</th><th>{t('云端')}</th></tr></thead>
    <tbody>{COMPARE_ROWS.map(row => {
      const mine = local[row.table] ?? 0, theirs = counts[row.field] ?? 0;
      return <tr key={row.table} className={mine === theirs ? undefined : 'differs'}><th scope="row">{row.label()}</th><td>{mine}</td><td>{theirs}</td></tr>;
    })}</tbody>
  </table>;
}
