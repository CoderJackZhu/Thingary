// Development-only specimen, loaded exclusively by visual-preview.html?state=components.
import { createRoot } from 'react-dom/client';
import { Icon } from './AssetViews';
import { Info } from './FormControls';
import { applyAppearance, readMode, readStyle } from './appearance';
import './style.css';
import './app-layout.css';
import './desktop-polish.css';
import './ui.css';
import './theme.css';

applyAppearance(readStyle(), readMode());
function Specimen() {
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">物</span><strong>物志</strong></div><nav aria-label="组件导航"><button className="nav-active"><Icon name="overview"/>规范</button><button><Icon name="items"/>全部物品<span className="nav-count">8</span></button></nav></aside><main><div className="app-topbar">界面规范 · 开发预览</div><header className="page-header"><h1>物志 · 界面规范</h1></header><div style={{padding:'0 28px 28px',display:'grid',gap:16}}>
    <div className="stats-pair"><article className="ui-card ui-content"><div className="ui-section-head"><h3>字号：只用 5 级</h3></div><p style={{font:'var(--key-w) var(--key-size) var(--num)'}}>¥350,000</p><p style={{font:'600 var(--page-title) var(--head)'}}>全部物品</p><h3>购买与投入</h3><p>MacBook Pro 14″ · 2024-03-18</p><small className="muted">电脑与办公 · 剩 10 天</small></article><article className="ui-card ui-content"><div className="ui-section-head"><h3>布局常量</h3></div><dl className="facts"><dt>间距</dt><dd>4 / 8 / 12 / 16 / 20 / 24</dd><dt>页边距</dt><dd>上 22 · 左右 28</dd><dt>框架</dt><dd>216 / 52 / 300</dd><dt>行高</dt><dd>列表 48 · 表单 40 · 侧栏 30</dd></dl></article></div>
    <div className="ui-card ui-metrics">{[['金融净资产','¥350,000'],['持有物品','7 件'],['平均持有','1,140 天'],['心愿','3 条']].map(([label,value])=><div key={label}><span className="ui-label">{label}</span><strong className="ui-value">{value}</strong></div>)}</div>
    <article className="ui-card ui-content"><div className="ui-section-head"><h3>按钮、标签与状态</h3><Info text="说明在悬停和键盘聚焦时即时显示。"/></div><div style={{display:'flex',gap:12,alignItems:'center'}}><button className="primary">新增物品</button><button className="ui-btn">编辑资料</button><button className="ui-link">查看全部 →</button><span className="ui-tag">物品</span><span className="ui-state use">使用中</span><span className="ui-state warn">剩 10 天</span></div></article>
    <article className="ui-card"><table className="ui-table"><thead><tr><th>物品</th><th>购入日期</th><th className="r">购入金额</th></tr></thead><tbody><tr><td>MacBook Pro 14″</td><td>2024-03-18</td><td className="r">¥16,999</td></tr><tr><td>家里的咖啡机</td><td>2022-05-01</td><td className="r">待补充</td></tr></tbody></table></article>
  </div></main></div>;
}
createRoot(document.getElementById('root')!).render(<Specimen/>);
