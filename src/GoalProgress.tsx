import { money } from './asset';
import { forecastMoney } from './plan-format';
import { goalProgressChange, goalProgressVerdict, type GoalProgressEntry } from './goal-progress';
import { t } from './i18n.ts';
const ROWS = 12;

/** Past goal conclusions, as they stood on each check-in day. Read-only history:
 * later changes to the goal never rewrite it. */
export function GoalProgress({ entries }: { entries: GoalProgressEntry[] }) {
  if (entries.length < 2) return null;
  const latest = entries[entries.length - 1], previous = entries[entries.length - 2];
  const shown = entries.slice(-ROWS).reverse();
  return <section className="ui-card ui-content goal-progress" aria-labelledby="goal-progress-heading">
    <h3 id="goal-progress-heading">{t('盘点以来的变化')}</h3>
    <p>{goalProgressChange(previous, latest, forecastMoney)}</p>
    <details><summary>{t('查看历次盘点的结果（{length} 次）', { length: entries.length })}</summary>
    <p className="muted small">{t('每次完整盘点后第一次打开目标页时，记下当时的结论。按当时的条件计算，之后修改目标不会改写这里；带 * 的是当时仍有需确认事项。历史数字也保留当时的计算方法，跨版本差额不保证直接可比。')}</p>
    <table><thead><tr><th>{t('盘点日期')}</th><th>{t('可用资金')}</th><th>{t('需要每月存')}</th><th>{t('当时估计每月存')}</th><th>{t('当时结论')}</th></tr></thead>
      <tbody>{shown.map(e => <tr key={e.snapshot_id}>
        <td>{e.date}{e.point.has_open_items && <span title={t('当时仍有需确认事项')}> *</span>}</td>
        <td>{e.point.available_cents === null ? t('未知') : money(e.point.available_cents)}</td>
        <td>{e.point.required_monthly_cents === null ? t('未算出') : forecastMoney(e.point.required_monthly_cents)}</td>
        <td>{e.point.entered_monthly_cents === null ? t('未填写') : money(e.point.entered_monthly_cents)}</td>
        <td>{goalProgressVerdict(e.point, forecastMoney)}</td>
      </tr>)}</tbody></table></details>
  </section>;
}
