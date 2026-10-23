import { t } from '../../i18n.ts';
// 反馈邮件：只带应用版本、系统版本和设备类型，不含任何资料库内容。纯函数，便于测试。
export type DiagnosticInput = { version: string | null; userAgent: string; screen?: { width: number; height: number; ratio: number } };

/** `CPU iPhone OS 17_4_1 like Mac OS X` to `17.4.1`; null when the user agent has no iOS version. */
export function iosVersion(userAgent: string): string | null {
  const match = /(?:iPhone|CPU) OS (\d+)[_.](\d+)(?:[_.](\d+))?/i.exec(userAgent);
  return match ? [match[1], match[2], match[3]].filter(Boolean).join('.') : null;
}
/** The web view only reveals the device family; the screen size narrows down the model. */
export function deviceText({ userAgent, screen }: Pick<DiagnosticInput, 'userAgent' | 'screen'>): string {
  const family = /iPad/i.test(userAgent) ? 'iPad' : /iPhone|iPod/i.test(userAgent) ? 'iPhone' : t('未知设备');
  return screen && screen.width > 0 ? t('{family}（屏幕 {v2}×{v3} @{ratio}x）', { family, v2: Math.round(screen.width), v3: Math.round(screen.height), ratio: screen.ratio }) : family;
}
export function diagnosticText(input: DiagnosticInput): string {
  return [t('物谱版本：{v1}', { v1: input.version || '未知' }), t('iOS 版本：{v1}', { v1: iosVersion(input.userAgent) ?? '未知' }), t('设备：{v1}', { v1: deviceText(input) })].join('\n');
}
