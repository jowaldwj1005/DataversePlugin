/**
 * Dataverse Toolkit - Page Context Extractor
 *
 * This script runs in the MAIN world (page context) via the manifest,
 * so it has direct access to Xrm and other page globals.
 * It communicates with the content script (ISOLATED world) via window.postMessage.
 *
 * This approach avoids CSP issues with inline <script> injection.
 */

const SOURCE = 'dataverse-toolkit-page';

function extract() {
  try {
    let clientUrl = '';
    let orgName = '';
    let orgId = '';
    let apiVersion = 'v9.2';

    // Try the modern API first, then the legacy one
    const ctx =
      (typeof Xrm !== 'undefined' && Xrm?.Utility?.getGlobalContext?.()) ||
      (typeof GetGlobalContext === 'function' && GetGlobalContext());

    if (ctx) {
      clientUrl = ctx.getClientUrl?.() || '';
      orgName = ctx.organizationSettings?.uniqueName || ctx.getOrgUniqueName?.() || '';
      orgId = ctx.organizationSettings?.organizationId || '';
      const version = ctx.getVersion?.() || '';

      if (version) {
        const parts = version.split('.');
        if (parts.length >= 2) {
          apiVersion = `v${parts[0]}.${parts[1]}`;
        }
      }
    }

    // Fallback: derive environment info from the page URL if Xrm is not available
    if (!clientUrl) {
      const origin = window.location.origin; // e.g. https://orgXXX.crm.dynamics.com
      if (origin.includes('.dynamics.com')) {
        clientUrl = origin;
        // Extract org name from subdomain: "orgXXX.crm.dynamics.com" → "orgXXX"
        const hostParts = window.location.hostname.split('.');
        if (hostParts.length > 0) {
          orgName = hostParts[0];
        }
      }
    }

    if (!clientUrl) {
      window.postMessage(
        { source: SOURCE, type: 'EXTRACT_RESULT', success: false, error: 'Could not determine environment URL' },
        '*',
      );
      return;
    }

    window.postMessage(
      {
        source: SOURCE,
        type: 'EXTRACT_RESULT',
        success: true,
        data: {
          clientUrl,
          orgName,
          orgId,
          apiVersion,
          // We use cookie-based auth — API calls go through page context with session cookies
          token: '__COOKIE_AUTH__',
        },
      },
      '*',
    );
  } catch (err) {
    window.postMessage(
      { source: SOURCE, type: 'EXTRACT_RESULT', success: false, error: err.message },
      '*',
    );
  }
}

// Listen for refresh requests from the content script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (
    event.data?.source === 'dataverse-toolkit-content' &&
    event.data?.type === 'REQUEST_EXTRACT'
  ) {
    extract();
  }
});

// Initial extraction — retry a few times since Xrm may not be ready immediately
let retries = 0;
const MAX_RETRIES = 15;
const RETRY_DELAY = 2000;

function tryExtract() {
  extract();
  // The content script will handle retries via REQUEST_EXTRACT messages,
  // but we also do our own retries here for the initial load.
  retries++;
  if (retries < MAX_RETRIES) {
    setTimeout(() => {
      // Only retry if we haven't succeeded yet
      // (we can't easily know, so just retry — it's idempotent)
      tryExtract();
    }, RETRY_DELAY);
  }
}

tryExtract();

// ---------------------------------------------------------------------------
// API Request Proxy (page context has valid session cookies)
// ---------------------------------------------------------------------------

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'dataverse-toolkit-content') return;
  if (event.data?.type !== 'API_REQUEST') return;

  const { requestId, payload } = event.data;
  executeApiRequest(payload, requestId);
});

async function executeApiRequest(reqDef, requestId) {
  try {
    const headers = {
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      ...(reqDef.headers || {}),
    };

    if (['POST', 'PUT', 'PATCH'].includes(reqDef.method?.toUpperCase()) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }

    // Remove Authorization header — we rely on session cookies
    delete headers.Authorization;

    const fetchOptions = {
      method: reqDef.method || 'GET',
      headers,
      credentials: 'same-origin',
    };

    if (reqDef.body !== undefined && reqDef.body !== null) {
      fetchOptions.body = typeof reqDef.body === 'string' ? reqDef.body : JSON.stringify(reqDef.body);
    }

    const response = await fetch(reqDef.url, fetchOptions);
    const contentType = response.headers.get('Content-Type') || '';
    let data = null;

    if (response.status !== 204 && contentType.includes('application/json')) {
      data = await response.json();
    } else if (response.status !== 204) {
      data = await response.text();
    }

    const responseHeaders = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });

    window.postMessage({
      source: SOURCE,
      type: 'API_RESPONSE',
      requestId,
      result: {
        success: true,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data,
      },
    }, '*');
  } catch (err) {
    window.postMessage({
      source: SOURCE,
      type: 'API_RESPONSE',
      requestId,
      result: {
        success: false,
        error: err.message,
      },
    }, '*');
  }
}
