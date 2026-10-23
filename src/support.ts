export const supportUrls = {
  author: 'https://github.com/CoderJackZhu',
  project: 'https://github.com/CoderJackZhu/Thingary',
  guide: 'https://thingary.jackzhu.top/guide/',
  site: 'https://thingary.jackzhu.top/',
  feedback: 'https://github.com/CoderJackZhu/Thingary/issues/new?template=usage_feedback.yml',
  backup: 'https://thingary.jackzhu.top/guide/backup/',
  update: 'https://thingary.jackzhu.top/guide/update/',
  sources: 'https://github.com/CoderJackZhu/Thingary/blob/main/SOURCE_NOTICES.md',
  mail: 'mailto:feedback@jackzhu.top?subject=%E7%89%A9%E8%B0%B1%E5%8F%8D%E9%A6%88',
} as const;
/** 手机端「写邮件反馈」的收件地址；`mail` 打开带固定主题的邮件。 */
export const feedbackEmail = 'feedback@jackzhu.top';
export type SupportTarget = keyof typeof supportUrls;
export type DataHelpTarget = 'backup';

export function supportMenuDestination(action: string): 'support' | DataHelpTarget | null {
  if (action === 'open-help') return 'support';
  if (action === 'open-backup') return 'backup';
  if (action === 'open-about' || action === 'open-updates') return 'support';
  return null;
}
