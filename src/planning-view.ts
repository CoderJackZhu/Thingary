import { t } from './i18n.ts';
/** Session-only content view; PlanningTab still selects goals versus financial review. */
export type PlanningView = 'goals' | 'detail' | 'trial';

export const planningViewTitle = (view: PlanningView): string => ({ goals: t('目标'), detail: t('测算详情'), trial: t('试算') })[view];
