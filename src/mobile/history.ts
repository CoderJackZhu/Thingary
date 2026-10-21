// Keeps the browser/WKWebView history aligned with in-app pushes so the back key and the iOS
// edge swipe pop one page. Tab switches add no entries; a refresh returns to the tab root.
export type HistoryLike = { pushState(state: unknown, unused: string): void; replaceState(state: unknown, unused: string): void; back(): void; go(delta: number): void };

export class HistorySync {
  /** Number of history entries this app has added (and not yet left). */
  seq = 0;
  private expected = 0;
  private history: HistoryLike;
  private onBack: (steps: number) => boolean;
  /** `onBack` pops up to `steps` pages; return false to refuse (saving, unknown receipt). */
  constructor(history: HistoryLike, onBack: (steps: number) => boolean) {
    this.history = history; this.onBack = onBack;
    history.replaceState({ thingaryMobile: true, seq: 0 }, '');
  }
  /** Call after pushing a page or modal onto the stack. */
  push(): void { this.history.pushState({ thingaryMobile: true, seq: ++this.seq }, ''); }
  /** Call when the app itself pops a page, so the matching entry is consumed. */
  back(): void { if (this.seq > 0) { this.expected++; this.history.back(); } }
  /** Wire to the window `popstate` event. */
  handlePop(state: unknown): void {
    const target = state && typeof state === 'object' && (state as { thingaryMobile?: boolean }).thingaryMobile ? Number((state as { seq: number }).seq) : 0;
    if (this.expected > 0) { this.expected--; this.seq = target; return; }
    if (target < this.seq) {
      const steps = this.seq - target;
      if (!this.onBack(steps)) { this.expected++; this.history.go(steps); return; }
    }
    this.seq = target;
  }
}
