import { startMobile } from './start';
import { installMobileRuntime } from './me/runtime';
import { takeLangReturn } from '../i18n.ts';

// Saved appearance and the privacy lock apply before any tab renders.
installMobileRuntime();
// After a language switch the reload returns to the page it was switched from.
startMobile(takeLangReturn() === 'me.settings:general' ? { tab: 'me', route: 'me.settings', params: { page: 'general' } } : undefined);
