/**
 * Dataverse Toolkit - DevTools Panel
 *
 * Displays all Dataverse Web API requests made by the inspected page in
 * real-time. Supports filtering, searching, detail inspection, and export.
 *
 * Connects to the background service worker via a long-lived port to
 * receive API request log entries as they happen.
 *
 * @module devtools-panel
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Array<RequestEntry>} */
let entries = [];

/** @type {RequestEntry|null} */
let selectedEntry = null;

/** Active filters */
const filters = {
  method: '',
  status: '',
  search: '',
};

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const btnClear = document.getElementById('btn-clear');
const btnExport = document.getElementById('btn-export');
const filterMethod = document.getElementById('filter-method');
const filterStatus = document.getElementById('filter-status');
const filterSearch = document.getElementById('filter-search');
const requestList = document.getElementById('request-list');
const requestDetail = document.getElementById('request-detail');
const perfCount = document.getElementById('perf-count');
const perfAvg = document.getElementById('perf-avg');
const perfErrors = document.getElementById('perf-errors');

// ---------------------------------------------------------------------------
// Background connection
// ---------------------------------------------------------------------------

let port = null;

function connectToBackground() {
  try {
    port = chrome.runtime.connect({ name: 'devtools-api-log' });

    port.onMessage.addListener((message) => {
      if (message.type === 'API_LOG_INIT') {
        entries = message.entries || [];
        renderList();
        updatePerfSummary();
      } else if (message.type === 'API_LOG_ENTRY') {
        entries.push(message.entry);
        appendEntry(message.entry);
        updatePerfSummary();
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      // Try to reconnect after a delay
      setTimeout(connectToBackground, 2000);
    });
  } catch (err) {
    console.error('[Dataverse DevTools] Failed to connect:', err);
    setTimeout(connectToBackground, 3000);
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Shorten a Dataverse API URL for display.
 * "https://org.crm.dynamics.com/api/data/v9.2/accounts?$top=10" -> "accounts?$top=10"
 */
function shortenUrl(url) {
  if (!url) return '';
  const match = url.match(/\/api\/data\/v[\d.]+\/(.+)/);
  return match ? match[1] : url;
}

/**
 * Extract the entity set name from a URL.
 */
function extractEntity(url) {
  const short = shortenUrl(url);
  const match = short.match(/^(\w+)/);
  return match ? match[1] : '';
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

function formatSize(data) {
  if (data == null) return '-';
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  const bytes = new Blob([str]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusClass(status) {
  if (!status) return 'error';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400 && status < 500) return 'client-error';
  if (status >= 500) return 'server-error';
  return 'unknown';
}

function methodClass(method) {
  return (method || 'GET').toLowerCase();
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function matchesFilters(entry) {
  // Method filter
  if (filters.method && (entry.method || 'GET').toUpperCase() !== filters.method) {
    return false;
  }

  // Status filter
  if (filters.status) {
    const s = entry.status || 0;
    if (filters.status === 'success' && (s < 200 || s >= 300)) return false;
    if (filters.status === 'client-error' && (s < 400 || s >= 500)) return false;
    if (filters.status === 'server-error' && s < 500) return false;
  }

  // Search filter
  if (filters.search) {
    const term = filters.search.toLowerCase();
    const url = (entry.url || '').toLowerCase();
    const entity = extractEntity(entry.url).toLowerCase();
    if (!url.includes(term) && !entity.includes(term)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderList() {
  requestList.innerHTML = '';

  const filtered = entries.filter(matchesFilters);

  if (filtered.length === 0) {
    requestList.innerHTML = '<div class="dvt-devtools-empty">No matching requests.</div>';
    return;
  }

  for (const entry of filtered) {
    requestList.appendChild(createEntryRow(entry));
  }

  // Auto-scroll to bottom
  requestList.scrollTop = requestList.scrollHeight;
}

function appendEntry(entry) {
  if (!matchesFilters(entry)) return;

  // Remove empty state message if present
  const empty = requestList.querySelector('.dvt-devtools-empty');
  if (empty) empty.remove();

  requestList.appendChild(createEntryRow(entry));

  // Auto-scroll if near bottom
  const isNearBottom = requestList.scrollHeight - requestList.scrollTop - requestList.clientHeight < 60;
  if (isNearBottom) {
    requestList.scrollTop = requestList.scrollHeight;
  }
}

function createEntryRow(entry) {
  const row = document.createElement('div');
  row.className = `dvt-devtools-row ${selectedEntry?.id === entry.id ? 'selected' : ''}`;
  row.dataset.id = entry.id;

  const method = (entry.method || 'GET').toUpperCase();
  const short = shortenUrl(entry.url);
  const status = entry.status || 0;
  const duration = entry.duration || 0;
  const responseData = entry.response?.data;

  row.innerHTML = `
    <span class="dvt-devtools-method ${methodClass(method)}">${escapeHtml(method)}</span>
    <span class="dvt-devtools-url" title="${escapeHtml(entry.url)}">${escapeHtml(short)}</span>
    <span class="dvt-devtools-status ${statusClass(status)}">${status || 'ERR'}</span>
    <span class="dvt-devtools-duration">${formatDuration(duration)}</span>
    <span class="dvt-devtools-size">${formatSize(responseData)}</span>
    <span class="dvt-devtools-time">${formatTimestamp(entry.timestamp)}</span>
  `;

  row.addEventListener('click', () => {
    selectedEntry = entry;
    // Update selected state
    requestList.querySelectorAll('.dvt-devtools-row.selected').forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
    renderDetail(entry);
  });

  return row;
}

function renderDetail(entry) {
  if (!requestDetail) return;
  requestDetail.style.display = 'block';

  const method = (entry.method || 'GET').toUpperCase();
  const status = entry.status || 0;

  let requestBodyHtml = '';
  if (entry.request?.body) {
    const bodyStr = typeof entry.request.body === 'string'
      ? entry.request.body
      : JSON.stringify(entry.request.body, null, 2);
    requestBodyHtml = `
      <div class="dvt-devtools-detail-section">
        <h4>Request Body</h4>
        <pre class="dvt-devtools-code">${escapeHtml(bodyStr)}</pre>
      </div>
    `;
  }

  let responseBodyHtml = '';
  if (entry.response?.data != null) {
    const responseStr = typeof entry.response.data === 'string'
      ? entry.response.data
      : JSON.stringify(entry.response.data, null, 2);
    responseBodyHtml = `
      <div class="dvt-devtools-detail-section">
        <h4>Response Body</h4>
        <pre class="dvt-devtools-code">${escapeHtml(responseStr)}</pre>
      </div>
    `;
  }

  const requestHeaders = entry.request?.headers
    ? Object.entries(entry.request.headers).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join('\n')
    : 'No headers recorded';

  const responseHeaders = entry.response?.headers
    ? Object.entries(entry.response.headers).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join('\n')
    : 'No headers recorded';

  requestDetail.innerHTML = `
    <div class="dvt-devtools-detail-header">
      <div class="dvt-devtools-detail-title">
        <span class="dvt-devtools-method ${methodClass(method)}">${escapeHtml(method)}</span>
        <span class="dvt-devtools-status ${statusClass(status)}">${status}</span>
        <span class="dvt-devtools-duration">${formatDuration(entry.duration || 0)}</span>
      </div>
      <button class="dvt-devtools-btn" id="btn-close-detail" title="Close">Close</button>
    </div>

    <div class="dvt-devtools-detail-section">
      <h4>Full URL</h4>
      <pre class="dvt-devtools-code dvt-devtools-url-full">${escapeHtml(entry.url)}</pre>
    </div>

    <div class="dvt-devtools-detail-section">
      <h4>Request Headers</h4>
      <pre class="dvt-devtools-code">${requestHeaders}</pre>
    </div>

    ${requestBodyHtml}

    <div class="dvt-devtools-detail-section">
      <h4>Response Headers</h4>
      <pre class="dvt-devtools-code">${responseHeaders}</pre>
    </div>

    ${responseBodyHtml}
  `;

  requestDetail.querySelector('#btn-close-detail')?.addEventListener('click', () => {
    requestDetail.style.display = 'none';
    selectedEntry = null;
    requestList.querySelectorAll('.dvt-devtools-row.selected').forEach((r) => r.classList.remove('selected'));
  });
}

// ---------------------------------------------------------------------------
// Performance summary
// ---------------------------------------------------------------------------

function updatePerfSummary() {
  const total = entries.length;
  const errors = entries.filter((e) => !e.status || e.status >= 400).length;
  const totalDuration = entries.reduce((sum, e) => sum + (e.duration || 0), 0);
  const avgDuration = total > 0 ? totalDuration / total : 0;

  if (perfCount) perfCount.textContent = `${total} request${total !== 1 ? 's' : ''}`;
  if (perfAvg) perfAvg.textContent = `Avg: ${formatDuration(avgDuration)}`;
  if (perfErrors) {
    perfErrors.textContent = `${errors} error${errors !== 1 ? 's' : ''}`;
    perfErrors.className = errors > 0 ? 'dvt-devtools-perf-errors has-errors' : '';
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function exportLog() {
  const format = 'json'; // Could extend to HAR in the future

  const data = entries.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    method: e.method,
    url: e.url,
    status: e.status,
    duration: e.duration,
    request: e.request,
    response: e.response,
  }));

  let blob;
  let filename;

  if (format === 'json') {
    blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    filename = `dataverse-api-log-${Date.now()}.json`;
  } else {
    // HAR format
    const har = {
      log: {
        version: '1.2',
        creator: { name: 'Dataverse Toolkit', version: '1.0.0' },
        entries: data.map((e) => ({
          startedDateTime: new Date(e.timestamp).toISOString(),
          time: e.duration,
          request: {
            method: e.method || 'GET',
            url: e.url,
            headers: e.request?.headers
              ? Object.entries(e.request.headers).map(([name, value]) => ({ name, value: String(value) }))
              : [],
            postData: e.request?.body
              ? { mimeType: 'application/json', text: typeof e.request.body === 'string' ? e.request.body : JSON.stringify(e.request.body) }
              : undefined,
          },
          response: {
            status: e.status || 0,
            statusText: '',
            headers: e.response?.headers
              ? Object.entries(e.response.headers).map(([name, value]) => ({ name, value: String(value) }))
              : [],
            content: e.response?.data
              ? { mimeType: 'application/json', text: typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data) }
              : { mimeType: 'application/json', text: '' },
          },
          timings: { send: 0, wait: e.duration, receive: 0 },
        })),
      },
    };
    blob = new Blob([JSON.stringify(har, null, 2)], { type: 'application/json' });
    filename = `dataverse-api-log-${Date.now()}.har`;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

btnClear?.addEventListener('click', () => {
  entries = [];
  selectedEntry = null;
  requestList.innerHTML = '<div class="dvt-devtools-empty">Log cleared. Waiting for requests...</div>';
  requestDetail.style.display = 'none';
  updatePerfSummary();
});

btnExport?.addEventListener('click', exportLog);

filterMethod?.addEventListener('change', (e) => {
  filters.method = e.target.value;
  renderList();
});

filterStatus?.addEventListener('change', (e) => {
  filters.status = e.target.value;
  renderList();
});

let searchTimer;
filterSearch?.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filters.search = e.target.value;
    renderList();
  }, 200);
});

// Also intercept network requests directly via devtools API
if (chrome.devtools?.network) {
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    const url = request.request?.url || '';
    if (!url.includes('/api/data/')) return;

    request.getContent((body) => {
      let responseData;
      try {
        responseData = body ? JSON.parse(body) : null;
      } catch {
        responseData = body;
      }

      const entry = {
        id: `net-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        method: request.request?.method || 'GET',
        url: url,
        status: request.response?.status || 0,
        duration: Math.round(request.time || 0),
        request: {
          headers: request.request?.headers?.reduce((acc, h) => { acc[h.name] = h.value; return acc; }, {}) || {},
          body: request.request?.postData?.text || null,
        },
        response: {
          headers: request.response?.headers?.reduce((acc, h) => { acc[h.name] = h.value; return acc; }, {}) || {},
          data: responseData,
        },
      };

      // Avoid duplicates if the background also captured it
      const isDuplicate = entries.some(
        (e) => e.url === entry.url && Math.abs(e.timestamp - entry.timestamp) < 500 && e.method === entry.method
      );

      if (!isDuplicate) {
        entries.push(entry);
        appendEntry(entry);
        updatePerfSummary();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

connectToBackground();
updatePerfSummary();
