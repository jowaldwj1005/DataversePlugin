/**
 * Dataverse Toolkit - Popup Script
 *
 * Handles the extension popup UI: connection status, quick actions
 * (WhoAmI, clear cache, theme toggle), and side panel launch.
 *
 * @module popup
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY_THEME = 'dvt-theme';
const STORAGE_KEY_SETTINGS = 'dvt-settings';

const MESSAGE_TYPES = Object.freeze({
  API_REQUEST: 'API_REQUEST',
  GET_ENV: 'GET_ENV',
  CLEAR_CACHE: 'CLEAR_CACHE',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const envInfo = document.getElementById('env-info');
const envName = document.getElementById('env-name');
const envUrl = document.getElementById('env-url');
const notConnected = document.getElementById('not-connected');
const btnOpenPanel = document.getElementById('btn-open-panel');
const btnWhoAmI = document.getElementById('btn-whoami');
const btnClearCache = document.getElementById('btn-clear-cache');
const btnTheme = document.getElementById('btn-theme');
const whoamiResult = document.getElementById('whoami-result');
const versionLabel = document.getElementById('version-label');

// ---------------------------------------------------------------------------
// Theme management
// ---------------------------------------------------------------------------

async function loadTheme() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
    const settings = result[STORAGE_KEY_SETTINGS];
    if (settings?.theme) {
      document.body.className = `theme-${settings.theme}`;
      document.documentElement.setAttribute('data-theme', settings.theme);
    }
  } catch { /* ignore */ }
}

async function toggleTheme() {
  const order = ['dark', 'light', 'high-contrast'];
  let current = 'dark';

  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
    const settings = result[STORAGE_KEY_SETTINGS] || {};
    current = settings.theme || 'dark';
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length];
    settings.theme = next;
    await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });

    document.body.className = `theme-${next}`;
    document.documentElement.setAttribute('data-theme', next);
  } catch {
    // Ignore
  }
}

// ---------------------------------------------------------------------------
// Connection check
// ---------------------------------------------------------------------------

async function checkConnection(retries = 3) {
  try {
    const response = await sendMessage(MESSAGE_TYPES.GET_ENV);

    if (response.success && response.env?.url) {
      setConnected(response.env);
      return;
    }
  } catch { /* ignore */ }

  // The content script may not have sent env data yet — retry a few times
  if (retries > 0) {
    setTimeout(() => checkConnection(retries - 1), 1500);
  } else {
    setDisconnected();
  }
}

function setConnected(env) {
  statusIndicator.className = 'dvt-popup-status-dot connected';
  statusText.textContent = 'Connected';

  envInfo.style.display = 'block';
  envName.textContent = env.orgName || 'Dataverse Environment';
  envUrl.textContent = env.url;

  notConnected.style.display = 'none';

  btnWhoAmI.disabled = false;
  btnClearCache.disabled = false;
}

function setDisconnected() {
  statusIndicator.className = 'dvt-popup-status-dot disconnected';
  statusText.textContent = 'Not connected';

  envInfo.style.display = 'none';
  notConnected.style.display = 'block';

  btnWhoAmI.disabled = true;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function openSidePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
    window.close();
  } catch (err) {
    console.error('Failed to open side panel:', err);
    // Fallback: try to open in a new tab
    chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html') });
    window.close();
  }
}

async function performWhoAmI() {
  whoamiResult.style.display = 'block';
  whoamiResult.textContent = 'Loading...';

  try {
    const response = await sendMessage(MESSAGE_TYPES.API_REQUEST, {
      method: 'GET',
      url: 'WhoAmI()',
    });

    if (response.success && response.ok) {
      const data = response.data;
      whoamiResult.innerHTML = [
        `<span class="label">User ID:</span> <span class="value">${escapeHtml(data.UserId)}</span>`,
        `<span class="label">Business Unit ID:</span> <span class="value">${escapeHtml(data.BusinessUnitId)}</span>`,
        `<span class="label">Organization ID:</span> <span class="value">${escapeHtml(data.OrganizationId)}</span>`,
      ].join('\n');
    } else {
      whoamiResult.textContent = `Error: ${response.error || 'Unknown error'}`;
    }
  } catch (err) {
    whoamiResult.textContent = `Error: ${err.message}`;
  }
}

async function clearCache() {
  try {
    await sendMessage(MESSAGE_TYPES.CLEAR_CACHE);
    btnClearCache.textContent = 'Cleared!';
    setTimeout(() => { btnClearCache.textContent = 'Clear Cache'; }, 1500);
  } catch (err) {
    btnClearCache.textContent = 'Failed';
    setTimeout(() => { btnClearCache.textContent = 'Clear Cache'; }, 1500);
  }
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

function loadVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    if (versionLabel && manifest.version) {
      versionLabel.textContent = `v${manifest.version}`;
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

btnOpenPanel?.addEventListener('click', openSidePanel);
btnWhoAmI?.addEventListener('click', performWhoAmI);
btnClearCache?.addEventListener('click', clearCache);
btnTheme?.addEventListener('click', toggleTheme);

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

loadTheme();
loadVersion();
checkConnection();
