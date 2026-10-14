import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SupportLink } from './SupportLink';
import { LogoMark } from './LogoMark';
import { UpdateCheck } from './UpdateCheck';
import type { DataHelpTarget } from './support';
import license from '../LICENSE?raw';
import thirdParty from '../THIRD_PARTY_LICENSES.md?raw';
import './support.css';

type SupportPanelProps = { onData: (target: DataHelpTarget) => void; blocked: boolean };

export function SupportPanel(props: SupportPanelProps) {
  const heading = 'support-heading';
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void invoke<string>('app_version').then(v => { if (active) setVersion(v); }).catch(() => { if (active) setVersion(''); });
    return () => { active = false; };
  }, []);
  return <section className="ui-card ui-content support-panel" aria-labelledby={heading}>
    <header className="support-identity"><span className="support-mark"><LogoMark maskId={`${heading}-logo-holes`}/></span><div><h2 id={heading}>物谱 Thingary</h2><p className="muted">物品档案与净资产盘点</p></div></header>
    <p className="muted small support-maintainer">开发与维护：<SupportLink target="author">CoderJackZhu</SupportLink></p>
    <UpdateCheck showVersion={false} compact versionLabel={version === null ? '正在读取版本…' : version ? `版本 ${version}` : '版本暂不可用'}/>
    <nav className="support-links" aria-label="帮助与项目"><SupportLink target="guide">使用指南</SupportLink><SupportLink target="feedback">问题反馈</SupportLink><SupportLink target="project">项目源码</SupportLink><button type="button" className="ui-btn" disabled={props.blocked} onClick={() => props.onData('backup')}>备份与恢复</button></nav>
    <p className="muted small">网页链接在浏览器中打开，需要联网。安装包内附有离线使用说明。</p>
    <div className="support-details">
      <details><summary>隐私与资料安全</summary><p>没有账号，资料保存在本机，应用不上传资料。只有主动点“检查更新”时，才会向 Gitee 和 GitHub 读取公开的版本列表，不发送资料、设备或使用信息。</p><p>资料与备份没有应用级加密。自动备份和主资料位于同一台电脑，建议额外保存一份完整备份到外接盘或其他位置；若选择云盘，副本由云盘软件同步。</p></details>
      <details><summary>反馈时提供什么</summary><p>请写明物谱版本、macOS 版本、芯片、操作步骤和错误文字。截图请遮住真实资料，不要上传数据库、备份、发票或序列号。资料损坏时先保留现有资料和备份，再反馈问题。</p></details>
      <details><summary>开源许可与致谢</summary><p>代码按 AGPL-3.0-or-later 授权。<SupportLink target="sources">第三方声明与致谢</SupportLink></p><details><summary>查看 AGPL 许可全文</summary><pre className="support-license" tabIndex={0}>{license}</pre></details><details><summary>查看第三方依赖许可清单</summary><pre className="support-license" tabIndex={0}>{thirdParty}</pre></details></details>
    </div>
    <p className="muted small support-star">如果物谱对你有帮助，欢迎<SupportLink target="project">在 GitHub 点个 Star</SupportLink>。</p>
  </section>;
}
