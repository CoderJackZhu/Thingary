import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { ErrorState, Loading, NavBar } from '../ui';
import type { PageProps } from '../routes';
import { isSettingsPage } from './model';
import type { SettingsPage } from './model';
import './me.css';
import { t } from '../../i18n.ts';
const pages: Record<SettingsPage, ComponentType<{ page: SettingsPage }>> = {
  modules: lazy(() => import('./settings/Modules')), appearance: lazy(() => import('./settings/Appearance')),
  options: lazy(() => import('./settings/Options')), materials: lazy(() => import('./settings/Materials')),
  checkin: lazy(() => import('./settings/Checkin')), notifications: lazy(() => import('./settings/Notifications')),
  privacy: lazy(() => import('./settings/Privacy')), trash: lazy(() => import('./settings/Trash')),
  export: lazy(() => import('./settings/Export')), demo: lazy(() => import('./settings/Demo')),
  about: lazy(() => import('./settings/About')), feedback: lazy(() => import('./settings/About')), license: lazy(() => import('./settings/About')),
} as unknown as Record<SettingsPage, ComponentType<{ page: SettingsPage }>>;

/** One route (`me.settings`) for every settings sub-page; `params.page` picks which. */
export default function Settings({ params }: PageProps) {
  const page = params.page;
  if (!isSettingsPage(page)) return <div className="m-page"><NavBar/><ErrorState title={t('找不到这个设置页')} message={t('请返回我的，再重新选择。')}/></div>;
  const Page = pages[page];
  return <Suspense fallback={<div className="m-page"><NavBar/><Loading/></div>}><Page page={page}/></Suspense>;
}
