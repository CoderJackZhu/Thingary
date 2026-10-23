export const holdDelay = 450;
export const holdSlop = 8;
type Point = { x: number; y: number };
type Options = {
  enabled: () => boolean;
  editing: () => boolean;
  start: (block: HTMLElement, point: Point) => void;
  move: (point: Point) => void;
  end: () => void;
};

/** Native non-passive touchmove lets a stationary long press take over from scrolling on WKWebView.
 * Before the hold succeeds, nothing prevents scrolling or taps. Pointer events cover mouse/pen only. */
export function installOrderGesture(host: HTMLElement, options: Options): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined, clickTimer: ReturnType<typeof setTimeout> | undefined;
  let origin: Point | null = null, active = false, pointer: number | null = null, touch: number | null = null;
  let suppressClick = false;
  const clearHold = () => { clearTimeout(timer); timer = undefined; };
  const resetClick = () => { clearTimeout(clickTimer); clickTimer = undefined; suppressClick = false; };
  const end = () => {
    clearHold(); origin = null; pointer = null; touch = null;
    if (suppressClick) {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { suppressClick = false; clickTimer = undefined; }, 600);
    }
    if (active) { active = false; options.end(); }
  };
  const begin = (target: EventTarget | null, point: Point) => {
    end(); resetClick();
    const block = target instanceof Element ? target.closest<HTMLElement>('[data-home-block]') : null;
    if (!block || !host.contains(block) || !options.enabled()) return;
    origin = point;
    const start = () => {
      if (!origin || !block.isConnected || !options.enabled()) { end(); return; }
      active = true; suppressClick = true; options.start(block, point);
    };
    // Once in edit mode a new drag can start immediately.
    if (options.editing()) start(); else timer = setTimeout(start, holdDelay);
  };
  const move = (point: Point) => {
    if (!origin) return;
    if (!active && Math.hypot(point.x - origin.x, point.y - origin.y) > holdSlop) { end(); return; }
    if (active) options.move(point);
  };
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) { end(); return; }
    const finger = event.touches[0];
    begin(event.target, { x: finger.clientX, y: finger.clientY }); touch = origin ? finger.identifier : null;
    if (active) event.stopPropagation();
  };
  const touchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) { end(); return; }
    const finger = [...event.touches].find(item => item.identifier === touch);
    if (!finger) return;
    if (active) { if (event.cancelable) event.preventDefault(); event.stopPropagation(); }
    move({ x: finger.clientX, y: finger.clientY });
  };
  const touchEnd = (event: TouchEvent) => {
    if (touch === null) return;
    if (active) { if (event.cancelable) event.preventDefault(); event.stopPropagation(); }
    end();
  };
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) return;
    begin(event.target, { x: event.clientX, y: event.clientY }); pointer = origin ? event.pointerId : null;
    if (active) event.preventDefault();
  };
  const pointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (active) event.preventDefault();
    move({ x: event.clientX, y: event.clientY });
  };
  const pointerEnd = (event: PointerEvent) => { if (event.pointerId === pointer) end(); };
  const click = (event: MouseEvent) => {
    if (suppressClick || options.editing()) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  };
  const context = (event: Event) => { if (origin || options.editing()) event.preventDefault(); };
  const scroll = () => { if (!active) end(); };
  const visibility = () => { if (document.hidden) end(); };
  host.addEventListener('touchstart', touchStart, { passive: true });
  host.addEventListener('touchmove', touchMove, { passive: false });
  host.addEventListener('touchend', touchEnd, { passive: false });
  host.addEventListener('touchcancel', touchEnd, { passive: false });
  host.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerEnd);
  window.addEventListener('pointercancel', pointerEnd);
  host.addEventListener('click', click, true);
  host.addEventListener('contextmenu', context);
  window.addEventListener('scroll', scroll, { passive: true });
  window.addEventListener('blur', end);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    end(); clearTimeout(clickTimer);
    host.removeEventListener('touchstart', touchStart); host.removeEventListener('touchmove', touchMove);
    host.removeEventListener('touchend', touchEnd); host.removeEventListener('touchcancel', touchEnd);
    host.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerEnd); window.removeEventListener('pointercancel', pointerEnd);
    host.removeEventListener('click', click, true); host.removeEventListener('contextmenu', context);
    window.removeEventListener('scroll', scroll); window.removeEventListener('blur', end);
    document.removeEventListener('visibilitychange', visibility);
  };
}
