// Development-only specimen, loaded exclusively by visual-preview.html?state=components.
import { LogoMark } from './LogoMark';
import { createRoot } from 'react-dom/client';
import { Icon } from './AssetViews';
import { Info, FormRow, Segments, Switch, AddImageButton } from './FormControls';
import { useState } from 'react';
import { DateInput, MonthInput } from './DateInput';
import { applyAppearance, readMode, readStyle } from './appearance';
import './style.css';
import './app-layout.css';
import './desktop-polish.css';
import './ui.css';
import './theme.css';
import './controls.css';
import { t } from './i18n.ts';
applyAppearance(readStyle(), readMode());
function Specimen() {
  const [day,setDay]=useState(''),[month,setMonth]=useState('2026-10'),[on,setOn]=useState(false),[kind,setKind]=useState('day');
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><LogoMark/></span><strong>{t('物谱')}</strong></div><nav aria-label={t('组件导航')}><button className="nav-active"><Icon name="overview"/>{t('规范')}</button><button><Icon name="items"/>{t('全部物品')}<span className="nav-count">8</span></button></nav></aside><main><div className="app-topbar">{t('界面规范 · 开发预览')}</div><header className="page-header"><h1>{t('物谱 · 界面规范')}</h1></header><div style={{padding:'0 28px 28px',display:'grid',gap:16}}>
    <div className="stats-pair"><article className="ui-card ui-content"><div className="ui-section-head"><h3>{t('字号：只用 5 级')}</h3></div><p style={{font:'var(--key-w) var(--key-size) var(--num)'}}>¥350,000</p><p style={{font:'600 var(--page-title) var(--head)'}}>{t('全部物品')}</p><h3>{t('购买与投入')}</h3><p>MacBook Pro 14″ · 2024-03-18</p><small className="muted">{t('电脑与办公 · 剩 10 天')}</small></article><article className="ui-card ui-content"><div className="ui-section-head"><h3>{t('布局常量')}</h3></div><dl className="facts"><dt>{t('间距')}</dt><dd>4 / 8 / 12 / 16 / 20 / 24</dd><dt>{t('页边距')}</dt><dd>{t('上 22 · 左右 28')}</dd><dt>{t('框架')}</dt><dd>216 / 52 / 300</dd><dt>{t('行高')}</dt><dd>{t('列表 48 · 表单控件 38 · 侧栏 30')}</dd></dl></article></div>
    <article className="ui-card ui-content"><div className="ui-section-head"><h3>{t('共用表单 · 日期与状态')}</h3></div><section className="form-block">
      <FormRow label={t('日期（空值）')} hint={t('可以直接键入；留空仍是未知，打开选择器不会自动填入今天。')}><DateInput yearIntent="past" label={t('示例日期')} value={day} onChange={setDay} allowClear/></FormRow>
      <FormRow label={t('计划月份')} hint={t('月份只记录 YYYY-MM，不转换成某一天。')}><MonthInput yearIntent="long" label={t('示例月份')} value={month} onChange={setMonth} allowClear/></FormRow>
      <FormRow label={t('计费模式')}><Segments label={t('示例计费模式')} value={kind} onChange={setKind} options={[{value:'day',label:t('按日')},{value:'use',label:t('按次')}]}/></FormRow>
      <FormRow label={t('提醒')}><Switch label={t('示例提醒')} value={on} onChange={setOn}/></FormRow>
      <FormRow label={t('日期（错误）')} hint={t('示例错误：请填写有效日期。')}><DateInput label={t('错误日期')} value="2026-13-40" onChange={()=>{}} invalid/></FormRow>
      <FormRow label={t('日期（禁用）')}><DateInput label={t('禁用日期')} value="2026-10-07" onChange={()=>{}} disabled/></FormRow>
      <FormRow label={t('档案图片')} hint={t('样例按钮仅展示外观，不打开系统文件选择器。')}><AddImageButton onClick={()=>{}}/></FormRow>
    </section></article>
    <div className="ui-card ui-metrics">{[['金融净资产','¥350,000'],['持有物品','7 件'],['平均持有','1,140 天'],['心愿','3 条']].map(([label,value])=><div key={label}><span className="ui-label">{label}</span><strong className="ui-value">{value}</strong></div>)}</div>
    <article className="ui-card ui-content"><div className="ui-section-head"><h3>{t('按钮、标签与状态')}</h3><Info text={t('说明在悬停和键盘聚焦时即时显示。')}/></div><div style={{display:'flex',gap:12,alignItems:'center'}}><button className="primary">{t('新增物品')}</button><button className="ui-btn">{t('编辑资料')}</button><button className="ui-link">{t('查看全部 →')}</button><span className="ui-tag">{t('物品')}</span><span className="ui-state use">{t('使用中')}</span><span className="ui-state warn">{t('剩 10 天')}</span></div></article>
    <article className="ui-card"><table className="ui-table"><thead><tr><th>{t('物品')}</th><th>{t('购入日期')}</th><th className="r">{t('购入金额')}</th></tr></thead><tbody><tr><td>MacBook Pro 14″</td><td>2024-03-18</td><td className="r">¥16,999</td></tr><tr><td>{t('家里的咖啡机')}</td><td>2022-05-01</td><td className="r">{t('待补充')}</td></tr></tbody></table></article>
  </div></main></div>;
}
createRoot(document.getElementById('root')!).render(<Specimen/>);
