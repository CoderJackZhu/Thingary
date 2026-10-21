import { useEffect, useRef } from 'react';
import { useNav } from '../nav-context';
import { useSession } from '../session';
import { Loading, NavBar } from '../ui';
import { AccountForm } from './AccountForm';

/** PR #9 新增账户 form, mounted as the wealth.accountEdit modal until the wealth module redoes it. */
export default function LegacyAccountEdit() {
  const nav = useNav(), session = useSession(), generation = session.data?.summary.generation;
  const opened = useRef(generation);
  // A verified save or a changed library generation closes the form, as before.
  useEffect(() => { if (generation !== opened.current || session.settled?.command === 'wealth_account_save') nav.pop(); }, [generation, session.settled]);
  if (!session.data) return <div className="m-page"><NavBar title="新增账户"/><Loading label="正在读取账户资料…"/></div>;
  return <div className="m-page"><NavBar title="新增账户"/><AccountForm generation={session.data.summary.generation} today={session.today} onBusy={session.setBusy} onPending={session.refreshPending} onClose={saved => { if (saved) { session.setNotice('账户已保存，请填写当前余额。'); session.reload(); } nav.pop(); }}/></div>;
}
