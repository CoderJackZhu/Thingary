import { useState } from 'react';
import { OFFICIAL_TOOL, OFFICIAL_TOOL_NOTE } from './income-view';

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
      ? <button type="button" className="ui-link" onClick={open}>到{OFFICIAL_TOOL.name}测算 ↗</button>
      : <a className="ui-link" href={OFFICIAL_TOOL.url} target="_blank" rel="noopener noreferrer">到{OFFICIAL_TOOL.name}测算 ↗</a>}
    <p className="muted small">{OFFICIAL_TOOL_NOTE} 官方测算结果由你自己填到金额里；这项收入只用于计划，不会生成实际到账记录。</p>
    <details open={failed || undefined}>
      <summary>无法打开？查看或复制地址</summary>
      <p className="simplified-official-fallback" role={failed ? 'alert' : undefined}>
        {failed && '没有打开官方页面。'}地址：<code>{OFFICIAL_TOOL.url}</code>
        <button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制地址'}</button>
      </p>
      {copyError && <p className="error" role="alert">复制失败，请选中上方地址手动复制。</p>}
    </details>
  </div>;
}
