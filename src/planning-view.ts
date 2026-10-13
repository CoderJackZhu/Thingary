/** Session-only content view; PlanningTab still selects goals versus financial review. */
export type PlanningView = 'goals' | 'detail' | 'trial';

export const planningViewTitle = (view: PlanningView): string => ({ goals: '目标', detail: '测算详情', trial: '试算' })[view];
