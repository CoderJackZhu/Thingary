import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { globalPauseText, type SecurityStatus } from './backup-security-format';

/** App-wide notice while automatic and extra backups are paused by the backup
 * security policy. The panel in 数据管理 stays the only place to change it;
 * this only makes sure an upgrade never pauses backups out of sight. */
export function BackupSecurityNotice({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null), [failed, setFailed] = useState(false);
  const request = useRef(0), alive = useRef(true);
  const reload = () => {
    const mine = ++request.current;
    return invoke<SecurityStatus>('backup_security_status')
      .then(next => { if (alive.current && mine === request.current) { setStatus(next); setFailed(false); } })
      .catch(() => { if (alive.current && mine === request.current) setFailed(true); });
  };
  useEffect(() => {
    alive.current = true;
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener('thingary-backup-security-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { alive.current = false; ++request.current; window.removeEventListener('thingary-backup-security-changed', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  if (hidden) return null;
  if (failed) return <div className="backup-security-notice" role="status">
    <span>备份安全状态暂时读取失败，无法确认自动备份是否在运行。</span>
    <button type="button" onClick={() => void reload()}>重新读取</button>
  </div>;
  const text = status && globalPauseText(status);
  if (!text) return null;
  return <div className="backup-security-notice" role="status">
    <strong>自动备份已暂停</strong>
    <span>{text}</span>
    <button type="button" onClick={onOpen}>去数据管理处理</button>
  </div>;
}
