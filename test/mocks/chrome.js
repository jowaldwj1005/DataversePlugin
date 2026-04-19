/**
 * Manual Chrome Extension API mock for Vitest.
 *
 * Only stubs the APIs actually used by this project:
 *   chrome.runtime.sendMessage, onMessage, lastError
 *   chrome.storage.local / session
 *   chrome.tabs.query / sendMessage
 */

import { vi } from 'vitest';

export function createChromeMock() {
  return {
    runtime: {
      sendMessage: vi.fn(),
      lastError: null,
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      getURL: vi.fn((path) => `chrome-extension://mock-id/${path}`),
    },
    storage: {
      local: {
        get: vi.fn((keys, cb) => cb?.({})),
        set: vi.fn((items, cb) => cb?.()),
        remove: vi.fn((keys, cb) => cb?.()),
      },
      session: {
        get: vi.fn((keys, cb) => cb?.({})),
        set: vi.fn((items, cb) => cb?.()),
        remove: vi.fn((keys, cb) => cb?.()),
      },
    },
    tabs: {
      query: vi.fn(),
      sendMessage: vi.fn(),
    },
  };
}
