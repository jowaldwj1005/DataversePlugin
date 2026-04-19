/**
 * Vitest global setup — runs before every test file.
 * Installs the Chrome API mock on globalThis.
 */

import { createChromeMock } from './mocks/chrome.js';
import { beforeEach } from 'vitest';

// Install chrome mock globally
globalThis.chrome = createChromeMock();

// Reset all mock call history between tests
beforeEach(() => {
  globalThis.chrome = createChromeMock();
});
