/** Line icons on a 24px grid, stroke follows `currentColor`. Add new names here so every module shares one set. */
const paths = {
  // Tab bar set (direction B): thin outline when inactive, solid when active. Cut-outs of the solid ones use --m-pill-bg so they read as holes in the active pill.
  tabHome: <path d="M12 3.6 3.6 10.4h1.9V20h4.7v-5h3.6v5h4.7v-9.6h1.9z"/>,
  tabBox: <><path d="M12 2.8 20.5 7.4v9.2L12 21.2 3.5 16.6V7.4z"/><path d="M3.8 7.6 12 12l8.2-4.4M12 12v9"/></>,
  tabWallet: <><rect x="3" y="6" width="18" height="14" rx="3.5"/><path d="M16 13h2.5M6 6l9-3 1.5 3"/></>,
  tabTarget: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></>,
  tabUser: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3.2"/><path d="M6.2 18.4c1.4-2.3 3.4-3.4 5.8-3.4s4.4 1.1 5.8 3.4"/></>,
  home: <><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></>,
  box: <><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/></>,
  chart: <><path d="M4 19l5-6 4 3 7-9"/><path d="M4 5v14h16"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></>,
  chevronRight: <path d="M9 5l7 7-7 7"/>,
  chevronLeft: <path d="M15 5l-7 7 7 7"/>,
  chevronDown: <path d="M5 9l7 7 7-7"/>,
  chevronUp: <path d="M5 15l7-7 7 7"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  check: <path d="M5 12.5l4.5 4.5L19 7"/>,
  close: <path d="M6 6l12 12M18 6L6 18"/>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></>,
  eye: <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M3 3l18 18"/><path d="M10.6 5.7A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3 3.6M6.4 7.4A17 17 0 0 0 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4-.9"/></>,
  bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></>,
  pin: <><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v6"/></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4"/>,
  sort: <><path d="M8 4v16M4.5 16.5L8 20l3.5-3.5M16 20V4M12.5 7.5L16 4l3.5 3.5"/></>,
  list: <path d="M4 7h16M4 12h16M4 17h16"/>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M4 18l5-5 4 4 3-3 4 4"/></>,
  shield: <><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/></>,
  doc: <><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6m-6 4h6"/></>,
  tag: <><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/></>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></>,
  warning: <><path d="M12 4l9.5 16h-19z"/><path d="M12 10v5M12 17.5v.5"/></>,
  heart: <path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>,
  refresh: <><path d="M20 6v5h-5"/><path d="M19.5 11A8 8 0 1 0 18 16"/></>,
} satisfies Record<string, React.ReactNode>;
const cut = 'var(--m-pill-bg,#fff)';
/** Solid variants for the selected tab. Painted with `currentColor`; inner details carry their own stroke or fill. */
const filled = {
  tabHome: <path d="M12 3.2 2.8 10.6a1 1 0 0 0 .6 1.8H5V20a1 1 0 0 0 1 1h4v-5.5h4V21h4a1 1 0 0 0 1-1v-7.6h1.6a1 1 0 0 0 .6-1.8z"/>,
  tabBox: <><path d="M12 2.4 21 7.3v9.4L12 21.6 3 16.7V7.3z"/><path d="M3.8 7.6 12 12l8.2-4.4M12 12v9.2" fill="none" stroke={cut} strokeWidth="1.4" strokeLinejoin="round"/></>,
  tabWallet: <><path d="M6 6l9-3 1.5 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><rect x="3" y="6" width="18" height="14" rx="3.5"/><circle cx="17" cy="13" r="1.5" fill={cut}/></>,
  tabTarget: <><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5" fill="none" stroke={cut} strokeWidth="1.6"/><circle cx="12" cy="12" r="1.5" fill={cut}/></>,
  tabUser: <><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="10" r="3.2" fill={cut}/><path d="M6.4 18.2c1.4-2.1 3.3-3.2 5.6-3.2s4.2 1.1 5.6 3.2A9.4 9.4 0 0 1 12 21.5a9.4 9.4 0 0 1-5.6-3.3z" fill={cut}/></>,
} satisfies Partial<Record<keyof typeof paths, React.ReactNode>>;
export type IconName = keyof typeof paths;

/** Decorative icon (aria-hidden). Pair it with visible text or give the surrounding button an aria-label. */
export function Icon({ name, size = 22, strokeWidth = 1.8, active = false }: { name: IconName; size?: number; strokeWidth?: number; /** Solid variant, when the icon has one (tab icons). */ active?: boolean }) {
  const solid = active && name in filled;
  if (solid) return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">{filled[name as keyof typeof filled]}</svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
