import { useEffect, useState } from 'react';
import { errorMessage, localDay } from '../../asset';
import { moneyText } from '../format';
import type { AssetRecord } from '../../asset';
import { PhotoView } from '../../Photos';
import { loadWishPlanLine } from '../../wish-plan-line';
import type { WishPlanLineResult } from '../../wish-plan-line';
import { Unresolved, submit } from '../../wealth';
import type { WishVerify, WishlistItem } from '../../wishlist';
import { useNav, useReveal } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { ActionBar, Button, Card, DeleteSheet, ErrorState, Icon, LargeTitle, ListGroup, ListRow, Loading, NavBar, Notice } from '../ui';
import { DecisionSheet, VerifySheet } from './DetailSheets';
import { addedDate, categoryName, detailActions, legacySavings, linkHost, planNotes, planOverdue, replacementLine, stateTone } from './model';
import { CandidateSheet, ReceiptCards, StatePill, WishIcon, useReceipts, useTaxonomy } from './parts';
import { dropChange, linkRequest, readAsset, readWish, reconsiderChange, resolveSaving, storedSavingReceipt, submitOp, verifyRequest } from './service';
import type { Op } from './service';
import { wishDecisionLabel } from '../../wishlist';
import './wishes.css';

type Sheet = null | 'drop' | 'reconsider' | 'link' | 'verify' | 'delete';

