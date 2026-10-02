import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Section } from './library-mode';
import { emptySearches, searchSections } from './topbar-model';
import type { BarMenu, BarSearch, PageBar } from './topbar-model';

export { buildNewMenu, emptySearches, searchSections } from './topbar-model';
export type { BarAction, BarMenu, BarMenuItem, BarSearch, NewTarget, PageBar, SearchSection } from './topbar-model';

type Registrar = {
  register: (owner: Section, get: () => PageBar | null) => void;
  unregister: (owner: Section) => void;
};
export const PageBarContext = createContext<Registrar | null>(null);

/**
 * Publish this page's topbar contribution while mounted. Passing null falls
 * back to the App's default bar for the section. The registration is removed
 * on unmount (its cleanup carries the section identity, so a page never
 * leaves actions behind), and display-relevant fields re-publish; the action
 * closures resolve through a ref, so the topbar always calls the page's
 * current handler — the same entry its own buttons and empty states use.
 */
export function usePageBar(section: Section, bar: PageBar | null) {
  const ctx = useContext(PageBarContext);
  const latest = useRef(bar);
  latest.current = bar;
  const get = useRef(() => latest.current);
  const signature = bar ? [
    bar.primary?.label ?? '', bar.primary?.disabled ? 'd' : '',
    bar.secondary?.label ?? '', bar.secondary?.disabled ? 'd' : '',
    bar.newRecord?.label ?? '', bar.newRecord?.disabled ? 'd' : '',
    bar.search?.key ?? '', bar.search?.placeholder ?? '',
    bar.menu?.label ?? '', bar.menu?.items.map(i => i.key).join('\n') ?? '',
  ].join('|') : '';
  useEffect(() => {
    if (!ctx) return;
    ctx.register(section, get.current);
    return () => ctx.unregister(section);
  }, [ctx, section, signature]);
}

/** The 新增记录 ▾ menu: arrow keys move, Enter runs, Esc closes back to the button. */
export function BarMenuButton({ menu, open, onOpen, buttonRef, kbd = false }: { menu: BarMenu; kbd?: boolean; open: boolean; onOpen: (open: boolean) => void; buttonRef: RefObject<HTMLButtonElement | null> }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Focus the first item synchronously after commit, before any keypress can land.
    listRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const away = (e: PointerEvent) => {
      if (!listRef.current?.parentElement?.contains(e.target as Node)) onOpen(false);
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open, onOpen]);
  const move = (e: React.KeyboardEvent) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(at + 1, items.length - 1)]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(at - 1, 0)]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); onOpen(false); buttonRef.current?.focus(); }
    else if (e.key === 'Tab') onOpen(false);
  };
  // Keys pressed while focus is still on the trigger keep working too.
  const triggerKeys = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); onOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    else if (e.key === 'Tab') onOpen(false);
  };
  return <span className="topbar-menu">
    <button ref={buttonRef} className="primary topbar-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => onOpen(!open)} onKeyDown={triggerKeys}>
      <svg className="ui-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>
      <span>{menu.label}</span>
      {kbd && <kbd>⌘N</kbd>}
      <svg className="ui-icon chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 8l3 3 3-3"/></svg>
    </button>
    {open && <div ref={listRef} role="menu" aria-label={menu.label} className="topbar-menu-list" onKeyDown={move}>
      {menu.items.map(item => <button role="menuitem" key={item.key} tabIndex={-1} onClick={() => { onOpen(false); item.run(); }}>{item.label}</button>)}
    </div>}
  </span>;
}

export function TopbarSearchBox({ search, value, inputRef, expanded, disabled = false, onExpand, onChange }: { search: BarSearch; value: string; inputRef: RefObject<HTMLInputElement | null>; expanded: boolean; disabled?: boolean; onExpand: () => void; onChange: (value: string) => void }) {
  if (!expanded) return <button type="button" className="search-collapsed" aria-label={search.placeholder} disabled={disabled} onClick={onExpand}>
    <svg className="ui-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-10 0 5 5 0 1 1 10 0M12 12l5 5"/></svg>
    <span>{search.placeholder}</span>
  </button>;
  return <label className="search">
    <svg className="ui-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-10 0 5 5 0 1 1 10 0M12 12l5 5"/></svg>
    <input ref={inputRef} aria-label={search.placeholder} placeholder={search.placeholder} value={value} maxLength={200} disabled={disabled}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        // IME composition owns Escape until the candidate window closes. WebKit
        // ends the composition before this keydown (isComposing is already
        // false) but still marks the key as IME-handled with keyCode 229.
        if (e.key === 'Escape' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.stopPropagation(); if (value) onChange(''); }
      }}/>
    {value && <button type="button" className="search-clear" aria-label={`清除${search.placeholder}`} disabled={disabled} onClick={() => { onChange(''); inputRef.current?.focus(); }}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>
    </button>}
  </label>;
}

/** Tracks the narrow-topbar breakpoint so the search box can collapse to a
 * button. 900 sits between the 1080 default-height window and the 800 minimum. */
export function useCompactTopbar(): boolean {
  const query = '(max-width: 900px)';
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return matches;
}
