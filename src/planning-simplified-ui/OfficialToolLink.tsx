import { useState } from 'react';
import { OFFICIAL_TOOL, OFFICIAL_TOOL_NOTE } from './income-view';
import { t } from '../i18n.ts';
/** Browser default is a normal external link. Native hosts can inject their opener. */
export function OfficialToolLink({ onOpen }: { onOpen?: (url: string) => boolean }) {
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const open = () => {
    setCopied(false);
    try { setFailed(onOpen ? !onOpen(OFFICIAL_TOOL.url) : false); }
    catch { setFailed(true); }
  };
  const copy = async () => {
    setCopyError(false);
    try { await navigator.clipboard.writeText(OFFICIAL_TOOL.url); setCopied(true); }
    catch { setCopied(false); setCopyError(true); }
  };
  return <div className="simplified-official">
    {onOpen
      ? <button type="button" className="ui-link" onClick={open}>{t('到{name}测算 ↗', { name: OFFICIAL_TOOL.name })}</button>
      : <a className="ui-link" href={OFFICIAL_TOOL.url} target="_blank" rel="noopener noreferrer">{t('到{name}测算 ↗', { name: OFFICIAL_TOOL.name })}</a>}
    <p className="muted small">{t('{OFFICIAL_TOOL_NOTE} 官方测算结果由你自己填到金额里；这项收入只用于计划，不会生成实际到账记录。', { OFFICIAL_TOOL_NOTE })}</p>
    <details open={failed || undefined}>
      <summary>{t('无法打开？查看或复制地址')}</summary>
      <p className="simplified-official-fallback" role={failed ? 'alert' : undefined}>
        {failed && t('没有打开官方页面。')}{t('地址：')}<code>{OFFICIAL_TOOL.url}</code>
        <button type="button" onClick={() => void copy()}>{copied ? t('已复制') : t('复制地址')}</button>
      </p>
      {copyError && <p className="error" role="alert">{t('复制失败，请选中上方地址手动复制。')}</p>}
    </details>
  </div>;
}
