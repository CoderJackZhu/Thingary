import { useRef, useState } from 'react';
import { groupAccountsText, groupDeleteText, groupNameError, movedGroupIds } from '../../account-groups';
import type { AccountGroup } from '../../account-groups';
import { useSession } from '../session';
import { Button, DeleteSheet, EmptyState, FormGroup, ListGroup, ListRow, LargeTitle, NavBar, Notice, Sheet, TextField } from '../ui';
import { MeIcon } from '../me/icons';
import { ReadState, useGroups, useWrite, WealthGate } from './shared';
import { t } from '../../i18n.ts';
type Editing = { mode: 'add' } | { mode: 'edit'; id: string } | { mode: 'remove'; id: string };

/** 管理分组: create, rename, reorder and delete account groups. Groups only change how accounts are viewed. */
export default function Groups() {
  const s = useSession(), groups = useGroups(), generation = s.data?.summary.generation ?? '';
  const [editing, setEditing] = useState<Editing | null>(null), [name, setName] = useState(''), [problem, setProblem] = useState('');
  const stay = useRef(false);
  const writer = useWrite(() => { groups.reload(); if (!stay.current) setEditing(null); stay.current = false; });
  const list = groups.value ?? [], row: AccountGroup | undefined = editing && editing.mode !== 'add' ? list.find(g => g.id === editing.id) : undefined;
  const open = (next: Editing) => { writer.setError(''); setProblem(''); setName(next.mode === 'edit' ? list.find(g => g.id === next.id)?.name ?? '' : ''); setEditing(next); };
  const close = () => { if (!writer.frozen) { setEditing(null); setProblem(''); writer.setError(''); } };
  const taken = (value: string, id?: string) => list.some(g => g.id !== id && g.name === value.trim());
  const save = () => {
    const error = groupNameError(name) ?? (taken(name, row?.id) ? t('已有同名分组') : null);
    if (error) { setProblem(error); return; }
    setProblem(''); stay.current = false;
    void writer.write({ command: 'account_group_save', label: row ? t('分组改名') : t('新增分组'), input: { request_id: crypto.randomUUID(), generation, id: row?.id ?? null, expected_revision: row?.revision ?? null, name: name.trim() } });
  };
  const move = (group: AccountGroup, step: -1 | 1) => {
    const ids = movedGroupIds(list, group.id, step); if (!ids) return;
    stay.current = true;
    void writer.write({ command: 'account_groups_reorder', label: t('分组排序'), input: { request_id: crypto.randomUUID(), generation, ids } });
  };
  const remove = (group: AccountGroup) => { stay.current = false; void writer.write({ command: 'account_group_delete', label: t('删除分组'), input: { request_id: crypto.randomUUID(), generation, id: group.id, expected_revision: group.revision, expected_accounts: group.accounts } }); };
  const index = row ? list.findIndex(g => g.id === row.id) : -1, locked = writer.frozen || !groups.value;
  return <div className="m-page m-wealth"><NavBar cancelLabel={t('关闭')}/><LargeTitle title={t('管理分组')} subtitle={t('分组只影响查看，不改变账户类型、计入设置或规划。')}/>
    <WealthGate>
      <ReadState error={groups.error} reload={groups.reload} loading={!groups.value && !groups.error}/>
      {writer.error && !editing && <Notice tone="danger">{writer.error}</Notice>}
      {groups.value && (!list.length
        ? <EmptyState icon="wallet" title={t('还没有分组')} message={t('可创建“应急金”等分组；账户也可以保持未分组。')} action={<Button variant="primary" disabled={locked} onClick={() => open({ mode: 'add' })}>{t('新建分组')}</Button>}/>
        : <><ListGroup title={t('{length} 个分组', { length: list.length })} footer={t('点一项可改名、调整顺序或删除。')}>
          {list.map(group => <ListRow key={group.id} icon="wallet" title={group.name} subtitle={groupAccountsText(group)} disabled={locked} onClick={() => open({ mode: 'edit', id: group.id })}/>)}
        </ListGroup><Button block disabled={locked} onClick={() => open({ mode: 'add' })}>{t('新建分组')}</Button></>)}
    </WealthGate>
    {editing && editing.mode !== 'remove' && <Sheet title={editing.mode === 'add' ? t('新建分组') : t('分组')} doneLabel={t('关闭')} onClose={close}>
      <div className="m-page">
        <FormGroup><TextField label={editing.mode === 'add' ? t('新分组名称') : t('分组新名称')} value={name} maxLength={40} onChange={setName} disabled={writer.frozen}/></FormGroup>
        {problem && <Notice tone="danger">{problem}</Notice>}
        <Button variant="primary" block disabled={writer.frozen || !name.trim() || (!!row && name.trim() === row.name)} onClick={save}>{writer.frozen ? t('正在保存…') : editing.mode === 'add' ? t('创建分组') : t('保存名称')}</Button>
        {row && <>
          <ListGroup title={t('顺序')}>
            <ListRow icon={<MeIcon name="arrowUp"/>} title={t('上移')} disabled={writer.frozen || index <= 0} onClick={() => move(row, -1)}/>
            <ListRow icon={<MeIcon name="arrowDown"/>} title={t('下移')} disabled={writer.frozen || index >= list.length - 1} onClick={() => move(row, 1)}/>
          </ListGroup>
          <Button variant="danger" block disabled={writer.frozen} onClick={() => open({ mode: 'remove', id: row.id })}>{t('删除…')}</Button>
        </>}
        {writer.error && <Notice tone="danger">{writer.error}</Notice>}
      </div>
    </Sheet>}
    {editing?.mode === 'remove' && row && <DeleteSheet name={row.name} recoverable={false} busy={writer.frozen} error={writer.error} onConfirm={() => remove(row)} onClose={close}>
      <p className="m-confirm-text">{groupDeleteText(row)}</p>
    </DeleteSheet>}
  </div>;
}
