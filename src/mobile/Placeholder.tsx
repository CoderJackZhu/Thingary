import { routeDef } from './routes';
import { useEntry } from './nav-context';
import { LargeTitle, NavBar } from './ui';
import { EmptyState } from './ui';

/** Stand-in for registered routes that have no page yet; shows the design mockup to build from. */
export function Placeholder() {
  const { entry, kind, isRoot, title } = useEntry();
  const def = routeDef(entry.route);
  return <div className="m-page">
    {kind === 'modal' || !isRoot ? <NavBar title={title}/> : <LargeTitle title={title}/>}
    <EmptyState icon="info" title="这一页还在做" message={def?.design ? `设计稿 ${def.design}（docs/design/mobile）· 路由 ${entry.route}` : `没有独立设计稿 · 路由 ${entry.route}`}/>
  </div>;
}