/** 心愿详情（设计稿 08）：全部资料、替换物品、对规划的影响，以及记录购入、关联、不再考虑、编辑、删除。 */
export default function WishDetail({ params }: PageProps) {
  const id = String(params.id ?? ''), nav = useNav(), reveal = useReveal(), session = useSession(), today = session.today;
  const taxonomy = useTaxonomy();
  const generation = taxonomy.data?.generation ?? null;
  const [item, setItem] = useState<WishlistItem | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false), [sheet, setSheet] = useState<Sheet>(null), [sheetError, setSheetError] = useState(''), [notice, setNotice] = useState('');
  const [replacement, setReplacement] = useState<AssetRecord | null>(null), [replacementError, setReplacementError] = useState(''), [replacementTick, setReplacementTick] = useState(0);
  const [plan, setPlan] = useState<WishPlanLineResult | null>(null), [oldSaving, setOldSaving] = useState(false), [gone, setGone] = useState(false);
  const receipts = useReceipts(generation, () => setTick(n => n + 1), id);

  useEffect(() => {
    let live = true; setError('');
    readWish(id).then(next => { if (!live) return; setItem(next); if (!next) setError('找不到这条心愿，可能已被删除。'); })
      .catch(cause => { if (live) setError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, reveal, tick]);
  // 考虑替换的物品：读取其现有资料展示日期、状态与已有投入。
  const replacementId = item?.replacement_asset?.id ?? null;
  useEffect(() => {
    setReplacement(null); setReplacementError('');
    if (!replacementId) return;
    let live = true;
    readAsset(replacementId).then(record => { if (!live) return; setReplacement(record); if (!record) setReplacementError('原物品已删除或不存在，请重新读取心愿。'); }).catch(cause => { if (live) setReplacementError(errorMessage(cause)); });
    return () => { live = false; };
  }, [replacementId, item?.revision, replacementTick]);
  // 对规划的影响：只对考虑中的心愿计算，规划关闭或没有设置时不显示。
  useEffect(() => {
    setPlan(null);
    if (!item || item.decision_state !== 'considering') return;
    let live = true;
    loadWishPlanLine(item, today).then(result => { if (live) setPlan(result); }).catch(() => { /* 规划读取失败时不影响心愿详情 */ });
    return () => { live = false; };
  }, [item?.id, item?.revision, item?.fields.estimated_price_cents, item?.fields.target_date, item?.decision_state, today]);
  useEffect(() => { if (generation) setOldSaving(!!storedSavingReceipt(id, generation)); }, [id, generation]);

  // 删除成功后等忙碌状态解除再返回列表，导航在忙碌时会被忽略。
  useEffect(() => { if (gone && !nav.blocked) nav.pop(); }, [gone, nav.blocked]);
  const pending = receipts.ops.length > 0 || oldSaving, blocked = busy || pending || receipts.busy;
  async function run(op: Op, done: (next: WishlistItem) => void) {
    if (busy) return;
    setBusy(true); session.setBusy(true); setSheetError('');
    try {
      const outcome = await submitOp(op);
      if (outcome.status === 'saved') { const next = outcome.value as WishlistItem; setItem(next); done(next); }
      else { setSheetError(outcome.message); if (outcome.status === 'unknown') { setSheet(null); receipts.refresh(); } }
    } finally { setBusy(false); session.setBusy(false); }
  }
  const need = () => { if (!item || !generation) { setSheetError('资料库还没有读取完整，请稍后再试。'); return null; } return { item, generation }; };
  function drop(note: string) { const c = need(); if (c) void run({ kind: 'decision', label: '不再考虑', input: dropChange(c.item, c.generation, note, crypto.randomUUID()) }, () => { setSheet(null); setNotice('已记录为不再考虑；档案与图片都保留着。'); }); }
  function reconsider(note: string) { const c = need(); if (c) void run({ kind: 'decision', label: '重新考虑', input: reconsiderChange(c.item, c.generation, note, crypto.randomUUID()) }, () => { setSheet(null); setNotice('已回到考虑中；上次的提醒不会自动恢复。'); }); }
  function link(candidate: { id: string; revision: number }) { const c = need(); if (c) void run({ kind: 'link', label: '关联已有物品', input: linkRequest(c.item, c.generation, candidate, crypto.randomUUID()) }, () => { setSheet(null); setNotice('已关联这件物品为本次购入；物品资料保持原样。'); }); }
  function verify(outcome: WishVerify['outcome'], note: string, patch: WishVerify['asset_patch']) {
    const c = need();
    if (c) void run({ kind: 'verify', label: '核实旧记录', input: verifyRequest(c.item, c.generation, outcome, note, patch, crypto.randomUUID()) }, () => { setSheet(null); setNotice(outcome === 'purchased' ? '已确认购入：复用原物品，未新建第二件。' : outcome === 'considering' ? '已确认尚未购入，回到考虑中；旧版生成的物品仍在档案中。' : '已记录为不再考虑；原物品保留在档案中。'); });
  }
  async function remove() {
    const c = need();
    if (!c || busy) return;
    setBusy(true); session.setBusy(true); setSheetError('');
    try {
      await submit({ command: 'wealth_trash', label: '删除' + c.item.fields.name, input: { request_id: crypto.randomUUID(), generation: c.generation, kind: 'wish', id: c.item.id, expected_revision: c.item.revision, deleted: true } });
      setSheet(null); setGone(true);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : errorMessage(cause));
      if (cause instanceof Unresolved) { setSheet(null); session.refreshPending(); }
    } finally { setBusy(false); session.setBusy(false); }
  }
  async function checkOldSaving() {
    if (!generation || busy) return;
    setBusy(true); session.setBusy(true);
    try { const outcome = await resolveSaving(id, generation); setOldSaving(false); setTick(n => n + 1); setNotice(outcome === 'saved' ? '已核对：这笔旧攒钱在升级前已保存，结果按历史数据显示。' : '已核对：这笔旧攒钱没有提交。攒钱功能已停用，如需记录实际购入，请使用「已买到，记录购入」。'); }
    catch (cause) { setNotice(errorMessage(cause) + ' 暂时无法核对，请求仍保留。'); }
    finally { setBusy(false); session.setBusy(false); }
  }

  if (loading || (!item && !error)) return <div className="m-page"><NavBar title=""/><Loading label="正在读取心愿…"/></div>;
  if (!item) return <div className="m-page"><NavBar title=""/><ErrorState title="心愿读取失败" message={error} onRetry={() => { setLoading(true); setTick(n => n + 1); }}/></div>;

  const actions = detailActions(item), p = item.preferences, category = categoryName(item, taxonomy.data?.categories ?? null);
  const overdue = planOverdue(item, today), legacy = item.decision_state === 'legacy_achieved';
  const photos = item.photos?.filter(photo => photo.id !== item.cover?.id) ?? [];
  const line = replacement ? replacementLine(replacement, today) : null;
  const openAsset = (assetId: string) => nav.push('items.detail', { id: assetId });
  const hasBar = actions.record || actions.reconsider || actions.viewAsset || actions.verify;

  return <div className="m-page">
    <NavBar title="" primary={{ label: '编辑', onClick: () => nav.push('wishes.edit', { id: item.id }), disabled: blocked }}/>
    <LargeTitle title="心愿详情"/>
    <div className="w-stack">
      <ReceiptCards ops={receipts.ops} busy={receipts.busy} notice={receipts.notice} onResolve={op => void receipts.resolve(op)}/>
      {oldSaving && <Card tone="warn" className="w-notice-card"><p>有一笔升级前的攒钱提交结果待核对。</p><Button variant="primary" disabled={busy} onClick={() => void checkOldSaving()}>核对旧请求</Button></Card>}
      {notice && <Notice tone="positive">{notice}</Notice>}
      {taxonomy.error && <Notice tone="danger">分类与资料库信息读取失败：{taxonomy.error}。暂时不能保存修改。<Button onClick={taxonomy.retry}>重试</Button></Notice>}

      <Card className="w-hero" label="心愿概览">
        <div className="w-hero-id"><WishIcon photo={item.cover} generation={generation} large/>
          <div style={{ minWidth: 0 }}><h2>{item.fields.name}</h2><div className="w-hero-tags"><StatePill tone={stateTone(item.decision_state)}>{wishDecisionLabel(item.decision_state)}</StatePill>{category && <span>{category}</span>}{p?.pinned && <StatePill tone="neutral">置顶</StatePill>}</div></div></div>
        <div className="w-hero-facts">
          <div className="w-fact"><span>预计价格</span>{item.fields.estimated_price_cents === null ? <b className="m-unknown">价格未知</b> : <b>{moneyText(item.fields.estimated_price_cents)}</b>}</div>
          <div className="w-fact"><span>加入日期</span><b className="w-date">{addedDate(item)}</b></div>
        </div>
      </Card>

      {legacy && <Card tone="warn" className="w-notice-card" label="历史待核实"><p>{item.legacy_generated_asset ? '旧版因攒钱达标标为已实现，购入情况尚未确认。' : '旧版已实现记录缺少购入确认来源，请核实。'}不急着处理，它的金额不计入考虑中合计。</p></Card>}

      {plan && <Card tone="warn" className="w-impact" label="对规划的影响"><h3>对规划的影响</h3><p role="note">{plan.text}</p>{planNotes(plan.annotations).map(text => <small key={text}>{text}</small>)}<small>估算结果，不是理财建议。</small></Card>}

      {item.fields.notes && <Card className="w-block"><h3>想买的理由与顾虑</h3><p className="w-text">{item.fields.notes}</p></Card>}
      {item.decision_state === 'dropped' && item.decision_note && <Card className="w-block"><h3>为什么不买</h3><p className="w-text">{item.decision_note}</p></Card>}

      {item.fields.external_link && <ListGroup title="相关链接"><a className="m-row m-row-tall" href={item.fields.external_link} target="_blank" rel="noreferrer"><span className="m-row-icon m-tone-accent"><Icon name="doc" size={20}/></span><span className="m-row-main"><span className="m-row-title">相关链接</span><span className="m-row-sub">{linkHost(item.fields.external_link)}</span></span><span className="m-row-chevron"><Icon name="chevronRight" size={18}/></span></a></ListGroup>}
      {photos.length > 0 && <Card className="w-block"><h3>图片</h3><div className="w-photos">{photos.map(photo => <span className="w-photo" key={photo.id}>{generation && <PhotoView photo={photo} generation={generation} compact/>}</span>)}</div></Card>}

      {(item.fields.target_date || p?.channel_id) && <ListGroup title="计划与渠道">
        {item.fields.target_date && <ListRow title="计划日期" value={item.fields.target_date + (overdue ? '（已过）' : '')} subtitle={overdue ? '不会自动购买，更新日期后规划会重新估算' : undefined} icon="calendar" tone={overdue ? 'warn' : 'accent'}/>}
        {item.fields.target_date && (p?.reminder || item.decision_state === 'considering') && <ListRow title="计划日期提醒" value={p?.reminder ? '已开启' : '未开启'} subtitle={p?.reminder ? '当日上午 9 点单次通知，不会自动购买' : '只提醒日期，不会自动购买'} icon="bell"/>}
        {p?.channel_id && <ListRow title="可能购买的渠道" value={taxonomy.data?.channels.find(c => c.id === p.channel_id)?.name ?? '未设置'} icon="tag"/>}
      </ListGroup>}

      {item.replacement_asset && <ListGroup title="考虑替换的物品" footer="这只是一条关系，不会改动该物品；买下后你可以再决定是否退役或售出。">
        <ListRow title={item.replacement_asset.name} icon="box" subtitle={line ? <>{line.text}<br/>{line.investment}</> : replacementError ? undefined : '正在读取物品资料…'}
          onClick={item.replacement_asset.deleted ? undefined : () => openAsset(item.replacement_asset!.id)} trailing={item.replacement_asset.deleted ? <span className="m-unknown">在最近删除</span> : undefined} chevron={!item.replacement_asset.deleted}/>
      </ListGroup>}
      {replacementError && item.replacement_asset && <Notice tone="danger">原物品资料读取失败：{replacementError}<Button onClick={() => setReplacementTick(n => n + 1)}>重新读取物品</Button></Notice>}
      {item.replacement_asset_name && !item.replacement_asset && <Notice>考虑替换的原物品「{item.replacement_asset_name}」已永久删除；可在编辑心愿中清除这条关系。</Notice>}

      {item.converted_asset && <ListGroup title="已购入的物品"><ListRow title={item.converted_asset.name} icon="check" tone="positive" subtitle={item.converted_asset.deleted ? '在最近删除中，恢复后才能查看' : '查看物品'} onClick={item.converted_asset.deleted ? undefined : () => openAsset(item.converted_asset!.id)} chevron={!item.converted_asset.deleted}/></ListGroup>}
      {item.legacy_generated_asset && item.converted_asset?.id !== item.legacy_generated_asset.id && <ListGroup title="旧版自动生成"><ListRow title={item.legacy_generated_asset.name} icon="box" tone="neutral" subtitle={item.legacy_generated_asset.deleted ? '在最近删除中' : '旧版由此心愿自动生成的物品'} onClick={item.legacy_generated_asset.deleted ? undefined : () => openAsset(item.legacy_generated_asset!.id)} chevron={!item.legacy_generated_asset.deleted}/></ListGroup>}
      {legacySavings(item) && p && <ListGroup title="旧版记录（只读）" footer="攒钱功能已停用；金额保留为只读历史，不作为预算或账户余额。">
        <ListRow title="旧版已攒金额" value={moneyText(p.saved_cents)} icon="clock" tone="neutral"/>
        {item.legacy_generated_at && <ListRow title="旧版标为实现的日期" value={localDay(new Date(item.legacy_generated_at))} icon="calendar" tone="neutral"/>}
      </ListGroup>}

      <ListGroup><ListRow title={<span className="w-danger-row">删除心愿</span>} icon="trash" tone="danger" disabled={blocked} onClick={() => { setSheetError(''); setSheet('delete'); }} chevron/></ListGroup>
    </div>

    {hasBar && <ActionBar>
      <div className="w-actions">
        {actions.record && <Button variant="primary" block disabled={blocked || !generation} onClick={() => nav.push('wishes.purchase', { id: item.id })}>已买到，记录购入</Button>}
        {(actions.link || actions.drop) && <div className="w-actions-row">
          {actions.link && <Button block disabled={blocked || !generation} onClick={() => { setSheetError(''); setSheet('link'); }}>关联已有物品</Button>}
          {actions.drop && <Button variant="danger" block disabled={blocked || !generation} onClick={() => { setSheetError(''); setSheet('drop'); }}>不再考虑</Button>}
        </div>}
        {actions.verify && <Button variant={actions.record ? 'secondary' : 'primary'} block disabled={blocked || !generation} onClick={() => { setSheetError(''); setSheet('verify'); }}>核实这条旧记录…</Button>}
        {actions.reconsider && <Button variant="primary" block disabled={blocked || !generation} onClick={() => { setSheetError(''); setSheet('reconsider'); }}>重新考虑</Button>}
        {actions.viewAsset && <Button variant="primary" block onClick={() => openAsset(item.converted_asset!.id)}>查看物品</Button>}
      </div>
    </ActionBar>}

    {sheet === 'drop' && <DecisionSheet kind="drop" item={item} busy={busy} error={sheetError} onSubmit={drop} onClose={() => setSheet(null)}/>}
    {sheet === 'reconsider' && <DecisionSheet kind="reconsider" item={item} busy={busy} error={sheetError} onSubmit={reconsider} onClose={() => setSheet(null)}/>}
    {sheet === 'verify' && <VerifySheet item={item} busy={busy} error={sheetError} onSubmit={verify} onClose={() => setSheet(null)}/>}
    {sheet === 'delete' && <DeleteSheet name={item.fields.name} busy={busy} error={sheetError} onConfirm={() => void remove()} onClose={() => setSheet(null)}>{item.converted_asset && <p className="m-confirm-text">已购入的物品仍在全部物品中，不受影响。</p>}</DeleteSheet>}
    {sheet === 'link' && <CandidateSheet title="关联已有物品" intro="选择这件心愿对应的那次购入；不会修改所选物品的资料。退役或售出物品可用于补记历史购入。" legacyId={item.legacy_generated_asset?.id ?? null} confirmLabel="关联" busy={busy} error={sheetError} onPick={candidate => link(candidate)} onClose={() => setSheet(null)}/>}
  </div>;
}
