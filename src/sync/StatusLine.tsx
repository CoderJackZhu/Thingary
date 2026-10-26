// Sidebar footer: "本地档案 · 仅本机" while sync is off, otherwise the last automatic sync
// outcome. Anything that needs a decision is a button into 设置.
import { t } from '../i18n.ts';
import { useAutoSync, type AutoSyncPhase } from './auto';

function ago(at: number | null): string {
  if (at === null) return '';
  const minutes = Math.floor((Date.now() - at) / 60000);
  return minutes < 1 ? t('刚刚') : t('{v1} 分钟前', { v1: minutes });
}

function label(phase: AutoSyncPhase, at: number | null): string {
  switch (phase) {
    case 'syncing': return t('正在同步…');
    case 'synced': return t('已同步 · {v1}', { v1: ago(at) });
    case 'remote_ahead': return t('云端有新版本');
    case 'conflict': return t('同步冲突，需要选择');
    case 'local_ahead': return t('有改动未上传');
    case 'error': return t('同步失败，点此查看');
    default: return t('同步已开启');
  }
}

export function SyncStatusLine({ onOpen }: { onOpen: () => void }) {
  const { phase, at } = useAutoSync();
  if (phase === 'off') return <p className="local-status" title={t('本地档案 · 仅保存在这台电脑')}><span className="local-dot"/>{t('本地档案 · 仅本机')}</p>;
  const attention = phase === 'remote_ahead' || phase === 'conflict' || phase === 'error' || phase === 'local_ahead';
  return <p className={`local-status sync-line${attention ? ' attention' : ''}`}>
    <span className="local-dot"/>
    {attention ? <button type="button" className="link-button" onClick={onOpen}>{label(phase, at)}</button> : label(phase, at)}
  </p>;
}
