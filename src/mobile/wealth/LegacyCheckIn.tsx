import { useNav } from '../nav-context';
import { useSession } from '../session';
import { ErrorState, Loading, NavBar, Notice } from '../ui';
import { CheckInPage } from './CheckInPage';

/** PR #9 盘点 page, mounted as the wealth.checkin modal until the wealth module redoes it from design 12. */
export default function LegacyCheckIn() {
  const nav = useNav(), session = useSession(), { data } = session;
  const blocked = session.busy || session.loading || !!session.pending || !!session.error;
  return <div className="m-page">
    <NavBar title="盘点"/>
    {session.notice && <Notice>{session.notice}</Notice>}
    {session.loading && <Loading label="正在读取账户资料…"/>}
    {session.error && <ErrorState title="资料读取失败" message={session.error} onRetry={session.busy ? undefined : session.reload}/>}
    {data && <div key={data.summary.generation}><CheckInPage accounts={data.accounts} summary={data.summary} draft={data.draft} today={session.today} blocked={blocked} settled={session.settled} onBusy={session.setBusy} onPending={session.refreshPending} onReload={session.reload} onNew={() => nav.push('wealth.accountEdit')}/></div>}
  </div>;
}
