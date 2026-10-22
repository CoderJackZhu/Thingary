/** 物谱标志：与应用图标完全一致（紫蓝渐变圆角底、白色五线谱、末尾一个暖色点），位置与配色取自 docs/brand/chosen/staff-relaxed-5.svg。颜色固定，不随浅色/深色或界面风格变化。 */
export function LogoMark({ maskId = 'logo-mark-holes' }: { maskId?: string }) {
  const fill = `${maskId}-fill`;
  return <svg className="logo-mark" viewBox="100 100 824 824" width="32" height="32" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={fill} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5e5ce6"/><stop offset="1" stopColor="#bf5af2"/></linearGradient>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><g fill="#000"><circle cx="306" cy="616" r="52"/><circle cx="424" cy="408" r="44"/><circle cx="542" cy="512" r="68"/><circle cx="660" cy="304" r="50"/><circle cx="778" cy="720" r="60"/></g></mask>
    </defs>
    <rect x="100" y="100" width="824" height="824" rx="190" fill={`url(#${fill})`}/>
    <g mask={`url(#${maskId})`} fill="#fff" opacity=".7"><rect x="208" y="288" width="608" height="32"/><rect x="208" y="392" width="608" height="32"/><rect x="208" y="496" width="608" height="32"/><rect x="208" y="600" width="608" height="32"/><rect x="208" y="704" width="608" height="32"/><rect x="208" y="288" width="32" height="448"/></g>
    <g fill="#fff"><circle cx="306" cy="616" r="38"/><circle cx="424" cy="408" r="30"/><circle cx="542" cy="512" r="54"/><circle cx="660" cy="304" r="36"/></g>
    <circle cx="778" cy="720" r="46" fill="#ffc9a3"/>
  </svg>;
}
