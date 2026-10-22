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
import { t } from '../../../i18n.ts';
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="me-prose"><h2>{title}</h2>{children}</section>;

/** 关于与帮助, 反馈问题, 开源许可: the desktop support panel's content, without the update check (updates come through the App Store). */
export default function About({ page }: { page: Extract<SettingsPage, 'about' | 'feedback' | 'license'> }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => { let live = true; if (page !== 'license') invoke<string>('app_version').then(value => { if (live) setVersion(value); }).catch(() => { if (live) setVersion(''); }); return () => { live = false; }; }, [page]);
  const [note, setNote] = useState<{ tone: 'positive' | 'danger'; text: string } | null>(null);
  const diagnostics = () => diagnosticText({ version, userAgent: navigator.userAgent, screen: { width: screen.width, height: screen.height, ratio: window.devicePixelRatio || 1 } });
  if (page === 'feedback') return <SettingsShell title={settingsTitles.feedback} lead={t('遇到问题或有建议，写封邮件告诉我们。')}>
    <Card label={t('反馈')}>
      <div className="me-actions">
      <Button variant="primary" block onClick={async () => {
        // 只有固定目标经过 IPC：先复制诊断信息，用户粘贴到邮件里；不含资料库内容。
        const copied = await navigator.clipboard.writeText(diagnostics()).then(() => true, () => false);
        try { await invoke('support_open', { target: 'mail' }); setNote(copied ? { tone: 'positive', text: t('诊断信息已复制，可粘贴到邮件末尾。') } : null); }
        catch { setNote({ tone: 'danger', text: t('无法打开邮件。请手动发送到 {feedbackEmail}。', { feedbackEmail }) }); }
      }}>{t('写邮件反馈')}</Button>
      <Button block onClick={() => {
        navigator.clipboard.writeText(diagnostics()).then(() => setNote({ tone: 'positive', text: t('已复制诊断信息。') }), () => setNote({ tone: 'danger', text: t('复制失败，请手动选择文字。') }));
      }}>{t('复制诊断信息')}</Button>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      </div>
      <p className="me-prose-p">{t('点「写邮件反馈」会同时复制物谱版本、iOS 版本和设备类型，粘贴到邮件里即可，不包含你的资料。收件地址：{feedbackEmail}', { feedbackEmail })}</p>
      <h2 className="me-h2">{t('反馈时提供什么')}</h2>
      <p className="me-prose-p">{t('请写明物谱版本、系统版本、机型、安装来源、操作步骤和错误文字。截图请遮住真实资料，不要上传数据库、备份、发票或序列号。资料损坏时先保留现有资料和备份，再反馈问题。')}</p>
    </Card>
    <p className="m-group-footer"><SupportLink target="feedback">{t('在 GitHub 提交（需要账号）')}</SupportLink></p>
  </SettingsShell>;
  if (page === 'license') return <SettingsShell title={settingsTitles.license} lead={t('代码按 AGPL-3.0-or-later 授权。')}>
    <ListGroup><ListRow title={t('第三方声明与致谢')} subtitle={t('在浏览器中打开')} onClick={() => document.getElementById('me-sources-link')?.click()}/></ListGroup>
    <span hidden><SupportLink target="sources"><span id="me-sources-link">{t('第三方声明与致谢')}</span></SupportLink></span>
    <details className="me-details"><summary>{t('AGPL 许可全文')}</summary><pre className="me-license" tabIndex={0}>{license}</pre></details>
    <details className="me-details"><summary>{t('第三方依赖许可清单')}</summary><pre className="me-license" tabIndex={0}>{thirdParty}</pre></details>
  </SettingsShell>;
  return <SettingsShell title={settingsTitles.about}>
    <Card label={t('物谱')}>
      <div className="me-identity"><span className="h-logo"><LogoMark maskId="about-logo-holes"/></span><div><h2>{t('物谱 Thingary')}</h2><p>{t('物品档案与净资产盘点')}</p></div></div>
      <p className="me-prose-p">{t('版本')} {version === null ? t('读取中…') : version || t('暂不可用')}</p>
      <p className="me-prose-p">{t('开发与维护：')}<SupportLink target="author">CoderJackZhu</SupportLink></p>
    </Card>
    <aside className="star-card" aria-label={t('支持物谱')}><span className="star-card-mark" aria-hidden="true">⭐</span><p>{t('物谱是个人开源项目，每颗 ⭐ 都是继续做下去的动力。')}</p><SupportLink target="project">{t('去 GitHub 点个 Star')}</SupportLink></aside>
    <ListGroup title={t('帮助与项目')} footer={t('网页链接在浏览器中打开，需要联网。')}>
      {([['site', '产品主页'], ['guide', '使用指南'], ['feedback', '问题反馈'], ['project', '项目源码']] as const).map(([target, label]) => <p key={target} className="me-link-row"><SupportLink target={target}>{label}</SupportLink></p>)}
    </ListGroup>
    <Block title={t('隐私与资料安全')}>
      <p>{t('没有账号，资料保存在这台手机，应用不上传资料，使用完全离线。')}</p>
      <p>{t('可用恢复密钥加密备份，应用只保存公钥，恢复密钥由你保管；主资料库、图片与恢复保护副本未加密。首次使用须在数据管理选择启用加密或继续明文，选择前自动备份暂停。建议另存一份完整备份到手机以外的地方。')}</p>
    </Block>
  </SettingsShell>;
}
