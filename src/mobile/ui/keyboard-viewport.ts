/** Keep shared mobile chrome inside WKWebView's visible area while the keyboard pans it. */
export function installKeyboardViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  // WebKit can report client rects after applying its native viewport pan. A fixed
  // origin lets focus measurements use the same coordinates as the actual DOM.
  const origin = document.createElement('span');
  origin.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none';
  origin.setAttribute('aria-hidden', 'true');
  document.body.append(origin);
  let frame = 0;
  const update = () => {
    frame = 0;
    // Do not counteract the user's pinch zoom. Browsers without this API keep the CSS fallback.
    if (Math.abs(viewport.scale - 1) > 0.01) {
      root.style.removeProperty('--m-viewport-top');
      root.style.removeProperty('--m-viewport-height');
      root.style.removeProperty('--m-viewport-bottom');
      delete root.dataset.keyboard;
      return;
    }
    root.style.setProperty('--m-viewport-top', `${viewport.offsetTop}px`);
    root.style.setProperty('--m-viewport-height', `${viewport.height}px`);
    root.style.setProperty('--m-viewport-bottom', `${Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)}px`);
    const keyboard = root.clientHeight - viewport.height > 120;
    root.toggleAttribute('data-keyboard', keyboard);
    if (!keyboard) return;
    const field = document.activeElement;
    if (!(field instanceof HTMLElement) || !field.matches('input, textarea, [contenteditable="true"]')) return;
    const scroller = field.closest<HTMLElement>('.m-sheet-body, .m-modal');
    const page = scroller ?? field.closest<HTMLElement>('.m-main');
    if (!page) return;
    const bounds = page.getBoundingClientRect();
    const nav = (page.closest('.m-sheet')?.querySelector('.m-sheet-head') ?? page.querySelector('.m-navbar'))?.getBoundingClientRect();
    const bar = page.querySelector('.m-actionbar, .mw-fixed')?.getBoundingClientRect();
    const visibleTop = viewport.offsetTop + origin.getBoundingClientRect().top;
    const top = Math.max(visibleTop, bounds.top, nav?.bottom ?? 0) + 8;
    let bottom = Math.min(visibleTop + viewport.height, scroller ? bounds.bottom : Infinity) - 8;
    if (bar && bar.top > top && bar.top < bottom) bottom = bar.top - 8;
    const rect = field.getBoundingClientRect();
    const delta = rect.top < top ? rect.top - top : rect.bottom > bottom ? Math.min(rect.bottom - bottom, rect.top - top) : 0;
    if (delta) {
      if (scroller) scroller.scrollBy({ top: delta, behavior: 'instant' });
      else window.scrollBy({ top: delta, behavior: 'instant' });
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  document.addEventListener('focusin', schedule);
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    origin.remove();
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    document.removeEventListener('focusin', schedule);
    root.style.removeProperty('--m-viewport-top');
    root.style.removeProperty('--m-viewport-height');
    root.style.removeProperty('--m-viewport-bottom');
    delete root.dataset.keyboard;
  };
}
