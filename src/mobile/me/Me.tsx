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
import { t } from '../../i18n.ts';
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
  const lockText = privacy.lock.enabled ? t('已开启') : t('未开启');
  return <div className="m-page">
    <LargeTitle title={t('我的')}/>
    <Card label={t('资料概况')} className="me-summary">
      <div className="me-summary-head"><h2>{t('资料概况')}</h2><span>{t('只存在这台手机')}</span></div>
      <div className="me-stats">
        <div><strong>{extra.counts ? extra.counts.all : '—'}<small> {t('件')}</small></strong><span>{t('物品')}</span></div>
        {modules.wealth && <div><strong>{accounts ?? '—'}<small> {t('个')}</small></strong><span>{t('账户')}</span></div>}
        <div><strong>{daysAgoText(reminder.daysAgo)}</strong><span>{t('上次完整备份')}</span></div>
      </div>
      <div className={`me-backup me-backup-${reminder.tone}`}><MeIcon name={reminder.tone === 'positive' ? 'check' : 'warning'} size={18}/><span>{reminder.text}</span><Button variant="plain" onClick={() => nav.push('me.data', { focus: 'backup' })}>{t('备份')}</Button></div>
      {extra.auto && !extra.auto.enabled && <p className="me-hint">{t('自动备份已关闭。')}</p>}
    </Card>
    <ListGroup title={t('记录')}>
      {modules.timeline && <ListRow icon={<MeIcon name="clock"/>} title={t('时间轴')} value={extra.month === undefined ? undefined : t('本月 {month} 条', { month: extra.month })} onClick={() => nav.push('me.timeline')}/>}
      <ListRow icon={<MeIcon name="search"/>} tone="accent" title={t('搜索全部资料')} onClick={() => nav.push('me.search')}/>
      <ListRow icon={<MeIcon name="trash"/>} tone="danger" title={t('最近删除')} value={extra.trash === undefined ? undefined : t('{trash} 条', { trash: extra.trash })} onClick={() => go('trash')}/>
    </ListGroup>
    <ListGroup title={t('设置')}>
      <ListRow icon={<MeIcon name="grid"/>} tone="accent" title={t('功能模块')} value={t('已开启 {v1} 项', { v1: enabledModuleCount(modules) })} onClick={() => go('modules')}/>
      <ListRow icon={<MeIcon name="tag"/>} tone="accent" title={t('通用')} value={t('语言、默认币种')} onClick={() => go('general')}/>
      <ListRow icon={<MeIcon name="contrast"/>} tone="accent" title={t('外观')} value={appearanceSummary(readStyle(), readMode())} onClick={() => go('appearance')}/>
      <ListRow icon={<MeIcon name="tag"/>} tone="warn" title={t('选项管理')} value={t('分类、标签、渠道')} onClick={() => go('options')}/>
      <ListRow icon={<MeIcon name="image"/>} tone="positive" title={t('素材库')} onClick={() => go('materials')}/>
      <ListRow icon={<MeIcon name="calendar"/>} tone="accent" title={t('盘点提醒')} value={interval} onClick={() => go('checkin')}/>
      <ListRow icon={<MeIcon name="bell"/>} tone="danger" title={t('通知')} onClick={() => go('notifications')}/>
      <ListRow icon={<MeIcon name="lock"/>} tone="neutral" title={t('隐私与{v1}', { v1: authName() })} value={lockText} onClick={() => go('privacy')}/>
    </ListGroup>
    <ListGroup title={t('资料')}>
      <ListRow icon={<MeIcon name="database"/>} tone="accent" title={t('数据管理')} onClick={() => nav.push('me.data')}/>
      <ListRow icon={<MeIcon name="table"/>} tone="positive" title={t('导出表格')} onClick={() => go('export')}/>
    </ListGroup>
    <ListGroup title={t('关于')}>
      <ListRow icon={<MeIcon name="info"/>} tone="accent" title={t('关于与帮助')} value={extra.version ? t('版本 {version}', { version: extra.version }) : undefined} onClick={() => go('about')}/>
      <ListRow icon={<MeIcon name="chat"/>} tone="warn" title={t('反馈问题')} onClick={() => go('feedback')}/>
      <ListRow icon={<MeIcon name="code"/>} tone="neutral" title={t('开源许可')} onClick={() => go('license')}/>
    </ListGroup>
  </div>;
}
