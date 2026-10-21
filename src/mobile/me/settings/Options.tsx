import { useEffect, useState } from 'react';
import { errorMessage } from '../../../asset';
import { useChoices } from '../../../choices-hook';
import type { Entry } from '../../../choices-hook';
import { CATEGORY_ICONS, normalizeName, validateTaxonomyName } from '../../../taxonomy';
import type { CategoryIcon, TaxonomyEntry, TaxonomyKind } from '../../../taxonomy';
import { useTaxonomy } from '../../../useTaxonomy';
import { Button, ChipRow, EmptyState, ErrorState, FormGroup, ListGroup, ListRow, Loading, Notice, SegmentedControl, Sheet, Switch, TextField } from '../../ui';
import { MeIcon } from '../icons';
import { SettingsShell } from './Shell';

type Kind = 'category' | 'channel' | 'label' | 'sale_channel';
const tabs: { id: Kind; label: string }[] = [{ id: 'category', label: '分类' }, { id: 'channel', label: '渠道' }, { id: 'label', label: '标签' }, { id: 'sale_channel', label: '售出' }];
const names: Record<Kind, string> = { category: '分类', channel: '购买渠道', label: '标签', sale_channel: '售出渠道' };
const scopeLabels = { physical: '实物', virtual: '虚拟', both: '通用' } as const;
type Scope = keyof typeof scopeLabels;

/** One row of any option list, whichever backend list it comes from. */
type Row = { id: string; name: string; sub: string; icon?: CategoryIcon; enabled?: boolean; scope?: Scope; refs: number };
/** What the shared list needs; the two backends (taxonomy and choice lists) each provide it. */
type Adapter = {
  rows: Row[] | null; loadError: string | null; busy: boolean; locked: boolean; notice: string; reload: () => void;
  create: (name: string, icon: CategoryIcon, scope: Scope) => Promise<string | null>;
  rename: (id: string, name: string) => Promise<string | null>;
  setIcon?: (id: string, icon: CategoryIcon) => Promise<string | null>;
  move: (id: string, to: number) => Promise<string | null>;
  remove: (id: string, target: string | null) => Promise<string | null>;
  enable?: (id: string, on: boolean) => Promise<string | null>;
  setScope?: (id: string, scope: Scope) => Promise<string | null>;
  nullLabel: string;
  nameError: (name: string, id?: string) => string | null;
};

function useTaxonomyAdapter(kind: TaxonomyKind): Adapter & { generation?: string } {
  const t = useTaxonomy(() => undefined);
  const entries: readonly TaxonomyEntry[] = t.snapshot ? t.snapshot[kind === 'category' ? 'categories' : 'channels'] : [];
  const run = async (command: Parameters<typeof t.command>[0]) => { const result = await t.command(command); return result.status === 'success' ? null : result.message + (result.recovery === 'reload' ? ' 建议重新加载后再操作。' : ''); };
  return {
    generation: t.snapshot?.generation,
    rows: t.snapshot ? entries.map(entry => ({ id: entry.id, name: entry.name, sub: `${entry.references.activeAssets} 件物品${entry.references.deletedAssets ? `，最近删除 ${entry.references.deletedAssets}` : ''}`, icon: entry.icon, refs: entry.references.activeAssets + entry.references.deletedAssets + (entry.references.ongoingWishlist ?? 0) + (entry.references.abandonedWishlist ?? 0) })) : null,
    loadError: t.loadError, busy: t.busy || t.loading, locked: t.busy || t.loading, notice: t.blocked ? '上次操作的结果待核对，请重新加载后再继续。' : '', reload: () => void t.reload().catch(() => undefined),
    create: (name, icon) => run({ type: 'create', kind, name, icon: kind === 'category' ? icon : undefined }),
    rename: (id, name) => run({ type: 'rename', kind, id, name }),
    setIcon: kind === 'category' ? (id, icon) => run({ type: 'set-icon', id, icon }) : undefined,
    move: (id, to) => { const ids = entries.map(entry => entry.id), from = ids.indexOf(id); if (from < 0 || to < 0 || to >= ids.length) return Promise.resolve(null); ids.splice(from, 1); ids.splice(to, 0, id); return run({ type: 'reorder', kind, ids }); },
    remove: (id, target) => run({ type: 'remove', kind, id, targetId: target }),
    nullLabel: kind === 'category' ? '未分类' : '未记录',
    nameError: (name, id) => validateTaxonomyName(entries, kind, name, id),
  };
}

