/** Rendering audit manifest. Independent report/runway models do not consume basic results. */
export const planningConsumers = [
  { file: 'PlanningBasicGoals.tsx', render: 'PlanningBasicGoals', guard: 'GoalOverview' },
  { file: 'planning-goal/Overview.tsx', render: 'GoalOverview', guard: 'GoalCaution' },
  { file: 'PlanningRequirement.tsx', render: 'RequirementBody', guard: 'CoverageNote' },
  { file: 'PlanningRequirement.tsx', render: 'RequirementLine', guard: 'CoverageNote' },
  { file: 'PlanningBasicDetail.tsx', render: 'PlanningBasicDetail', guard: 'RequirementCard' },
  { file: 'RetireOverview.tsx', render: 'RetireOverview', guard: 'CoverageNote' },
  { file: 'RiskLab.tsx', render: 'RiskLab', guard: 'CoverageNote' },
  { file: 'ReviewPlanSummary.tsx', render: 'BasicSummaryBody', guard: 'RequirementLine' },
  { file: 'ReviewPlanSummary.tsx', render: 'ReviewPlanSummary', guard: 'CoverageNote' },
  { file: 'PlanningWishes.tsx', render: 'PlanningWishes', guard: 'CoverageNote' },
  { file: 'WishPlanLine.tsx', render: 'WishPlanLine', guard: 'CoverageNote' },
  { file: 'PlanningEvents.tsx', render: 'PlanningEvents', guard: 'CoverageNote' },
  { file: 'PlanningCareerCard.tsx', render: 'PlanningCareerCard', guard: 'GuidedPanel' },
  { file: 'career-preview/guided.tsx', render: 'GuidedPanel', guard: 'CoverageNote' },
  { file: 'career-preview/results.tsx', render: 'RestResult', guard: 'CoverageNote' },
  { file: 'career-preview/results.tsx', render: 'Sensitivity', guard: 'CoverageNote' },
  { file: 'career-preview/map.tsx', render: 'LowerResult', guard: 'CoverageNote' },
  { file: 'career-preview/map.tsx', render: 'DelaySection', guard: 'CoverageNote' },
  { file: 'career-preview/preview.tsx', render: 'Result', guard: 'CoverageNote' },
  { file: 'career-preview/preview.tsx', render: 'Preview', guard: 'CoverageNote' },
] as const;
export const independentPlanningConsumers = ['PlanningRunway (independent temporary cash inputs)', 'planning-report (independent frozen ReportInput)'] as const;
