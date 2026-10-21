import { useModules } from '../modules-context';
import { useNav } from '../nav-context';
import { useSession } from '../session';
import { ErrorState, LargeTitle, Loading, Notice } from '../ui';
import { HomePage } from './HomePage';

/** PR #9 家底 page, mounted at wealth.overview until the wealth module redoes it from design 10. */
export default function LegacyHome() {
  const nav = useNav(), session = useSession(), { modules } = useModules();
  const { data } = session;
  return <div className="m-page">
    <LargeTitle title="财富"/>
    {session.notice && <Notice>{session.notice}</Notice>}
    {session.loading && <Loading label="正在读取账户资料…"/>}
    {session.error && <ErrorState title="资料读取失败" message={session.error} onRetry={session.busy ? undefined : session.reload}/>}
    {data && <HomePage summary={data.summary} hasAccounts={!!data.accounts.length} onCheckIn={() => nav.push('wealth.checkin')} onPlan={modules?.planning === false ? undefined : () => nav.switchTab('plan')}/>}
  </div>;
}
