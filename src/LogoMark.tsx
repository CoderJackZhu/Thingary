/** 侧栏小标志：小尺寸三线·方形版的单色形（3 条谱线、1 根小节线、3 个点，点周围镂空；内容约 15×14，近似方形），颜色取 currentColor。 */
export function LogoMark() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <defs><mask id="logo-mark-holes"><rect width="24" height="24" fill="#fff"/><g fill="#000"><circle cx="6.9" cy="17.8" r="3.1"/><circle cx="12" cy="6.2" r="3.5"/><circle cx="17.1" cy="12" r="3.3"/></g></mask></defs>
    <g mask="url(#logo-mark-holes)" fill="currentColor" opacity=".75"><rect x="4.5" y="4.9" width="15" height="2.6"/><rect x="4.5" y="10.7" width="15" height="2.6"/><rect x="4.5" y="16.5" width="15" height="2.6"/><rect x="4.5" y="4.9" width="2.6" height="14.2"/></g>
    <g fill="currentColor"><circle cx="6.9" cy="17.8" r="2.2"/><circle cx="12" cy="6.2" r="2.6"/><circle cx="17.1" cy="12" r="2.4"/></g>
  </svg>;
}
