import { useEffect, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { hiddenKinds, allModules } from '../../modules';
import { readMode, readStyle } from '../../appearance';
import type { AutoBackupStatus } from '../../auto-backup-format';
import type { CheckinReminderStatus } from '../../checkin-reminder';
import { checkinIntervals } from '../../checkin-reminder';
import type { TrashPage } from '../../unified-trash';
import type { LibraryCounts } from '../home/read';
import { useModules } from '../modules-context';
import { useNav, useReveal } from '../nav-context';
import { useSession } from '../session';
import { Button, Card, LargeTitle, ListGroup, ListRow } from '../ui';
import type { PageProps } from '../routes';
import { MeIcon } from './icons';
import { appearanceSummary, backupReminder, daysAgoText, enabledModuleCount, readLastBackup, settingsTitles } from './model';
import type { SettingsPage } from './model';
import { privacySnapshot, subscribePrivacy, authName } from './privacy-runtime';
import { installMobileRuntime } from './runtime';
import { browserStorage } from './shared';
import './me.css';

installMobileRuntime();

type Extra = { counts?: LibraryCounts; auto?: AutoBackupStatus; trash?: number; month?: number; checkin?: CheckinReminderStatus; version?: string };
const read = <T,>(command: string, args?: Record<string, unknown>): Promise<T | undefined> => invoke<T>(command, args).catch(() => undefined);

/** 我的 (design 22): 资料概况与备份提醒, 记录, 设置, 资料, 关于. */
export default function Me(_props: PageProps) {
  const nav = useNav(), session = useSession(), { modules: runtime } = useModules(), reveal = useReveal();
  const modules = runtime ?? allModules, today = session.today;
  const [extra, setExtra] = useState<Extra>({});
  const privacy = useSyncExternalStore(subscribePrivacy, privacySnapshot);
  useEffect(() => {
    let live = true;
    (async () => {
      const [counts, auto, trash, timeline, checkin, version] = await Promise.all([
        read<LibraryCounts>('asset_counts'), read<AutoBackupStatus>('auto_backup_status'),
        read<TrashPage>('list_trash', { query: { filter: 'all', offset: 0, search: '' } }),
        read<{ dated: { kind: string; date: string | null }[] }>('list_timeline', { query: { filter: 'all', asset_id: null } }),
        read<CheckinReminderStatus>('checkin_reminder_status'), read<string>('app_version'),
      ]);
      if (!live) return;
      const hide = hiddenKinds(modules);
      setExtra({ counts, auto, trash: trash?.total, checkin, version, month: timeline ? timeline.dated.filter(event => event.date?.startsWith(today.slice(0, 7)) && !hide.has(event.kind)).length : undefined });
    })();
    return () => { live = false; };
  }, [reveal, today, JSON.stringify(modules)]);

  const go = (page: SettingsPage) => nav.push('me.settings', { page }, { title: settingsTitles[page] });
  const accounts = session.data?.accounts.length;
  const last = readLastBackup(browserStorage());
  const reminder = backupReminder(last, new Date(), (extra.counts?.all ?? 0) > 0 || (accounts ?? 0) > 0);
  const interval = extra.checkin ? checkinIntervals.find(item => item.value === String(extra.checkin!.months))?.label : undefined;
  const lockText = privacy.lock.enabled ? '已开启' : '未开启';
  return <div className="m-page">
    <LargeTitle title="我的"/>
    <Card label="资料概况" className="me-summary">
      <div className="me-summary-head"><h2>资料概况</h2><span>只存在这台手机</span></div>
      <div className="me-stats">
        <div><strong>{extra.counts ? extra.counts.all : '—'}<small> 件</small></strong><span>物品</span></div>
        {modules.wealth && <div><strong>{accounts ?? '—'}<small> 个</small></strong><span>账户</span></div>}
        <div><strong>{daysAgoText(reminder.daysAgo)}</strong><span>上次完整备份</span></div>
      </div>
      <div className={`me-backup me-backup-${reminder.tone}`}><MeIcon name={reminder.tone === 'positive' ? 'check' : 'warning'} size={18}/><span>{reminder.text}</span><Button variant="plain" onClick={() => nav.push('me.data', { focus: 'backup' })}>备份</Button></div>
      {extra.auto && !extra.auto.enabled && <p className="me-hint">自动备份已关闭。</p>}
    </Card>
    <ListGroup title="记录">
      {modules.timeline && <ListRow icon={<MeIcon name="clock"/>} title="时间轴" value={extra.month === undefined ? undefined : `本月 ${extra.month} 条`} onClick={() => nav.push('me.timeline')}/>}
      <ListRow icon={<MeIcon name="search"/>} tone="accent" title="搜索全部资料" onClick={() => nav.push('me.search')}/>
      <ListRow icon={<MeIcon name="trash"/>} tone="danger" title="最近删除" value={extra.trash === undefined ? undefined : `${extra.trash} 条`} onClick={() => go('trash')}/>
    </ListGroup>
    <ListGroup title="设置">
      <ListRow icon={<MeIcon name="grid"/>} tone="accent" title="功能模块" value={`已开启 ${enabledModuleCount(modules)} 项`} onClick={() => go('modules')}/>
      <ListRow icon={<MeIcon name="contrast"/>} tone="accent" title="外观" value={appearanceSummary(readStyle(), readMode())} onClick={() => go('appearance')}/>
      <ListRow icon={<MeIcon name="tag"/>} tone="warn" title="选项管理" value="分类、标签、渠道" onClick={() => go('options')}/>
      <ListRow icon={<MeIcon name="image"/>} tone="positive" title="素材库" onClick={() => go('materials')}/>
      <ListRow icon={<MeIcon name="calendar"/>} tone="accent" title="盘点提醒" value={interval} onClick={() => go('checkin')}/>
      <ListRow icon={<MeIcon name="bell"/>} tone="danger" title="通知" onClick={() => go('notifications')}/>
      <ListRow icon={<MeIcon name="lock"/>} tone="neutral" title={`隐私与${authName()}`} value={lockText} onClick={() => go('privacy')}/>
    </ListGroup>
    <ListGroup title="资料">
      <ListRow icon={<MeIcon name="database"/>} tone="accent" title="数据管理" onClick={() => nav.push('me.data')}/>
      <ListRow icon={<MeIcon name="table"/>} tone="positive" title="导出表格" onClick={() => go('export')}/>
    </ListGroup>
    <ListGroup title="关于">
      <ListRow icon={<MeIcon name="info"/>} tone="accent" title="关于与帮助" value={extra.version ? `版本 ${extra.version}` : undefined} onClick={() => go('about')}/>
      <ListRow icon={<MeIcon name="chat"/>} tone="warn" title="反馈问题" onClick={() => go('feedback')}/>
      <ListRow icon={<MeIcon name="code"/>} tone="neutral" title="开源许可" onClick={() => go('license')}/>
    </ListGroup>
  </div>;
}
