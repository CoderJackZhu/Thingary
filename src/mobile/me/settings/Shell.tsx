import type { ReactNode } from 'react';
import { LargeTitle, NavBar } from '../../ui';

/** Frame of one settings sub-page: back button, large title, optional lead sentence. */
export function SettingsShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return <div className="m-page">
    <NavBar/>
    <LargeTitle title={title} subtitle={lead}/>
    {children}
  </div>;
}
