import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ReviewOuter } from './InvestmentReviewCard';
import { parseReviewInput, parseReviewResult, statusLabel } from './model.ts';
import { t } from '../i18n.ts';
/** Presentation only: never infer a profit or completeness from a collapsed view. */
export function reviewDisclosureState(outer: ReviewOuter): { label: string; attention: string } {
  if (outer.status === 'loading') return { label: t('正在读取'), attention: '' };
  if (outer.status === 'empty') return { label: t('暂无可比较盘点'), attention: '' };
  if (outer.status === 'error') return { label: t('读取失败'), attention: `投资区间核对读取失败：${outer.message}` };
  const input = parseReviewInput(outer.input), result = parseReviewResult(outer.result);
  if (!input.ok || !result.ok) return { label: t('资料无法识别'), attention: '投资核对资料无法识别，请展开查看错误。' };
  const status = result.value.status;
  return { label: status === 'ready' ? t('已核对') : statusLabel[status], attention: status === 'ready' || status === 'not_recorded' ? '' : `投资区间核对${statusLabel[status]}，请展开查看原因与处理入口。` };
}

/** Children stay mounted so results, reads, dialogs and unresolved-request locks survive folding. */
export function InvestmentReviewDisclosure({ label, messages, editing, children }: {
  label: string; messages: string[]; editing: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const attentionKey = messages.filter(Boolean).join('\n');
  useEffect(() => { if (attentionKey) setOpen(true); }, [attentionKey]);
  useEffect(() => { if (editing) setOpen(true); }, [editing]);
  return <div className="ivr-disclosure">
    {attentionKey && <div className="ivr-disclosure-notice" role="status">{messages.filter(Boolean).map(message => <p key={message}>{message}</p>)}</div>}
    <details className="ivr-advanced" open={open || editing} onToggle={event => {
      if (event.target !== event.currentTarget) return;
      if (editing && !event.currentTarget.open) event.currentTarget.open = true;
      else setOpen(event.currentTarget.open);
    }}>
      <summary>{t('投资区间核对（高级）')}<span className="ivr-muted"> · {label}</span></summary>
      <div className="ivr-advanced-body">{children}</div>
    </details>
  </div>;
}
