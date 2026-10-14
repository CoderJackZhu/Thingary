import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SupportLink } from './SupportLink';
import { LogoMark } from './LogoMark';
import type { DataHelpTarget } from './support';
import license from '../LICENSE?raw';
import thirdParty from '../THIRD_PARTY_LICENSES.md?raw';
import './support.css';

export function SupportPanel({ onData, blocked }: { onData: (target: DataHelpTarget) => void; blocked: boolean }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void invoke<string>('app_version').then(v => { if (active) setVersion(v); }).catch(() => { if (active) setVersion(''); });
    return () => { active = false; };
  }, []);
  return <section className="ui-card ui-content support-panel" aria-labelledby="support-heading">
    <header className="support-identity"><span className="support-mark"><LogoMark maskId="support-logo-holes"/></span><div><h2 id="support-heading">物谱 Thingary</h2><p className="muted">{version === null ? '正在读取版本…' : version ? `版本 ${version}` : '版本暂不可用'}</p></div></header>
    <p>物品档案与净资产盘点</p>
    <p className="muted small">开发与维护：CoderJackZhu</p>
    <nav className="support-links" aria-label="帮助与项目"><SupportLink target="guide">使用指南</SupportLink><SupportLink target="feedback">问题反馈</SupportLink><SupportLink target="project">项目主页 / 源码</SupportLink></nav>
    <p className="muted small">以上链接在浏览器中打开，需要联网。安装包内也附有离线使用说明。</p>
    <div className="support-actions"><button type="button" className="ui-btn" disabled={blocked} onClick={() => onData('update')}>版本与更新</button><button type="button" className="ui-btn" disabled={blocked} onClick={() => onData('backup')}>备份与恢复</button></div>
    <div className="support-details">
      <details><summary>隐私与资料安全</summary><p>没有账号，资料保存在本机，应用不上传资料。只有主动点“检查更新”时，才会向 Gitee 和 GitHub 读取公开的版本列表，不发送资料、设备或使用信息。</p><p>资料与备份没有应用级加密。自动备份和主资料位于同一台电脑，建议额外保存一份完整备份到外接盘或其他位置；若选择云盘，副本由云盘软件同步。</p></details>
      <details><summary>反馈时提供什么</summary><p>请写明物谱版本、macOS 版本、芯片、操作步骤和错误文字。截图请遮住真实资料，不要上传数据库、备份、发票或序列号。资料损坏时先保留现有资料和备份，再反馈问题。</p></details>
      <details><summary>开源许可与致谢</summary><p>代码按 AGPL-3.0-or-later 授权。名称“物谱”“Thingary”和应用图标不在该授权范围内，修改版再发布请使用自己的名称与图标。</p><p>规划模块早期参考了 Wealthfolio，后续重写不是洁净室实现；随机序列使用 Tommy Ettinger 的 Mulberry32 算法。详细记录见 <SupportLink target="sources">来源说明</SupportLink>。</p><details><summary>查看 AGPL 许可全文</summary><pre className="support-license" tabIndex={0}>{license}</pre></details><details><summary>查看第三方依赖许可清单</summary><pre className="support-license" tabIndex={0}>{thirdParty}</pre></details></details>
    </div>
  </section>;
}
