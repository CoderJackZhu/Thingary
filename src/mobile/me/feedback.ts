// 反馈邮件：只带应用版本、系统版本和设备类型，不含任何资料库内容。纯函数，便于测试。
import { feedbackEmail, feedbackSubject } from '../../support.ts';

export type DiagnosticInput = { version: string | null; userAgent: string; screen?: { width: number; height: number; ratio: number } };

/** `CPU iPhone OS 17_4_1 like Mac OS X` to `17.4.1`; null when the user agent has no iOS version. */
export function iosVersion(userAgent: string): string | null {
  const match = /(?:iPhone|CPU) OS (\d+)[_.](\d+)(?:[_.](\d+))?/i.exec(userAgent);
  return match ? [match[1], match[2], match[3]].filter(Boolean).join('.') : null;
}
/** The web view only reveals the device family; the screen size narrows down the model. */
export function deviceText({ userAgent, screen }: Pick<DiagnosticInput, 'userAgent' | 'screen'>): string {
  const family = /iPad/i.test(userAgent) ? 'iPad' : /iPhone|iPod/i.test(userAgent) ? 'iPhone' : '未知设备';
  return screen && screen.width > 0 ? `${family}（屏幕 ${Math.round(screen.width)}×${Math.round(screen.height)} @${screen.ratio}x）` : family;
}
export function diagnosticText(input: DiagnosticInput): string {
  return [`物谱版本：${input.version || '未知'}`, `iOS 版本：${iosVersion(input.userAgent) ?? '未知'}`, `设备：${deviceText(input)}`].join('\n');
}
export function feedbackBody(diagnostics: string): string {
  return `问题描述：\n\n\n操作步骤：\n1. \n2. \n\n请勿附上真实账户、金额或备份文件；截图请先遮住个人资料。\n\n—— 诊断信息 ——\n${diagnostics}\n`;
}
export function feedbackMailto(diagnostics: string): string {
  return `mailto:${feedbackEmail}?subject=${encodeURIComponent(feedbackSubject)}&body=${encodeURIComponent(feedbackBody(diagnostics))}`;
}
