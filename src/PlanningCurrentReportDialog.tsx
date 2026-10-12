import { useEffect, useRef, useState } from 'react';
import { CloseButton } from './CloseButton';
import { PlanningReport } from './planning-report/PlanningReport';
import type { ReportInputV1 } from './planning-report/model';
import './planning-report/planning-report.css';

export function PlanningCurrentReportDialog({ report, onClose }: { report: ReportInputV1; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [privacy, setPrivacy] = useState(true);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="editor planning-current-report-dialog" aria-labelledby="current-report-heading" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="planning-current-report-frame">
      <header><div><p className="eyebrow">规划 · 只读报告</p><h2 id="current-report-heading">查看当前报告</h2><p className="muted">保留生成时的条件；关闭后不保存报告。默认隐藏金额。</p></div><CloseButton aria-label="关闭当前报告" onClick={onClose}/></header>
      <div className="planning-current-report-body"><PlanningReport outer={{ status: 'ready', input: report }} privacy={privacy} onPrivacyChange={setPrivacy} allowPrint={false} incompleteHeadlineLabel="本报告保留部分结果，请结合缺项与未覆盖内容核对。"/></div>
      <footer><p className="muted small">报告只读，关闭不改变规划条件。</p><button type="button" className="ui-btn" onClick={onClose}>关闭报告</button></footer>
    </div>
  </dialog>;
}
