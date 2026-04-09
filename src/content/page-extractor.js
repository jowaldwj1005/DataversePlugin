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

// ---------------------------------------------------------------------------
// Form Inspect (Xrm.Page operations for Form Tools)
// ---------------------------------------------------------------------------

/** @type {Map<string, boolean>} Original visibility state for revealHidden restore */
const _originalVisibility = new Map();
let _lastRecordId = null;

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'dataverse-toolkit-content') return;
  if (event.data?.type !== 'FORM_INSPECT') return;

  const { requestId, payload } = event.data;
  executeFormInspect(payload.action, payload.params || {}, requestId);
});

async function executeFormInspect(action, params, requestId) {
  try {
    const result = await handleFormAction(action, params);
    window.postMessage({
      source: SOURCE,
      type: 'FORM_INSPECT_RESPONSE',
      requestId,
      result: { success: true, data: result },
    }, '*');
  } catch (err) {
    window.postMessage({
      source: SOURCE,
      type: 'FORM_INSPECT_RESPONSE',
      requestId,
      result: { success: false, error: err.message },
    }, '*');
  }
}

function requireFormContext() {
  if (typeof Xrm === 'undefined') throw new Error('Xrm is not available. Navigate to a Dynamics 365 form.');
  if (!Xrm.Page?.data?.entity) throw new Error('No form is currently open.');
}

async function handleFormAction(action, params) {
  switch (action) {
    case 'getFormContext': {
      requireFormContext();
      const entity = Xrm.Page.data.entity;
      const recordId = entity.getId()?.replace(/[{}]/g, '').toLowerCase() || '';

      // Clear stale visibility map on record change
      if (_lastRecordId && _lastRecordId !== recordId) {
        _originalVisibility.clear();
      }
      _lastRecordId = recordId;

      const formItem = Xrm.Page.ui.formSelector?.getCurrentItem?.();

      const attributes = [];
      entity.attributes.forEach((attr) => {
        let value = attr.getValue();
        // Serialize lookup values for transport
        if (value && attr.getAttributeType() === 'lookup' && Array.isArray(value)) {
          value = value.map((v) => ({ id: v.id, name: v.name, entityType: v.entityType }));
        }
        attributes.push({
          name: attr.getName(),
          type: attr.getAttributeType(),
          value,
          isDirty: attr.getIsDirty(),
          requiredLevel: attr.getRequiredLevel(),
          submitMode: attr.getSubmitMode(),
        });
      });

      const controls = [];
      Xrm.Page.ui.controls.forEach((ctrl) => {
        controls.push({
          name: ctrl.getName(),
          visible: ctrl.getVisible(),
          disabled: typeof ctrl.getDisabled === 'function' ? ctrl.getDisabled() : false,
          label: typeof ctrl.getLabel === 'function' ? ctrl.getLabel() : ctrl.getName(),
          controlType: typeof ctrl.getControlType === 'function' ? ctrl.getControlType() : 'unknown',
        });
      });

      return {
        entityName: entity.getEntityName(),
        recordId,
        formName: formItem?.getLabel?.() || formItem?.getName?.() || '',
        formId: formItem?.getId?.()?.replace(/[{}]/g, '').toLowerCase() || '',
        attributes,
        controls,
      };
    }

    case 'getRecordData': {
      requireFormContext();
      const entity = Xrm.Page.data.entity;
      const attrs = {};
      entity.attributes.forEach((attr) => {
        let value = attr.getValue();
        if (value && attr.getAttributeType() === 'lookup' && Array.isArray(value)) {
          value = value.map((v) => ({ id: v.id, name: v.name, entityType: v.entityType }));
        }
        attrs[attr.getName()] = value;
      });
      return {
        entityName: entity.getEntityName(),
        recordId: entity.getId()?.replace(/[{}]/g, '').toLowerCase() || '',
        attributes: attrs,
      };
    }

    case 'revealHidden': {
      requireFormContext();
      let affectedCount = 0;
      if (params.reveal) {
        // Store original visibility and reveal all hidden controls
        Xrm.Page.ui.controls.forEach((ctrl) => {
          if (!ctrl.getVisible()) {
            if (!_originalVisibility.has(ctrl.getName())) {
              _originalVisibility.set(ctrl.getName(), false);
            }
            ctrl.setVisible(true);
            affectedCount++;
          }
        });
      } else {
        // Restore original visibility
        for (const [name, wasVisible] of _originalVisibility) {
          const ctrl = Xrm.Page.getControl(name);
          if (ctrl) {
            ctrl.setVisible(wasVisible);
            affectedCount++;
          }
        }
        _originalVisibility.clear();
      }
      return { affectedCount };
    }

    case 'highlightDirty': {
      requireFormContext();
      const STYLE_ID = 'dvt-dirty-highlight-style';
      const CLASS_NAME = 'dvt-dirty-field';
      let affectedCount = 0;

      if (params.enable) {
        // Inject highlight style if not present
        if (!document.getElementById(STYLE_ID)) {
          const style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = `.${CLASS_NAME} { outline: 2px solid #f0ad4e !important; outline-offset: -1px; }`;
          document.head.appendChild(style);
        }
        // Add class to dirty field containers
        Xrm.Page.data.entity.attributes.forEach((attr) => {
          if (attr.getIsDirty()) {
            const ctrl = Xrm.Page.getControl(attr.getName());
            if (ctrl) {
              const el = document.querySelector(`[data-id="${attr.getName()}"]`)
                      || document.querySelector(`[data-control-name="${attr.getName()}"]`);
              if (el) { el.classList.add(CLASS_NAME); affectedCount++; }
            }
          }
        });
      } else {
        // Remove all highlights
        document.querySelectorAll(`.${CLASS_NAME}`).forEach((el) => {
          el.classList.remove(CLASS_NAME);
          affectedCount++;
        });
        document.getElementById(STYLE_ID)?.remove();
      }
      return { affectedCount };
    }

    case 'toggleBadge': {
      const BADGE_ID = 'dvt-env-badge';
      if (params.show) {
        let badge = document.getElementById(BADGE_ID);
        if (!badge) {
          badge = document.createElement('div');
          badge.id = BADGE_ID;
          Object.assign(badge.style, {
            position: 'fixed', top: '0', right: '80px', zIndex: '999999',
            padding: '4px 16px', fontSize: '12px', fontWeight: '700',
            fontFamily: 'system-ui, sans-serif', letterSpacing: '1px',
            color: '#fff', borderRadius: '0 0 6px 6px', pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          });
          document.body.appendChild(badge);
        }
        badge.textContent = params.envType || 'ENV';
        badge.style.background = params.color || '#e74c3c';
      } else {
        document.getElementById(BADGE_ID)?.remove();
      }
      return { success: true };
    }

    default:
      throw new Error(`Unknown form inspect action: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// API Request Proxy (page context has valid session cookies)
// ---------------------------------------------------------------------------

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
