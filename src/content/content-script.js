/**
 * Dataverse Toolkit - Content Script (ISOLATED world)
 *
 * Runs on *.dynamics.com pages in the isolated world. Listens for messages
 * from the page-extractor.js (MAIN world) via window.postMessage and
 * relays environment info + auth status to the background service worker.
 *
 * The page-extractor.js is loaded as a separate content script with
 * "world": "MAIN" in the manifest, avoiding CSP issues with inline scripts.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MESSAGE_SOURCE = 'dataverse-toolkit-page';
const CONTENT_SOURCE = 'dataverse-toolkit-content';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let extractionTimerId = null;
let lastEnvData = null;

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

/**
 * Forward extracted environment data to the background service worker.
 */
function sendToBackground(data) {
  const { clientUrl, orgName, orgId, apiVersion, token } = data;

  if (!clientUrl) return;

  lastEnvData = data;

  // Guard against "Extension context invalidated" after extension reload
  if (!chrome.runtime?.id) return;

  chrome.runtime.sendMessage({
    type: 'SET_TOKEN',
    payload: {
      orgUrl: clientUrl,
      token: token || '__COOKIE_AUTH__',
      orgName,
      orgId,
      apiVersion,
    },
  }).catch((err) => {
    if (err.message?.includes('Extension context invalidated')) return; // stale script, ignore
  });
}

/**
 * Request a new extraction from the MAIN world page-extractor script.
 */
function requestExtraction() {
  window.postMessage({ source: CONTENT_SOURCE, type: 'REQUEST_EXTRACT' }, '*');
}

// Listen for results from the MAIN world page-extractor.js
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== MESSAGE_SOURCE) return;

  if (event.data.type === 'EXTRACT_RESULT') {
    if (event.data.success) {
      sendToBackground(event.data.data);
    }
  }
});

// Listen for refresh requests from the background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'REQUEST_TOKEN_REFRESH') {
    requestExtraction();
    sendResponse({ success: true });
  }
  // Also support API_REQUEST forwarding through the content script
  // to leverage page cookies for authentication
  if (message.type === 'PROXY_VIA_PAGE') {
    proxyRequestViaPage(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async
  }
  return false;
});

/**
 * Proxy an API request through the page context to use session cookies.
 * This is used when bearer token auth isn't available.
 */
function proxyRequestViaPage(reqDef) {
  return new Promise((resolve) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Listen for the response from page context
    function onResponse(event) {
      if (event.source !== window) return;
      if (event.data?.source !== MESSAGE_SOURCE) return;
      if (event.data?.type !== 'API_RESPONSE') return;
      if (event.data?.requestId !== requestId) return;

      window.removeEventListener('message', onResponse);
      resolve(event.data.result);
    }
    window.addEventListener('message', onResponse);

    // Send the request to page context
    window.postMessage({
      source: CONTENT_SOURCE,
      type: 'API_REQUEST',
      requestId,
      payload: reqDef,
    }, '*');

    // Timeout after 60 seconds
    setTimeout(() => {
      window.removeEventListener('message', onResponse);
      resolve({ success: false, error: 'Page proxy request timed out' });
    }, 60000);
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// Set up periodic re-extraction so we always have fresh env info
if (extractionTimerId) clearInterval(extractionTimerId);
extractionTimerId = setInterval(() => {
  requestExtraction();
}, TOKEN_REFRESH_INTERVAL_MS);

