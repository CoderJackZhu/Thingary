// Standalone fictional preview of the current date/income contract. No native calls or persistence.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildBasicCapabilities } from '../plan-basic';
import { basicFixtureSources, basicInputFixtures } from '../plan-basic-fixtures';
import { TimeFields } from '../planning-simplified-ui/TimeFields';
import { FutureIncomeSection } from '../planning-simplified-ui/FutureIncomeSection';
import { requirementLine } from '../planning-basic-view';
import { forecastMoney } from '../plan-format';
import '../theme.css';
import '../ui.css';
import './preview.css';
import { t } from '../i18n.ts';
function App() {
  const [sources, setSources] = useState(() => basicFixtureSources(basicInputFixtures.prediction));
  const saved = sources.profile.status === 'ready' ? sources.profile.value.saved : null;
  if (!saved) return <p role="alert">{t('虚构资料尚未就绪。')}</p>;
  const fields = saved.profile.retire.simplified;
  const caps = buildBasicCapabilities(sources);
  const update = (patch: Partial<typeof fields>) => setSources(current => {
    const next = structuredClone(current);
    if (next.profile.status === 'ready' && next.profile.value.saved) next.profile.value.saved.profile.retire.simplified = { ...fields, ...patch };
    return next;
  });
  return <main><header><h1>{t('规划条件预览')}</h1><p>{t('虚构资料；修改只影响本页，刷新重置。资金起点、预算和预计投入使用通用示例。')}</p></header>
    <section className="panel"><TimeFields value={fields.time} onChange={time => update({ time })} issues={[]} busy={false} today={sources.today}/>
      <FutureIncomeSection fields={fields} onDraftChange={update} issues={[]} busy={false} today={sources.today}/></section>
    <section className="panel" aria-live="polite"><h2>{t('目标需求')}</h2>{caps.requirement.status === 'ready' ? <p>{requirementLine(caps.requirement.value.set, forecastMoney).text}</p> : <ul>{caps.requirement.missing.map(m => <li key={m.code + m.field}>{m.message}</li>)}</ul>}</section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
