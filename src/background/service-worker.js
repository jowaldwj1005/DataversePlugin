/**
 * Dataverse Toolkit - Background Service Worker
 *
 * Central message router and API proxy for the extension. All Dataverse API
 * calls flow through here so that CORS restrictions on the side panel,
 * popup, and devtools are avoided entirely.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MESSAGE_TYPES = Object.freeze({
  GET_TOKEN: 'GET_TOKEN',
  SET_TOKEN: 'SET_TOKEN',
  GET_ENV: 'GET_ENV',
  API_REQUEST: 'API_REQUEST',
  CLEAR_CACHE: 'CLEAR_CACHE',
  GET_METADATA_CACHE: 'GET_METADATA_CACHE',
  SET_METADATA_CACHE: 'SET_METADATA_CACHE',
});

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const API_VERSION_FALLBACK = 'v9.2';

// ---------------------------------------------------------------------------
// In-memory state (survives only as long as the SW is alive; persistent
// copies are kept in chrome.storage.session / chrome.storage.local).
// ---------------------------------------------------------------------------

/** @type {{ url: string, orgId: string, orgName: string, apiVersion: string } | null} */
let activeEnv = null;

/** @type {Map<string, { token: string, expiresAt: number }>} */
const tokensByOrg = new Map();

/**
 * API request log entries pushed to DevTools panels that subscribe via
 * long-lived port connections.
 * @type {Array<{ id: string, timestamp: number, method: string, url: string, status: number | null, duration: number, request: any, response: any }>}
 */
const requestLog = [];
const MAX_LOG_ENTRIES = 500;

/** @type {Set<chrome.runtime.Port>} */
const devtoolsPorts = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  return crypto.randomUUID();
}

/**
 * Extract the base org URL from a full Dynamics 365 URL.
 * e.g. "https://myorg.crm.dynamics.com/main.aspx?..." -> "https://myorg.crm.dynamics.com"
 */
