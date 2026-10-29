import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { pausableTimer } from './pausable-timer';
import { t } from './i18n.ts';

type NoticeKind = 'success' | 'error' | 'info';
export type AppNotice = { text: string; kind: NoticeKind };

export function useAppNotice() {
  const [notice, update] = useState<AppNotice | null>(null);
  const setNotice = useCallback((text: string, kind: NoticeKind = 'info') => update(text ? { text, kind } : null), []);
  const clearNotice = useCallback(() => update(null), []);
  return { notice, setNotice, clearNotice };
}

export function GlobalNotice({ notice, onDismiss, children }: { notice: AppNotice | null; onDismiss: () => void; children?: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const latestDismiss = useRef(onDismiss); latestDismiss.current = onDismiss;
  const timer = useRef<ReturnType<typeof pausableTimer> | null>(null);
  if (!timer.current) timer.current = pausableTimer(() => latestDismiss.current());
  useEffect(() => {
    if (!notice) timer.current!.reset();
    else if (notice.kind === 'success') timer.current!.start(5000);
    else timer.current!.cancel();
    return () => timer.current!.cancel();
  }, [notice]);
  useEffect(() => () => timer.current!.reset(), []);
  if (!notice) return null;
  function dismiss() {
    if (bar.current?.contains(document.activeElement)) document.getElementById('page-heading')?.focus();
    onDismiss();
  }
  const label = notice.kind === 'error' ? t('操作失败') : notice.kind === 'success' ? t('操作完成') : t('提示');
  return <div ref={bar} className={'status-line global-notice notice-' + notice.kind}
    onMouseEnter={() => timer.current!.pause('hover')} onMouseLeave={() => timer.current!.resume('hover')}
    onFocusCapture={() => timer.current!.pause('focus')} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) timer.current!.resume('focus'); }}>
    <span role={notice.kind === 'error' ? 'alert' : 'status'} aria-atomic="true"><strong>{label}</strong> {notice.text}</span>
    <div className="notice-actions">{children}<button type="button" aria-label={t('关闭提示')} onClick={dismiss}>×</button></div>
  </div>;
}
