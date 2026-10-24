import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../../asset';
import { t } from '../../../i18n.ts';
import { SyncSettings } from '../../../sync/SyncSettings';
import type { SyncPullInspection } from '../../../sync/api';
import { storedPending } from '../../../wealth';
import { readGate } from '../../home/read';
import type { Gate } from '../../home/read';
import { useNav } from '../../nav-context';
import { useSession } from '../../session';
import { Card, ErrorState, Loading, Notice } from '../../ui';
import { SettingsShell } from './Shell';
import { syncCandidateParam } from './sync-candidate';
import './sync.css';

/** The shared sync screen owns all sync decisions and secrets; Data owns every restore step. */
export default function SyncPage() {
  const nav = useNav(), session = useSession();
  const [gate, setGate] = useState<Gate | null>(null), [demo, setDemo] = useState(false), [readError, setReadError] = useState('');
  const load = useCallback(() => {
    let alive = true;
    setReadError('');
    Promise.all([readGate(), invoke<{ active: boolean }>('demo_status')])
      .then(([nextGate, status]) => { if (alive) { setGate(nextGate); setDemo(status.active); } })
      .catch(cause => { if (alive) setReadError(errorMessage(cause)); });
    return () => { alive = false; };
  }, []);
  useEffect(load, [load]);
  const blocked = nav.blocked || session.navBlocked || !!storedPending() || !gate?.counts.generation;

  function inspectSync(inspection: SyncPullInspection): boolean {
    if (blocked || demo) return false;
    const syncCandidate = syncCandidateParam(inspection);
    if (!syncCandidate) return false;
    nav.push('me.data', { syncCandidate }, { title: t('数据管理') });
    return true;
  }

  return <div className="m-sync-page"><SettingsShell title={t('同步')} lead={t('同步到你自己的 WebDAV')}>
    {readError ? <ErrorState title={t('资料库读取失败')} message={readError} onRetry={load}/> : !gate ? <Loading/> : demo
      ? <Notice>{t('当前是独立样例库。切换到「我的资料」后可配置同步。')}</Notice>
      : <>
        {blocked && <Notice>{t('请先处理正在编辑或待核对的内容，再进行同步。')}</Notice>}
        <Card label={t('同步')} className="m-sync-card"><SyncSettings blocked={blocked} onPull={inspectSync}/></Card>
      </>}
  </SettingsShell></div>;
}