function extractOrgUrl(fullUrl) {
  try {
    const u = new URL(fullUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Build the Web API base URL for the active environment.
 */
function apiBaseUrl(env = activeEnv) {
  if (!env) return null;
  const version = env.apiVersion || API_VERSION_FALLBACK;
  return `${env.url}/api/data/${version}`;
}

// ---------------------------------------------------------------------------
// Token management (session storage for security)
// ---------------------------------------------------------------------------

async function storeToken(orgUrl, token) {
  tokensByOrg.set(orgUrl, { token, expiresAt: Date.now() + 55 * 60 * 1000 }); // ~55 min
  await chrome.storage.session.set({ [`token_${orgUrl}`]: { token, expiresAt: Date.now() + 55 * 60 * 1000 } });
}

async function getToken(orgUrl) {
  // Check in-memory first
  const mem = tokensByOrg.get(orgUrl);
  if (mem && mem.expiresAt > Date.now()) return mem.token;

  // Fall back to session storage
  const key = `token_${orgUrl}`;
  const result = await chrome.storage.session.get(key);
  if (result[key] && result[key].expiresAt > Date.now()) {
    tokensByOrg.set(orgUrl, result[key]);
    return result[key].token;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Metadata cache helpers (local storage, namespaced per environment)
// ---------------------------------------------------------------------------

function cacheKey(env, key) {
  return `metacache_${env.url}_${key}`;
}

async function getMetadataCache(env, key) {
  const fullKey = cacheKey(env, key);
  const result = await chrome.storage.local.get(fullKey);
  const entry = result[fullKey];
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    await chrome.storage.local.remove(fullKey);
    return null;
  }
  return entry.value;
}

async function setMetadataCache(env, key, value, ttl = DEFAULT_CACHE_TTL_MS) {
  const fullKey = cacheKey(env, key);
  await chrome.storage.local.set({
    [fullKey]: {
      value,
      expiresAt: Date.now() + ttl,
      storedAt: Date.now(),
    },
  });
}

async function clearMetadataCache(env) {
  const allKeys = await chrome.storage.local.get(null);
  const prefix = `metacache_${env.url}_`;
  const keysToRemove = Object.keys(allKeys).filter((k) => k.startsWith(prefix));
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

// ---------------------------------------------------------------------------
// API request proxy
// ---------------------------------------------------------------------------

/**
 * Send a message to a specific tab and return the response.
 * Rejects with the Chrome lastError message on failure.
 * @param {number} tabId
 * @param {object} message
 * @returns {Promise<any>}
 */
function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Programmatically inject content scripts into a tab.
 * Used to recover from orphaned scripts after extension reload.
 * @param {number} tabId
 */
async function injectContentScripts(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/content-script.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId, world: 'MAIN' },
      files: ['src/content/page-extractor.js'],
    });
    // Brief delay for scripts to register their message listeners
    await new Promise((r) => setTimeout(r, 300));
  } catch {
    throw new Error('Content script not ready — refresh the Dynamics 365 page and try again.');
  }
}

/**
 * Find a Dynamics 365 tab to proxy API requests through.
 * @returns {Promise<number|null>} Tab ID or null
 */
async function findDynamicsTab() {
  const tabs = await chrome.tabs.query({ url: 'https://*.dynamics.com/*' });
  return tabs.length > 0 ? tabs[0].id : null;
}

/**
 * Execute an API request against the Dataverse Web API on behalf of a caller
 * (side panel, popup, devtools).
 *
 * Uses two strategies:
 * 1. Cookie auth: proxy through the content script → page context (session cookies)
 * 2. Bearer auth: direct fetch from background (if a real bearer token is available)
 *
 * @param {{ method: string, url: string, headers?: Record<string,string>, body?: any }} reqDef
 * @returns {Promise<{ ok: boolean, status: number, statusText: string, headers: Record<string,string>, data: any }>}
 */
async function proxyApiRequest(reqDef) {
  // Service workers can be killed by Chrome when idle; restore env from
  // session storage so requests survive a SW restart.
  if (!activeEnv) {
    const stored = await chrome.storage.session.get('activeEnv');
    if (stored.activeEnv) activeEnv = stored.activeEnv;
  }
  const env = activeEnv;
  if (!env) throw new Error('No active Dataverse environment detected. Open a Dynamics 365 tab first.');

  // Build absolute URL if a relative path was provided
  let url = reqDef.url;
  if (url.startsWith('/')) {
    url = `${env.url}${url}`;
  } else if (!url.startsWith('http')) {
    url = `${apiBaseUrl(env)}/${url}`;
  }

  const fullReqDef = { ...reqDef, url };

  const startTime = performance.now();

  // All requests proxy through the active Dynamics 365 tab's content script.
  // The page-extractor.js (MAIN world) runs at the *.dynamics.com origin and
  // has session cookies, so fetch() there is same-origin — no CORS, no auth issues.
  const tabId = await findDynamicsTab();
  if (!tabId) throw new Error('No Dynamics 365 tab found. Open a Dynamics 365 page first.');

  let result;
  try {
    result = await sendMessageToTab(tabId, { type: 'PROXY_VIA_PAGE', payload: fullReqDef });
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
      // Content script is orphaned (common after extension reload in dev mode).
      // Re-inject both scripts and retry once.
      await injectContentScripts(tabId);
      result = await sendMessageToTab(tabId, { type: 'PROXY_VIA_PAGE', payload: fullReqDef });
    } else {
      throw err;
    }
  }

  const duration = performance.now() - startTime;

  if (!result || (!result.success && !result.ok)) {
    const errMsg = result?.error ?? `Request failed (HTTP ${result?.status ?? 0})`;
    logApiRequest(fullReqDef, { ok: false, status: result?.status ?? 0, statusText: errMsg, data: null, headers: {} }, duration);
    throw new Error(errMsg);
  }

  logApiRequest(fullReqDef, result, duration);
  return result;
}

// ---------------------------------------------------------------------------
// API request logging (for DevTools panel)
// ---------------------------------------------------------------------------

