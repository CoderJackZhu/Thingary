import type { Account } from './wealth';
import { t } from './i18n.ts';
export type AccountGroup = { id: string; name: string; position: number; revision: number; accounts: number };
export type AccountGroupList = { generation: string; groups: AccountGroup[] };
export type GroupSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; name: string };
export type GroupDelete = { request_id: string; generation: string; id: string; expected_revision: number; expected_accounts: number };
export type GroupReorder = { request_id: string; generation: string; ids: string[] };
export function groupNameError(value: string): string | null {
  const name = value.trim();
  return !name || [...name].length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(name) ? t('分组名称须为 1–40 字，不能含控制字符') : null;
}
/** New id order after moving one group up (-1) or down (+1); null when it cannot move that way. */
export function movedGroupIds(groups: AccountGroup[], id: string, step: -1 | 1): string[] | null {
  const ids = groups.map(g => g.id), from = ids.indexOf(id), to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  ids.splice(from, 1); ids.splice(to, 0, id);
  return ids;
}
export const groupAccountsText = (group: AccountGroup) => t('{accounts} 个账户（含已停用和最近删除）', { accounts: group.accounts });
/** What deleting a group does (same wording as the desktop manager): accounts stay, only the grouping goes. */
export const groupDeleteText = (group: AccountGroup) => t('删除后，{accounts} 个账户会变成未分组，账户本身不会删除。此操作无法撤销；重新建组后仍需重新分配账户。', { accounts: group.accounts });
let viewMemory: { generation: string; mode: 'list' | 'group'; structure: 'kind' | 'group' } | null = null;
const memory = (generation: string) => {
  if (viewMemory?.generation !== generation) viewMemory = { generation, mode: 'list', structure: 'kind' };
  return viewMemory!;
};
export const recallGroupViews = (generation: string) => ({ ...memory(generation) });
export const rememberGroupView = (generation: string, key: 'mode' | 'structure', value: string) => { Object.assign(memory(generation), { [key]: value }); };
export const groupForAccount = (account: Account, groups: AccountGroup[]) => groups.find(g => g.id === account.fields.group_id)?.id ?? '';
