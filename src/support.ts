export const supportUrls = {
  author: 'https://github.com/CoderJackZhu',
  project: 'https://github.com/CoderJackZhu/Thingary',
  guide: 'https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md',
  site: 'https://thingary.jackzhu.top/',
  feedback: 'https://github.com/CoderJackZhu/Thingary/issues',
  backup: 'https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md#backup',
  update: 'https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md#update',
  sources: 'https://github.com/CoderJackZhu/Thingary/blob/main/SOURCE_NOTICES.md',
} as const;
export type SupportTarget = keyof typeof supportUrls;
export type DataHelpTarget = 'backup';

export function supportMenuDestination(action: string): 'support' | DataHelpTarget | null {
  if (action === 'open-help') return 'support';
  if (action === 'open-backup') return 'backup';
  if (action === 'open-about' || action === 'open-updates') return 'support';
  return null;
}
