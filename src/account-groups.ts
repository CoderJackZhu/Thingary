import type { Account } from './wealth';
export type AccountGroup = { id: string; name: string; position: number; revision: number; accounts: number };
export type AccountGroupList = { generation: string; groups: AccountGroup[] };
export type GroupSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; name: string };
export type GroupDelete = { request_id: string; generation: string; id: string; expected_revision: number; expected_accounts: number };
export type GroupReorder = { request_id: string; generation: string; ids: string[] };
export function groupNameError(value: string): string | null {
  const name = value.trim();
  return !name || [...name].length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(name) ? '分组名称须为 1–40 字，不能含控制字符' : null;
}
let viewMemory: { generation: string; mode: 'list' | 'group'; structure: 'kind' | 'group' } | null = null;
const memory = (generation: string) => {
  if (viewMemory?.generation !== generation) viewMemory = { generation, mode: 'list', structure: 'kind' };
  return viewMemory!;
};
export const recallGroupViews = (generation: string) => ({ ...memory(generation) });
export const rememberGroupView = (generation: string, key: 'mode' | 'structure', value: string) => { Object.assign(memory(generation), { [key]: value }); };
export const groupForAccount = (account: Account, groups: AccountGroup[]) => groups.find(g => g.id === account.fields.group_id)?.id ?? '';