function useChoiceAdapter(kind: 'label' | 'sale_channel', generation: string): Adapter {
  const c = useChoices(kind, generation);
  const items: Entry[] = c.data?.items ?? [];
  const run = async (action: unknown) => (await c.change(action)) ? null : (c.notice || '操作未完成，请重试。');
  return {
    rows: c.data ? items.map(entry => ({ id: entry.id, name: entry.name, enabled: entry.enabled, scope: kind === 'label' ? ((entry.scope as Scope) || 'physical') : undefined, refs: entry.references + (entry.virtual_references ?? 0),
      sub: [entry.enabled ? '' : '已停用', kind === 'label' ? scopeLabels[(entry.scope as Scope) || 'physical'] : '', entry.references + (entry.virtual_references ?? 0) ? `${entry.references + (entry.virtual_references ?? 0)} 条记录` : ''].filter(Boolean).join(' · ') || '未被使用' })) : null,
    loadError: c.data ? null : c.notice || null, busy: c.busy, locked: c.locked, notice: c.data ? c.notice : '', reload: () => void c.load(),
    create: (name, _icon, scope) => run({ type: 'create', name, scope: kind === 'label' ? scope : undefined }),
    rename: (id, name) => run({ type: 'rename', id, name }),
    move: (id, to) => { if (!c.data || to < 0 || to >= items.length) return Promise.resolve(null); c.move(id, to); return Promise.resolve(null); },
    remove: (id, target) => run({ type: 'remove', id, replacement: target, expected_references: items.find(entry => entry.id === id)?.references }),
    enable: (id, enabled) => run({ type: 'enable', id, enabled }),
    setScope: kind === 'label' ? (id, scope) => run({ type: 'scope', id, scope }) : undefined,
    nullLabel: '清空关联（未设置）',
    nameError: (name, id) => {
      const value = normalizeName(name);
      if (!value) return '请填写名称。';
      if ([...value].length > 80) return '名称最长 80 字。';
      return items.some(entry => entry.id !== id && normalizeName(entry.name).toLowerCase() === value.toLowerCase()) ? '已有同名项，请更换。' : null;
    },
  };
}

type Editing = { mode: 'add' } | { mode: 'edit'; id: string } | { mode: 'remove'; id: string };

function OptionList({ kind, a }: { kind: Kind; a: Adapter }) {
  const [editing, setEditing] = useState<Editing | null>(null), [name, setName] = useState(''), [icon, setIcon] = useState<CategoryIcon>('box'), [scope, setScope] = useState<Scope>('both');
  const [target, setTarget] = useState(''), [error, setError] = useState('');
  const rows = a.rows ?? [], row = editing && editing.mode !== 'add' ? rows.find(item => item.id === editing.id) : undefined;
  const close = () => { if (!a.busy) { setEditing(null); setError(''); } };
  const open = (next: Editing) => {
    const current = next.mode === 'add' ? undefined : rows.find(item => item.id === next.id);
    setName(current?.name ?? ''); setIcon(current?.icon ?? 'box'); setScope('both'); setTarget(''); setError(''); setEditing(next);
  };
  async function apply(action: () => Promise<string | null>, done = true) {
    setError('');
    try { const failure = await action(); if (failure) setError(failure); else if (done) setEditing(null); }
    catch (cause) { setError(errorMessage(cause)); }
  }
  const validation = editing && editing.mode !== 'remove' ? a.nameError(name, editing.mode === 'edit' ? editing.id : undefined) : null;
  const index = row ? rows.findIndex(item => item.id === row.id) : -1;
  return <>
    {a.notice && <Notice tone="danger">{a.notice} <Button variant="plain" onClick={a.reload}>重新加载</Button></Notice>}
    {a.rows === null ? (a.loadError ? <ErrorState title={`${names[kind]}读取失败`} message={a.loadError} onRetry={a.reload}/> : <Loading/>)
      : !rows.length ? <EmptyState icon="tag" title={`还没有${names[kind]}`} message={kind === 'label' ? '可按用途分组，例如「工作用」；也可按位置分组，例如「书房」。' : '新增后，记录物品时就能选择它。'} action={<Button variant="primary" disabled={a.locked} onClick={() => open({ mode: 'add' })}>新增{names[kind]}</Button>}/>
      : <ListGroup title={names[kind]} footer={kind === 'label' || kind === 'sale_channel' ? '点一项可排序、重命名、停用或删除。停用后不再出现在选择里，已有记录不受影响。' : '点一项可排序、重命名或移除。移除时引用会迁移到你指定的目标，不会删除任何物品。'}>
        {rows.map(item => <ListRow key={item.id} icon={item.icon ? <MeIcon name="box"/> : 'tag'} title={item.name} subtitle={item.sub} disabled={a.locked} onClick={() => open({ mode: 'edit', id: item.id })}/>)}
      </ListGroup>}
    {rows.length > 0 && <Button block disabled={a.locked} onClick={() => open({ mode: 'add' })}>新增{names[kind]}</Button>}
    {editing && editing.mode !== 'remove' && <Sheet title={editing.mode === 'add' ? `新增${names[kind]}` : names[kind]} doneLabel="关闭" onClose={close}>
      <div className="m-page">
        <FormGroup><TextField label="名称" value={name} maxLength={80} onChange={setName} disabled={a.busy}/></FormGroup>
        {validation && name.trim() && <Notice tone="danger">{validation}</Notice>}
        {kind === 'category' && <section className="m-form-group"><h2 className="m-group-title">图标</h2><ChipRow label="分类图标" items={CATEGORY_ICONS.map(item => ({ id: item.value, label: item.label }))} value={icon} onChange={value => { setIcon(value as CategoryIcon); }}/></section>}
        {kind === 'label' && editing.mode === 'add' && <section className="m-form-group"><h2 className="m-group-title">适用范围</h2><ChipRow label="适用范围" items={Object.entries(scopeLabels).map(([id, label]) => ({ id, label }))} value={scope} onChange={value => setScope(value as Scope)}/></section>}
        {editing.mode === 'add'
          ? <Button variant="primary" block disabled={a.busy || !!validation} onClick={() => void apply(() => a.create(name, icon, scope))}>{a.busy ? '正在保存…' : '添加'}</Button>
          : row && <>
            <Button variant="primary" block disabled={a.busy || !!validation || (name === row.name && icon === row.icon)} onClick={() => void apply(async () => {
              if (name !== row.name) { const failure = await a.rename(row.id, name); if (failure) return failure; }
              if (kind === 'category' && icon !== row.icon && a.setIcon) { const failure = await a.setIcon(row.id, icon); if (failure) return failure; }
              return null;
            })}>{a.busy ? '正在保存…' : '保存'}</Button>
            {kind === 'label' && row.scope && a.setScope && <section className="m-form-group"><h2 className="m-group-title">适用范围</h2><ChipRow label="适用范围" items={Object.entries(scopeLabels).map(([id, label]) => ({ id, label }))} value={row.scope} onChange={value => void apply(() => a.setScope!(row.id, value as Scope), false)}/></section>}
            {a.enable && <ListGroup><ListRow title="启用" subtitle="停用后不再出现在选择里" trailing={<Switch label={'启用' + row.name} checked={!!row.enabled} disabled={a.locked} onChange={on => void apply(() => a.enable!(row.id, on), false)}/>}/></ListGroup>}
            <ListGroup title="顺序">
              <ListRow icon={<MeIcon name="arrowUp"/>} title="上移" disabled={a.locked || index <= 0} onClick={() => void apply(() => a.move(row.id, index - 1), false)}/>
              <ListRow icon={<MeIcon name="arrowDown"/>} title="下移" disabled={a.locked || index >= rows.length - 1} onClick={() => void apply(() => a.move(row.id, index + 1), false)}/>
            </ListGroup>
            <Button variant="danger" block disabled={a.locked} onClick={() => open({ mode: 'remove', id: row.id })}>移除…</Button>
          </>}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>}
    {editing?.mode === 'remove' && row && <Sheet title={`移除「${row.name}」`} doneLabel="取消" onClose={close}>
      <div className="m-page">
        <Notice>{row.refs ? `有 ${row.refs} 条引用（含最近删除与心愿）。选择它们改成什么；不会删除任何物品。` : '没有记录使用它。'}</Notice>
        {row.refs > 0 && <ListGroup title="引用改为">
          <ListRow icon={<MeIcon name={target === '' ? 'check' : 'tag'}/>} tone={target === '' ? 'positive' : 'neutral'} title={a.nullLabel} onClick={() => setTarget('')}/>
          {rows.filter(item => item.id !== row.id && item.enabled !== false).map(item => <ListRow key={item.id} icon={<MeIcon name={target === item.id ? 'check' : 'tag'}/>} tone={target === item.id ? 'positive' : 'neutral'} title={item.name} onClick={() => setTarget(item.id)}/>)}
        </ListGroup>}
        <Button variant="danger" block disabled={a.busy} onClick={() => void apply(() => a.remove(row.id, target || null))}>{a.busy ? '正在移除…' : '确认移除'}</Button>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Sheet>}
  </>;
}

