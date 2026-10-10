import { CentInput, FormRow } from '../FormControls.tsx';
import type { IncomeDraft } from './income-scope.ts';

export function IncomeSection({ value, onChange }: { value: IncomeDraft; onChange: (value: IncomeDraft) => void }) {
  const setItem = (id: string, patch: Partial<IncomeDraft['items'][number]>) => onChange({ ...value, items: value.items.map(x => x.id === id ? { ...x, ...patch } : x) });
  const add = () => {
    let n = 1; while (value.items.some(x => x.id === `career-trial-${n}`)) n++;
    const id = `career-trial-${n}`;
    onChange({ ...value, selected: [...value.selected, id], items: [...value.items, { id, label: '', monthly_cents: '', start_age: null, end_age: null, indexed: true }] });
  };
  return <section className="career-input" id="career-income"><h2>本次退休收入怎么计入</h2>
    <FormRow label="本次收入口径" hint="仅用于本次试算，关闭后丢弃；不会更改原计划。"><select aria-label="本次退休收入口径" value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as IncomeDraft['mode'] })}>
      <option value="saved">沿用原计划选择</option><option value="manual">使用明确手填的退休收入</option><option value="excluded">本次不计任何退休收入</option>
    </select></FormRow>
    <label className="career-check"><input type="checkbox" aria-label="本次不计公积金和个人养老金" checked={!!value.excludePools} onChange={e => onChange({ ...value, excludePools: e.target.checked })}/>本次不计公积金和个人养老金（余额、释放、未来转入都不算，只用可动用的钱，偏保守）</label>
    {value.excludePools && <p className="career-footnote">只在本次试算里忽略，已有账户和转入记录不会被删除或改动。若你的月开销里有靠公积金支付的部分（如房租、房贷提取），请按实际现金支出填写，否则会少算支出。</p>}
    {value.mode === 'excluded' && <p className="career-footnote">本次排除所有退休收入，包括养老金、年金等，由所声明资金承担退休预算；这不表示你实际没有养老金。若仍计其他收入，请改选手填并勾选对应项目。</p>}
    {value.mode === 'manual' && <>
      <p className="career-footnote">选择已有明细，或添加一笔明确假设。手填收入固定按下列条件计入，不因停缴、缴费基数变化重算；不会自动采用职工养老金估算或下方核对金额。</p>
      {value.items.map((item, i) => <div key={item.id} className="career-income-item">
        <label className="career-check"><input type="checkbox" aria-label={`计入第 ${i + 1} 笔退休收入`} checked={value.selected.includes(item.id)} onChange={e => onChange({ ...value, selected: e.target.checked ? [...value.selected, item.id] : value.selected.filter(id => id !== item.id) })}/>计入 {item.label || `第 ${i + 1} 笔收入`}</label>
        {value.selected.includes(item.id) && <>
          <FormRow label="收入名称"><input aria-label={`第 ${i + 1} 笔收入名称`} value={item.label} onChange={e => setItem(item.id, { label: e.target.value })}/></FormRow>
          <FormRow label="每月金额（元）"><CentInput label={`第 ${i + 1} 笔退休月收入`} value={item.monthly_cents} onChange={v => setItem(item.id, { monthly_cents: v })}/></FormRow>
          <FormRow label="开始年龄" hint="沿用现有明细的整岁口径，仅计退休后的收入区间；该生日月份起计入，其他起领时点暂不支持。"><input aria-label={`第 ${i + 1} 笔收入开始年龄`} type="number" min="0" max="120" step="1" value={item.start_age ?? ''} onChange={e => setItem(item.id, { start_age: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
          <FormRow label="结束年龄" hint="留空表示一直计到规划终点。"><input aria-label={`第 ${i + 1} 笔收入结束年龄`} type="number" min="0" max="120" step="1" value={item.end_age ?? ''} onChange={e => setItem(item.id, { end_age: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
          <label className="career-check"><input type="checkbox" aria-label={`第 ${i + 1} 笔收入随通胀变化`} checked={item.indexed} onChange={e => setItem(item.id, { indexed: e.target.checked })}/>随通胀变化，保持所示金额基准日的购买力</label>
        </>}
      </div>)}
      <button type="button" onClick={add}>添加一笔临时退休收入</button>
    </>}
  </section>;
}
