/** 侧栏小标志：小尺寸三线版的单色形（3 条谱线、1 根小节线、3 个点，点周围镂空），颜色取 currentColor。 */
export function LogoMark() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <defs><mask id="logo-mark-holes"><rect width="24" height="24" fill="#fff"/><g fill="#000"><circle cx="8.2" cy="17.6" r="3.4"/><circle cx="12.6" cy="6.4" r="3.8"/><circle cx="17" cy="12" r="3.6"/></g></mask></defs>
    <g mask="url(#logo-mark-holes)" fill="currentColor" opacity=".75"><rect x="3" y="5.2" width="18" height="2.4"/><rect x="3" y="10.8" width="18" height="2.4"/><rect x="3" y="16.4" width="18" height="2.4"/><rect x="3" y="5.2" width="2.4" height="13.6"/></g>
    <g fill="currentColor"><circle cx="8.2" cy="17.6" r="2.3"/><circle cx="12.6" cy="6.4" r="2.8"/><circle cx="17" cy="12" r="2.6"/></g>
  </svg>;
}
