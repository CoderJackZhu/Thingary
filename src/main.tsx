import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
function App() { return <div className="shell"><aside><strong>物志</strong><span>本地工程验证</span><p className="selected">验证工作台</p></aside><main><header><div><p className="eyebrow">POSSIO · 静序</p><h1>让每一件物品，有迹可循。</h1></div><span className="badge">验证版</span></header><section><h2>本地窗口已就绪</h2><p>这一版用于验证保存与恢复，只使用虚构资料。</p><p>正式资产流程将在验证完成后分批实现。</p></section></main></div>; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