function TaxonomyPane({ kind, onGeneration }: { kind: TaxonomyKind; onGeneration: (value: string | undefined) => void }) {
  const a = useTaxonomyAdapter(kind);
  useEffect(() => { onGeneration(a.generation); }, [a.generation]);
  return <OptionList kind={kind} a={a}/>;
}
function ChoicePane({ kind, generation }: { kind: 'label' | 'sale_channel'; generation: string }) {
  return <OptionList kind={kind} a={useChoiceAdapter(kind, generation)}/>;
}

/** 选项管理: 分类, 购买渠道, 标签, 售出渠道 — the desktop taxonomy and choice commands with their receipt recovery. */
export default function OptionsPage() {
  const [kind, setKind] = useState<Kind>('category'), [generation, setGeneration] = useState<string | undefined>();
  // Choice lists need the library generation, which the taxonomy snapshot provides; read it once through the first tab.
  const probe = useTaxonomy(() => undefined);
  const gen = generation ?? probe.snapshot?.generation;
  return <SettingsShell title="选项管理" lead="整理分类、购买与售出渠道，以及给物品分组用的标签。">
    <SegmentedControl label="选项类型" items={tabs} value={kind} onChange={setKind}/>
    {kind === 'category' || kind === 'channel' ? <TaxonomyPane key={kind} kind={kind} onGeneration={setGeneration}/>
      : gen ? <ChoicePane key={kind + gen} kind={kind} generation={gen}/> : probe.loadError ? <ErrorState title="选项读取失败" message={probe.loadError} onRetry={() => void probe.reload().catch(() => undefined)}/> : <Loading/>}
  </SettingsShell>;
}
