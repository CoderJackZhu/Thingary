import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { t } from '../../i18n.ts';
import { useCovered } from '../nav-context';
import { browserStorage } from '../me/shared';
import { Notice } from '../ui';
import { installOrderGesture } from './order-gesture';
import { moveHomeBlock, orderHomeBlocks, readHomeOrder, writeHomeOrder } from './order';
import type { HomeBlockId } from './order';

export type HomeBlock = { id: HomeBlockId; title: string; content: ReactNode };
type Drag = { id: HomeBlockId; y: number; grab: number; lastY: number; direction: number; moved: boolean };
type Pinned = { after: HomeBlockId; content: ReactNode };

export function OverviewOrder({ blocks, pinned, disabled, onSortingChange }: {
  blocks: HomeBlock[]; pinned?: Pinned; disabled: boolean; onSortingChange: (sorting: boolean) => void;
}) {
  const covered = useCovered();
  const [saved, setSaved] = useState(() => readHomeOrder(browserStorage()));
  const [draft, setDraft] = useState<HomeBlockId[] | null>(null);
  const [dragging, setDragging] = useState<HomeBlockId | null>(null);
  const [error, setError] = useState('');
  const host = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null), editingNow = useRef(false), swapping = useRef(false);
  const current = useRef({ blocks, saved, draft, disabled, covered, onSortingChange });
  current.current = { blocks, saved, draft, disabled, covered, onSortingChange };
  const editing = draft !== null, order = draft ?? saved;
  const shown = orderHomeBlocks(blocks, order);
  let pinnedAt = -1;
  if (pinned && !editing) {
    const after = shown.findIndex(block => block.id === pinned.after);
    pinnedAt = after >= 0 ? after + 1 : shown.findIndex(block => block.id === 'daily');
    if (pinnedAt < 0) pinnedAt = shown.length;
  }

  function startEditing() {
    if (editingNow.current) return;
    editingNow.current = true;
    setDraft([...current.current.saved]);
    current.current.onSortingChange(true);
  }

  function stopEditing() {
    editingNow.current = false; drag.current = null; swapping.current = false;
    setDragging(null); setDraft(null); setError('');
    current.current.onSortingChange(false);
  }

  function finish(save: boolean) {
    if (save && draft && !writeHomeOrder(browserStorage(), draft)) {
      setError(t('顺序未能保存，请重试。')); return;
    }
    if (save && draft) setSaved(draft);
    stopEditing();
  }

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    return installOrderGesture(root, {
      enabled: () => !current.current.disabled && !current.current.covered && current.current.blocks.length > 1,
      editing: () => editingNow.current,
      start: (block, point) => {
        if (!editingNow.current) startEditing();
        const rect = block.getBoundingClientRect();
        drag.current = { id: block.dataset.homeBlock as HomeBlockId, y: point.y, grab: point.y - rect.top, lastY: point.y, direction: 0, moved: false };
        setDragging(drag.current.id);
        // Supported browsers provide a short confirmation; WKWebView still has the visual lift.
        try { navigator.vibrate?.(10); } catch { /* Optional device feedback. */ }
      },
      move: point => {
        const value = drag.current; if (!value) return;
        if (Math.abs(point.y - value.y) > 2) value.moved = true;
        value.y = point.y;
      },
      end: () => { drag.current = null; swapping.current = false; setDragging(null); },
    });
  }, []);

  // Layout changes (including a reorder) must not move the lifted card away from the finger.
  useLayoutEffect(() => {
    const root = host.current;
    if (!root) return;
    const value = drag.current;
    for (const slot of root.querySelectorAll<HTMLElement>('[data-home-block]')) {
      const surface = slot.firstElementChild as HTMLElement | null;
      if (!surface) continue;
      surface.style.transform = value && value.id === slot.dataset.homeBlock
        ? `translateY(${value.y - value.grab - slot.getBoundingClientRect().top}px) scale(1.015)` : '';
    }
    swapping.current = false;
  });

  useEffect(() => {
    if (!dragging) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const value = drag.current, root = host.current;
      if (!value || !root) return;
      const state = current.current;
      if (state.disabled || state.covered) { drag.current = null; setDragging(null); return; }
      const slots = [...root.querySelectorAll<HTMLElement>('[data-home-block]')];
      const index = slots.findIndex(slot => slot.dataset.homeBlock === value.id), slot = slots[index];
      if (!slot) { drag.current = null; setDragging(null); return; }
      const surface = slot.firstElementChild as HTMLElement | null;
      if (!surface) return;
      const bar = document.querySelector('.m-tabbar')?.getBoundingClientRect();
      const top = document.querySelector('.h-sortbar')?.getBoundingClientRect().bottom ?? 60;
      const bottom = bar?.top ?? window.innerHeight - 80, edge = 64;
      const speed = value.moved ? (value.y < top + edge ? -Math.min(1, (top + edge - value.y) / edge)
        : value.y > bottom - edge ? Math.min(1, (value.y - bottom + edge) / edge) : 0) : 0;
      const before = window.scrollY;
      if (speed) window.scrollBy(0, speed * 550 * Math.min(32, now - previous) / 1000);
      previous = now;
      const delta = value.y - value.lastY + window.scrollY - before;
      if (delta) value.direction = Math.sign(delta);
      value.lastY = value.y;
      const rect = slot.getBoundingClientRect();
      surface.style.transform = `translateY(${value.y - value.grab - rect.top}px) scale(1.015)`;
      const adjacent = slots[index + value.direction];
      if (!swapping.current && value.moved && value.direction && adjacent) {
        const target = adjacent.getBoundingClientRect(), center = value.y - value.grab + rect.height / 2;
        if ((center - (target.top + target.height / 2)) * value.direction > 0) {
          swapping.current = true;
          setDraft(order => order ? moveHomeBlock(order, value.id, adjacent.dataset.homeBlock as HomeBlockId) : order);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  useEffect(() => {
    if (!disabled && !covered) return;
    drag.current = null; swapping.current = false; setDragging(null);
    if (editingNow.current) { editingNow.current = false; setDraft(null); setError(''); current.current.onSortingChange(false); }
  }, [disabled, covered]);

  useEffect(() => () => current.current.onSortingChange(false), []);

  const rows: ReactNode[] = [];
  shown.forEach((block, index) => {
    if (index === pinnedAt && pinned) rows.push(<div className="h-order-pinned" key="pinned">{pinned.content}</div>);
    rows.push(<div key={block.id} data-home-block={block.id}
      className={`h-order-slot${dragging === block.id ? ' h-order-moving' : ''}`} tabIndex={blocks.length > 1 ? 0 : undefined}
      role="group" aria-label={editing ? t('{title}，第 {position} 项，可用上下方向键移动', { title: block.title, position: index + 1 }) : t('{title}，长按调整顺序', { title: block.title })}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Escape' && editing) { event.preventDefault(); finish(false); }
        if (event.key === 'Enter' && editing) { event.preventDefault(); finish(true); }
        if ((event.key === ' ' || event.key === 'Enter') && !editing && !disabled && !covered && blocks.length > 1) {
          event.preventDefault(); startEditing();
        }
        if (editing && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          const next = shown[index + (event.key === 'ArrowUp' ? -1 : 1)];
          if (next) setDraft(order => order ? moveHomeBlock(order, block.id, next.id) : order);
        }
      }}>
      <div className="h-order-surface"><div inert={editing}>{block.content}</div></div>
    </div>);
    if (index === shown.length - 1 && pinnedAt === shown.length && pinned) rows.push(<div className="h-order-pinned" key="pinned">{pinned.content}</div>);
  });
  if (!shown.length && pinned && !editing) rows.push(<div className="h-order-pinned" key="pinned">{pinned.content}</div>);

  return <>
    {editing && <div className="m-navbar h-sortbar" role="toolbar" aria-label={t('调整总览顺序')}>
      <button type="button" className="m-navbar-button" onClick={() => finish(false)}>{t('取消')}</button>
      <span className="m-navbar-title">{t('调整顺序')}</span>
      <button type="button" className="m-navbar-button m-navbar-primary" onClick={() => finish(true)}>{t('完成')}</button>
    </div>}
    {error && <Notice tone="danger">{error}</Notice>}
    <div ref={host} className={`h-order${editing ? ' h-order-editing' : ''}`}>
      {rows}
    </div>
  </>;
}
