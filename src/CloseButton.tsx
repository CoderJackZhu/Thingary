import type { ButtonHTMLAttributes } from 'react';

/** Shared hit target and glyph for application dialogs; native window controls stay native. */
export function CloseButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" aria-label="关闭" {...props} className={`dialog-close ${className}`}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
  </button>;
}
