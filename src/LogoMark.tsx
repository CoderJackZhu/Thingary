/** 侧栏标志：与应用图标同款的五线版单色形（5 条谱线、1 根小节线、5 个点，点周围镂空，点盖住线的末端），位置取自 docs/brand/chosen/staff-relaxed-5.svg，颜色取 currentColor。 */
export function LogoMark() {
  return <svg viewBox="180 220 680 580" width="26" height="22" aria-hidden="true" focusable="false">
    <defs><mask id="logo-mark-holes" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><g fill="#000"><circle cx="306" cy="616" r="52"/><circle cx="424" cy="408" r="44"/><circle cx="542" cy="512" r="68"/><circle cx="660" cy="304" r="50"/><circle cx="778" cy="720" r="60"/></g></mask></defs>
    <g mask="url(#logo-mark-holes)" fill="currentColor" opacity=".75"><rect x="208" y="288" width="608" height="32"/><rect x="208" y="392" width="608" height="32"/><rect x="208" y="496" width="608" height="32"/><rect x="208" y="600" width="608" height="32"/><rect x="208" y="704" width="608" height="32"/><rect x="208" y="288" width="32" height="448"/></g>
    <g fill="currentColor"><circle cx="306" cy="616" r="38"/><circle cx="424" cy="408" r="30"/><circle cx="542" cy="512" r="54"/><circle cx="660" cy="304" r="36"/><circle cx="778" cy="720" r="46"/></g>
  </svg>;
}
