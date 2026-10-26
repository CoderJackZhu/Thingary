import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SupportLink } from './SupportLink';
import { LogoMark } from './LogoMark';
import { UpdateCheck } from './UpdateDiscovery';
import type { DataHelpTarget } from './support';
import license from '../LICENSE?raw';
import thirdParty from '../THIRD_PARTY_LICENSES.md?raw';
import './support.css';
import { t } from './i18n.ts';
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
    <header className="support-identity"><span className="support-mark"><LogoMark maskId={`${heading}-logo-holes`}/></span><div><h2 id={heading}>{t('物谱 Thingary')}</h2><p className="muted">{t('物品档案与净资产盘点')}</p></div></header>
    <aside className="star-card" aria-label={t('支持物谱')}><span className="star-card-mark" aria-hidden="true">⭐</span><p>{t('物谱是个人开源项目，每颗 ⭐ 都是继续做下去的动力。')}</p><SupportLink target="project">{t('去 GitHub 点个 Star')}</SupportLink></aside>
    <p className="muted small support-maintainer">{t('开发与维护：')}<SupportLink target="author">CoderJackZhu</SupportLink></p>
    <UpdateCheck showVersion={false} compact versionLabel={version === null ? t('正在读取版本…') : version ? t('版本 {version}', { version }) : t('版本暂不可用')}/>
    <nav className="support-links" aria-label={t('帮助与项目')}><SupportLink target="site">{t('产品主页')}</SupportLink><SupportLink target="guide">{t('使用指南')}</SupportLink><SupportLink target="feedback">{t('问题反馈')}</SupportLink><SupportLink target="project">{t('项目源码')}</SupportLink><button type="button" className="ui-btn" disabled={props.blocked} onClick={() => props.onData('backup')}>{t('备份与恢复')}</button></nav>
    <p className="muted small">{t('网页链接在浏览器中打开，需要联网。Mac 的安装磁盘映像里附有离线使用说明；Windows 安装包不含，请用网页版使用指南。')}</p>
    <div className="support-details">
      <details><summary>{t('隐私与资料安全')}</summary><p>{t('屏幕遮罩与系统认证可在设置的「屏幕隐私」中开启。')}</p><p>{t('没有账号，资料保存在本机，默认不上传。可选的 WebDAV 同步默认关闭，开启后只连接你自己配置的服务器，内容用你的口令加密后上传。除此之外，只有你开启“启动时检查更新”或主动点“检查更新”时，才会向 Gitee 和 GitHub 的公开版本列表各查询一次，附普通网络信息与应用版本标识，不发送资料、设备或使用信息。下载和安装始终由你决定。')}</p><p>{t('可用恢复密钥加密备份，应用只保存公钥，恢复密钥由你保管；主资料库、图片与恢复保护副本未加密。首次使用须在数据管理选择启用加密或继续明文，选择前自动与额外备份暂停。自动备份和主资料位于同一台电脑，建议额外保存一份完整备份到外接盘或其他位置；若选择云盘，副本由云盘软件同步。')}</p></details>
      <details><summary>{t('反馈时提供什么')}</summary><p>{t('请写明物谱版本、系统版本、芯片／架构、安装包来源、操作步骤和错误文字。截图请遮住真实资料，不要上传数据库、备份、发票或序列号。资料损坏时先保留现有资料和备份，再反馈问题。')}</p><p>{t('只想说使用感受？回答三个问题就很有帮助：你以前用什么？第二次盘点你回来了吗，为什么没回来？什么会让你推荐给别人？')}</p></details>
      <details><summary>{t('开源许可与致谢')}</summary><p>{t('代码按 AGPL-3.0-or-later 授权。')}<SupportLink target="sources">{t('第三方声明与致谢')}</SupportLink></p><details><summary>{t('查看 AGPL 许可全文')}</summary><pre className="support-license" tabIndex={0}>{license}</pre></details><details><summary>{t('查看第三方依赖许可清单')}</summary><pre className="support-license" tabIndex={0}>{thirdParty}</pre></details></details>
    </div>
  </section>;
}
