type Clock = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number | undefined) => void;
};

/** Independent pause reasons prevent mouse-leave from cancelling a focus pause. */
export function pausableTimer(expire: () => void, clock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: id => window.clearTimeout(id),
}) {
  let timer: number | undefined, remaining = 0, started = 0, running = false;
  const reasons = new Set<string>();
  const cancel = () => { clock.clearTimeout(timer); timer = undefined; running = false; };
  const schedule = () => {
    if (!running || reasons.size) return;
    started = clock.now();
    timer = clock.setTimeout(() => { timer = undefined; running = false; expire(); }, remaining);
  };
  return {
    start(ms: number) { cancel(); remaining = ms; running = true; schedule(); },
    cancel,
    pause(reason: string) {
      if (running && !reasons.size) { remaining = Math.max(0, remaining - (clock.now() - started)); clock.clearTimeout(timer); timer = undefined; }
      reasons.add(reason);
    },
    resume(reason: string) { if (reasons.delete(reason) && !reasons.size) schedule(); },
  };
}
