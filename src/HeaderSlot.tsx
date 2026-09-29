import { createPortal } from 'react-dom';
import { useEffect, useState, type ReactNode } from 'react';

// Page-owned controls render in the shared header and unmount with their page.
export function HeaderSlot({ children, target = 'page-header-actions' }: { children: ReactNode; target?: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.getElementById(target)); }, [target]);
  return host ? createPortal(children, host) : null;
}
