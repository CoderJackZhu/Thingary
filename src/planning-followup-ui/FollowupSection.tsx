// 复盘接入组合（设计 §18.5）：投资核对卡片下方的资金流动入口。pair 为空（不足两次完整盘点）
// 时仍可记录流动，只是不显示区间核对方式；不新增侧栏栏目，不放入实际收入表冒充收入。
// 本组件不持有任何保存路径：一切读写经注入端口，模拟驱动仅存在于预览与测试。
import { useEffect, useRef, useState } from 'react';
import type { PlanningFollowupPortV1, ReviewPairV1 } from '../planning-followup-contract.ts';
import { MovementsList } from './MovementsList.tsx';
import { ReviewModeDialog } from './ReviewModePanel.tsx';

function FollowupSectionContent({ port, generation, pair, writeVersion, today, blocked = false, onPending, onEditingChange, onSaved }: {
  port: PlanningFollowupPortV1; generation: string; pair: ReviewPairV1 | null; writeVersion: number; today: string;
  blocked?: boolean; onPending: () => void; onEditingChange: (v: boolean) => void; onSaved?: () => void;
}) {
  const reviewButton = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [movementEditing, setMovementEditing] = useState(false);
  useEffect(() => { onEditingChange(dialogOpen || movementEditing); return () => onEditingChange(false); }, [dialogOpen, movementEditing, onEditingChange]);
  return <div className="pfu-followup">
    <div className="pfu-entry-row">
      {pair && <button ref={reviewButton} type="button" className="pfu-btn" disabled={blocked || dialogOpen || movementEditing} onClick={() => setDialogOpen(true)}>核对方式与完整性（手填／明细）</button>}
      <span className="pfu-muted small">{pair ? '手填合计与明细汇总二选一。可按日期与账户筛选明细。' : '还没有两次完整盘点：可以先记录资金流动，暂不显示区间损益。'}</span>
    </div>
    <MovementsList port={port} generation={generation} writeVersion={writeVersion} today={today} blocked={blocked || dialogOpen} onPending={onPending} onEditingChange={setMovementEditing} onSaved={onSaved}/>
    {pair && dialogOpen && <ReviewModeDialog port={port} generation={generation} pair={pair} blocked={blocked} onPending={onPending} onClose={saved => { setDialogOpen(false); if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => reviewButton.current?.focus()); if (saved) onSaved?.(); }}/>}
  </div>;
}

/** A changed library or interval starts a fresh editor; old async work stays unmounted. */
export function FollowupSection(props: Parameters<typeof FollowupSectionContent>[0]) {
  return <FollowupSectionContent key={props.generation} {...props}/>;
}
