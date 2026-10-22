import { useEffect, useState } from 'react';
import { advanceFocus, needsAccessory } from './field-advance';
import { t } from '../../i18n.ts';
/**
 * 下一项 / 完成 bar above the iOS number pad, which has no Return key. 下一项 sends Return to the focused field
 * (so a page can route it, e.g. the check-in jumps to the next unfilled account) and otherwise moves to the next field;
 * 完成 closes the keyboard. Shown only while the keyboard is up (`data-keyboard` from installKeyboardViewport).
 * Mount once in the shell.
 */
export function KeyboardBar() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const show = root.hasAttribute('data-keyboard') && needsAccessory(document.activeElement);
      setOn(show);
      root.toggleAttribute('data-kbbar', show);
    };
    const later = () => requestAnimationFrame(update);
    document.addEventListener('focusin', later); document.addEventListener('focusout', later);
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-keyboard'] });
    update();
    return () => { document.removeEventListener('focusin', later); document.removeEventListener('focusout', later); observer.disconnect(); root.removeAttribute('data-kbbar'); };
  }, []);
  if (!on) return null;
  const field = () => document.activeElement as HTMLElement | null;
  const next = () => {
    const el = field();
    if (!el) return;
    // A page that handles Return calls preventDefault; otherwise move on ourselves.
    const handled = !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    if (!handled) advanceFocus(el);
  };
  return <div className="m-kbbar" role="toolbar" aria-label={t('键盘工具栏')}>
    <button type="button" className="m-navbar-button" onMouseDown={event => event.preventDefault()} onClick={next}>{t('下一项')}</button>
    <button type="button" className="m-navbar-button m-navbar-primary" onMouseDown={event => event.preventDefault()} onClick={() => field()?.blur()}>{t('完成')}</button>
  </div>;
}
