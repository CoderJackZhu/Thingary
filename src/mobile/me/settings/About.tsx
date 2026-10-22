import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LogoMark } from '../../../LogoMark';
import { SupportLink } from '../../../SupportLink';
import license from '../../../../LICENSE?raw';
import thirdParty from '../../../../THIRD_PARTY_LICENSES.md?raw';
import { feedbackEmail } from '../../../support';
import { Button, Card, ListGroup, ListRow, Notice } from '../../ui';
import { diagnosticText } from '../feedback';
import type { SettingsPage } from '../model';
import { settingsTitles } from '../model';
import { SettingsShell } from './Shell';

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="me-prose"><h2>{title}</h2>{children}</section>;

/** 关于与帮助, 反馈问题, 开源许可: the desktop support panel's content, without the update check (updates come through the App Store). */
export default function About({ page }: { page: Extract<SettingsPage, 'about' | 'feedback' | 'license'> }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => { let live = true; if (page !== 'license') invoke<string>('app_version').then(value => { if (live) setVersion(value); }).catch(() => { if (live) setVersion(''); }); return () => { live = false; }; }, [page]);
  const [note, setNote] = useState<{ tone: 'positive' | 'danger'; text: string } | null>(null);
  const diagnostics = () => diagnosticText({ version, userAgent: navigator.userAgent, screen: { width: screen.width, height: screen.height, ratio: window.devicePixelRatio || 1 } });
  if (page === 'feedback') return <SettingsShell title={settingsTitles.feedback} lead="遇到问题或有建议，写封邮件告诉我们。">
    <Card label="反馈">
      <div className="me-actions">
      <Button variant="primary" block onClick={async () => {
        // 只有固定目标经过 IPC：先复制诊断信息，用户粘贴到邮件里；不含资料库内容。
        const copied = await navigator.clipboard.writeText(diagnostics()).then(() => true, () => false);
        try { await invoke('support_open', { target: 'mail' }); setNote(copied ? { tone: 'positive', text: '诊断信息已复制，可粘贴到邮件末尾。' } : null); }
        catch { setNote({ tone: 'danger', text: `无法打开邮件。请手动发送到 ${feedbackEmail}。` }); }
      }}>写邮件反馈</Button>
      <Button block onClick={() => {
        navigator.clipboard.writeText(diagnostics()).then(() => setNote({ tone: 'positive', text: '已复制诊断信息。' }), () => setNote({ tone: 'danger', text: '复制失败，请手动选择文字。' }));
      }}>复制诊断信息</Button>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      </div>
      <p className="me-prose-p">点「写邮件反馈」会同时复制物谱版本、iOS 版本和设备类型，粘贴到邮件里即可，不包含你的资料。收件地址：{feedbackEmail}</p>
      <h2 className="me-h2">反馈时提供什么</h2>
      <p className="me-prose-p">请写明物谱版本、系统版本、机型、安装来源、操作步骤和错误文字。截图请遮住真实资料，不要上传数据库、备份、发票或序列号。资料损坏时先保留现有资料和备份，再反馈问题。</p>
    </Card>
    <p className="m-group-footer"><SupportLink target="feedback">在 GitHub 提交（需要账号）</SupportLink></p>
  </SettingsShell>;
  if (page === 'license') return <SettingsShell title={settingsTitles.license} lead="代码按 AGPL-3.0-or-later 授权。">
    <ListGroup><ListRow title="第三方声明与致谢" subtitle="在浏览器中打开" onClick={() => document.getElementById('me-sources-link')?.click()}/></ListGroup>
    <span hidden><SupportLink target="sources"><span id="me-sources-link">第三方声明与致谢</span></SupportLink></span>
    <details className="me-details"><summary>AGPL 许可全文</summary><pre className="me-license" tabIndex={0}>{license}</pre></details>
    <details className="me-details"><summary>第三方依赖许可清单</summary><pre className="me-license" tabIndex={0}>{thirdParty}</pre></details>
  </SettingsShell>;
  return <SettingsShell title={settingsTitles.about}>
    <Card label="物谱">
      <div className="me-identity"><span className="h-logo"><LogoMark maskId="about-logo-holes"/></span><div><h2>物谱 Thingary</h2><p>物品档案与净资产盘点</p></div></div>
      <p className="me-prose-p">版本 {version === null ? '读取中…' : version || '暂不可用'}</p>
      <p className="me-prose-p">开发与维护：<SupportLink target="author">CoderJackZhu</SupportLink></p>
    </Card>
    <ListGroup title="帮助与项目" footer="网页链接在浏览器中打开，需要联网。">
      {([['site', '产品主页'], ['guide', '使用指南'], ['feedback', '问题反馈'], ['project', '项目源码']] as const).map(([target, label]) => <p key={target} className="me-link-row"><SupportLink target={target}>{label}</SupportLink></p>)}
    </ListGroup>
    <Block title="隐私与资料安全">
      <p>没有账号，资料保存在这台手机，应用不上传资料，使用完全离线。</p>
      <p>可用恢复密钥加密备份，应用只保存公钥，恢复密钥由你保管；主资料库、图片与恢复保护副本未加密。首次使用须在数据管理选择启用加密或继续明文，选择前自动备份暂停。建议另存一份完整备份到手机以外的地方。</p>
    </Block>
    <p className="m-group-footer">如果物谱对你有帮助，欢迎<SupportLink target="project">在 GitHub 点个 Star</SupportLink>。</p>
  </SettingsShell>;
}
