// Optional modules (settings › 功能模块). Off hides the entry and its events and
// pauses its reminders; data is never touched and returns when switched on.
export type Modules = { physical: boolean; wishlist: boolean; timeline: boolean; stats: boolean; wealth: boolean; expenses: boolean; recurring: boolean; virtual: boolean; planning: boolean };
export const allModules: Modules = { physical: true, wishlist: true, timeline: true, stats: true, wealth: true, expenses: true, recurring: true, virtual: true, planning: true };
export const moduleList: [keyof Modules, string, string][] = [
  ['physical', '物品档案', '记录物品、照片与购买信息；关闭保留已有资料'],
  ['wishlist', '心愿清单', '记录想买的东西、倒计时和攒钱'], ['timeline', '时间轴', '所有记录按日期排成一条线'], ['stats', '物品统计', '分类占比、持有周期与回收分析'],
  ['wealth', '账户与盘点', '定期盘点账户余额与负债，并查看财务复盘'], ['expenses', '重要支出', '旅行、学费等非物品的大额支出'], ['recurring', '周期费用', '房租、订阅、保险等固定支出'], ['virtual', '虚拟资产', '软件、域名与订阅服务的档案'], ['planning', '目标', '设置未来目标、安排与测算条件'],
];
const kindsOf: Record<keyof Modules, string[]> = { physical: ['purchase', 'maintenance', 'warranty_start', 'warranty_end', 'retire', 'activate', 'sale'], wishlist: ['wish_added', 'wish_abandoned', 'wish_achieved'], timeline: [], stats: [], wealth: ['snapshot'], expenses: ['expense', 'refund'], recurring: ['payment'], virtual: ['virtual'], planning: [] };
/** Timeline and recent-record event kinds that belong to switched-off modules. */
export function hiddenKinds(m: Modules): Set<string> { return new Set((Object.keys(kindsOf) as (keyof Modules)[]).filter(k => k === 'physical' ? m.physical === false : !m[k]).flatMap(k => kindsOf[k])); }
export const financeOff = (m: Modules & { incomes?: boolean }) => !m.wealth && !m.expenses && !m.recurring && !m.virtual && !m.incomes;

/** Native preference snapshot; independent finance switches are always explicit. */
export type FinanceModulesStatus = 'ready' | 'legacy_corrupt' | 'finance_corrupt' | 'unsupported_version' | 'read_error' | 'write_error';
export type RuntimeModules = Modules & {
  incomes: boolean;
  movements: boolean;
  finance_status: FinanceModulesStatus;
  finance_revision: number;
};
/** modules_set accepts this payload; repair requires both explicit choices. */
export type FinanceModulesUpdate = {
  modules: Modules | RuntimeModules;
  incomes?: boolean;
  movements?: boolean;
  repair?: boolean;
};
export function financeModulesReady(modules: RuntimeModules): boolean {
  return modules.finance_status === 'ready' && Number.isSafeInteger(modules.finance_revision) && modules.finance_revision > 0;
}
