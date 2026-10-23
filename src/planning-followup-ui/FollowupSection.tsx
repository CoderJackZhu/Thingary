// 复盘接入组合（设计 §18.5）：投资核对卡片下方的资金流动入口。pair 为空（不足两次完整盘点）
// 时仍可记录流动，只是不显示区间核对方式；不新增侧栏栏目，不放入实际收入表冒充收入。
// 本组件不持有任何保存路径：一切读写经注入端口，模拟驱动仅存在于预览与测试。
import { useEffect, useRef, useState } from 'react';
import type { PlanningFollowupPortV1, ReviewPairV1 } from '../planning-followup-contract.ts';
import { reviewRecordsPeriod } from '../finance-contract.ts';
import type { FinancePeriod } from '../finance-contract.ts';
import { parseReviewInput } from '../investment-review/model.ts';
import type { InvestmentReviewInputV1 } from '../investment-review/model.ts';
import { MovementsList } from './MovementsList.tsx';
import { ReviewModeDialog } from './ReviewModePanel.tsx';
import { t } from '../i18n.ts';
function FollowupSectionContent({ port, generation, pair, writeVersion, today, blocked = false, onPending, onEditingChange, onSaved, movementPresentation = 'records', movementsEnabled = true, onViewAllMovements, input, receiptResolutionVersion = 0 }: {
  port: PlanningFollowupPortV1; generation: string; pair: ReviewPairV1 | null; writeVersion: number; today: string;
  blocked?: boolean; onPending: () => void; onEditingChange: (v: boolean) => void; onSaved?: () => void; receiptResolutionVersion?: number;
  movementPresentation?: 'records' | 'review'; movementsEnabled?: boolean; input?: InvestmentReviewInputV1;
  onViewAllMovements?: (period: FinancePeriod, accountIds: string[]) => void;
}) {
  const reviewButton = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [movementEditing, setMovementEditing] = useState(false);
  // Only the original receipt resolution may release the local unknown-result lock.
  const [uncertain, setUncertain] = useState(false), uncertainVersion = useRef(receiptResolutionVersion);
  const pending = () => { uncertainVersion.current = receiptResolutionVersion; setUncertain(true); onPending(); };
  useEffect(() => { if (uncertain && !blocked && receiptResolutionVersion > uncertainVersion.current) setUncertain(false); }, [receiptResolutionVersion, blocked, uncertain]);
  useEffect(() => { onEditingChange(dialogOpen || movementEditing || uncertain); return () => onEditingChange(false); }, [dialogOpen, movementEditing, uncertain, onEditingChange]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const parsed = input ? parseReviewInput(input) : null;
  const scopeInput = parsed?.ok ? parsed.value : null;
  const period = scopeInput ? reviewRecordsPeriod(scopeInput.from.date, scopeInput.to.date) : undefined;
  const accountIds = scopeInput ? [...new Set([...scopeInput.from.members, ...scopeInput.to.members].filter(m => m.counted).map(m => m.account_id))] : [];
  const list = <MovementsList port={port} generation={generation} writeVersion={writeVersion} today={today} receiptResolutionVersion={receiptResolutionVersion} blocked={blocked || dialogOpen || uncertain} onPending={pending} onEditingChange={setMovementEditing} onSaved={onSaved} {...(movementPresentation === 'review' ? { period, accountIds } : {})}/>;
  return <div className="pfu-followup">
    <div className="pfu-entry-row">
      {pair && <button ref={reviewButton} type="button" className="pfu-btn" disabled={blocked || uncertain || dialogOpen || movementEditing} onClick={() => setDialogOpen(true)}>{t('核对方式与完整性（手填／明细）')}</button>}
      <span className="pfu-muted small">{pair ? t('手填合计与明细汇总二选一。可按日期与账户筛选明细。') : t('还没有两次完整盘点：可以先记录资金流动，暂不显示区间损益。')}</span>
    </div>
    {!movementsEnabled ? <p className="pfu-state" role="status">{t('资金流动记录已关闭，明细核对暂不可用；已保存的方式保留，手填合计仍可使用。')}</p>
      : movementPresentation === 'records' ? list : period && <>{onViewAllMovements ? <button type="button" className="pfu-btn" disabled={blocked || uncertain || dialogOpen || movementEditing} onClick={() => onViewAllMovements(period, accountIds)}>{t('查看所选区间与投资范围的资金流动')}</button> : <details onToggle={e => setDetailsOpen(e.currentTarget.open)}><summary>{t('查看所选区间与投资范围的资金流动')}</summary>{detailsOpen && list}</details>}</>}
    {pair && dialogOpen && <ReviewModeDialog port={port} generation={generation} pair={pair} blocked={blocked || uncertain} movementsEnabled={movementsEnabled} onPending={pending} onClose={saved => { setDialogOpen(false); if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => reviewButton.current?.focus()); if (saved) onSaved?.(); }}/>}
  </div>;
}

/** A changed library or interval starts a fresh editor; old async work stays unmounted. */
export function FollowupSection(props: Parameters<typeof FollowupSectionContent>[0]) {
  return <FollowupSectionContent key={props.generation} {...props}/>;
}