function logApiRequest(request, response, duration) {
  const entry = {
    id: generateId(),
    timestamp: Date.now(),
    method: request.method || 'GET',
    url: request.url,
    status: response.status,
    duration: Math.round(duration),
    request: { headers: request.headers, body: request.body },
    response: { headers: response.headers, data: response.data },
  };

  requestLog.push(entry);
  if (requestLog.length > MAX_LOG_ENTRIES) {
    requestLog.splice(0, requestLog.length - MAX_LOG_ENTRIES);
  }

  // Broadcast to connected DevTools panels
  for (const port of devtoolsPorts) {
    try {
      port.postMessage({ type: 'API_LOG_ENTRY', entry });
    } catch {
      devtoolsPorts.delete(port);
    }
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * Central message dispatcher. Every message must have a `type` field
 * matching one of the MESSAGE_TYPES values.
 */
async function handleMessage(message, sender) {
  const { type, payload } = message;

  switch (type) {
    // -- Token management ---------------------------------------------------
    case MESSAGE_TYPES.SET_TOKEN: {
      const { orgUrl, token, orgId, orgName, apiVersion } = payload;
      await storeToken(orgUrl, token);

      // Update active environment
      activeEnv = { url: orgUrl, orgId: orgId || '', orgName: orgName || '', apiVersion: apiVersion || API_VERSION_FALLBACK };
      await chrome.storage.session.set({ activeEnv });

      return { success: true };
    }

    case MESSAGE_TYPES.GET_TOKEN: {
      const orgUrl = payload?.orgUrl || activeEnv?.url;
      if (!orgUrl) return { success: false, error: 'No environment URL available' };
      const token = await getToken(orgUrl);
      return token ? { success: true, token } : { success: false, error: 'No token available' };
    }

    // -- Environment info ---------------------------------------------------
    case MESSAGE_TYPES.GET_ENV: {
      if (activeEnv) return { success: true, env: activeEnv };

      // Try to restore from session storage
      const stored = await chrome.storage.session.get('activeEnv');
      if (stored.activeEnv) {
        activeEnv = stored.activeEnv;
        return { success: true, env: activeEnv };
      }

      return { success: false, error: 'No active environment' };
    }

    // -- API proxy ----------------------------------------------------------
    case MESSAGE_TYPES.API_REQUEST: {
      try {
        const result = await proxyApiRequest(payload);
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // -- Metadata cache -----------------------------------------------------
    case MESSAGE_TYPES.GET_METADATA_CACHE: {
      const env = activeEnv;
      if (!env) return { success: false, error: 'No active environment' };
      const value = await getMetadataCache(env, payload.key);
      return { success: true, value };
    }

    case MESSAGE_TYPES.SET_METADATA_CACHE: {
      const env = activeEnv;
      if (!env) return { success: false, error: 'No active environment' };
      await setMetadataCache(env, payload.key, payload.value, payload.ttl);
      return { success: true };
    }

    case MESSAGE_TYPES.CLEAR_CACHE: {
      const env = activeEnv;
      if (!env) return { success: false, error: 'No active environment' };
      await clearMetadataCache(env);
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown message type: ${type}` };
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

// One-time message handler (content scripts, popup, side panel)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // keep the message channel open for async response
});

// Long-lived connections (DevTools panels)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'devtools-api-log') {
    devtoolsPorts.add(port);

    // Send existing log entries to newly connected panel
    port.postMessage({ type: 'API_LOG_INIT', entries: requestLog });

    port.onDisconnect.addListener(() => {
      devtoolsPorts.delete(port);
    });
  }
});

// Open the side panel when the extension action icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    // If side panel fails (e.g. popup is configured), that's fine --
    // the popup will open instead.
  }
});

// Detect when a Dynamics 365 tab becomes active so we can request a fresh
// token from its content script.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && tab.url.includes('.dynamics.com')) {
      chrome.tabs.sendMessage(tabId, { type: 'REQUEST_TOKEN_REFRESH' }).catch(() => {
        // Content script may not be ready yet -- that's okay.
      });
    }
  } catch {
    // Tab may have been closed between event and handler.
  }
});

// When a Dynamics 365 tab finishes loading, ask content script for env info.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('.dynamics.com')) {
    chrome.tabs.sendMessage(tabId, { type: 'REQUEST_TOKEN_REFRESH' }).catch(() => {});
  }
});

// After extension install or reload, re-inject content scripts into any
// already-open Dynamics 365 tabs so they don't need a manual page refresh.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.dynamics.com/*' });
    for (const tab of tabs) {
      if (tab.status !== 'complete' || tab.discarded) continue;
      try {
        await injectContentScripts(tab.id);
      } catch { /* some tabs may not be injectable */ }
    }
  } catch { /* ignore */ }
});

// Service worker initialized
