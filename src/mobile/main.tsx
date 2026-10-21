import { startMobile } from './start';
import { installMobileRuntime } from './me/runtime';

// Saved appearance and the privacy lock apply before any tab renders.
installMobileRuntime();
startMobile();
