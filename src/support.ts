export const supportUrls = {
  project: 'https://github.com/CoderJackZhu/Thingary',
  guide: 'https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md',
  feedback: 'https://github.com/CoderJackZhu/Thingary/issues',
  backup: 'https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md#backup',
  update: 'https://github.com/CoderJackZhu/Thingary/blob/main/docs/USER_GUIDE.md#update',
  sources: 'https://github.com/CoderJackZhu/Thingary/blob/main/SOURCE_NOTICES.md',
} as const;
export type SupportTarget = keyof typeof supportUrls;
export type DataHelpTarget = 'backup' | 'update';

export function supportMenuDestination(action: string): 'support' | DataHelpTarget | null {
  if (action === 'open-help') return 'support';
  if (action === 'open-backup') return 'backup';
  if (action === 'open-updates') return 'update';
  return null;
}
