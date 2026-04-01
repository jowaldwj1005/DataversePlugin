/**
 * Dataverse Toolkit - Request Builder Module
 *
 * A powerful HTTP request builder designed specifically for Dataverse Web API.
 * Features URL building, header management, body editing, response viewing,
 * request history, and multi-language code generation.
 *
 * @module RequestBuilder
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_METHODS = Object.freeze(['GET', 'POST', 'PATCH', 'DELETE']);

const METHOD_COLORS = Object.freeze({
  GET: '#61affe',
  POST: '#49cc90',
  PATCH: '#fca130',
  DELETE: '#f93e3e',
});

const DEFAULT_HEADERS = Object.freeze({
  'OData-MaxVersion': '4.0',
  'OData-Version': '4.0',
  Accept: 'application/json',
  'Content-Type': 'application/json; charset=utf-8',
});

const COMMON_PREFER_OPTIONS = Object.freeze([
  'odata.include-annotations="*"',
  'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
  'odata.include-annotations="Microsoft.Dynamics.CRM.*"',
  'odata.maxpagesize=100',
  'return=representation',
]);

const COMMON_HEADERS = Object.freeze([
  { name: 'Prefer', description: 'OData preference headers' },
  { name: 'MSCRM.SuppressDuplicateDetection', description: 'Suppress duplicate detection (true/false)' },
  { name: 'If-Match', description: 'Optimistic concurrency - only update if ETag matches' },
  { name: 'If-None-Match', description: 'Only return if modified (use with GET)' },
  { name: 'CallerObjectId', description: 'Impersonate a user by Azure AD Object ID' },
  { name: 'MSCRMCallerID', description: 'Impersonate a user by Dataverse SystemUser ID' },
  { name: 'ConsistencyLevel', description: 'Eventually consistent queries (eventual)' },
  { name: 'Tag', description: 'Tag for telemetry / plug-in step filtering' },
]);

const MAX_HISTORY = 50;

const STATUS_CATEGORIES = Object.freeze({
  success: [200, 201, 204],
  redirect: [301, 302, 304],
  clientError: [400, 401, 403, 404, 409, 412, 429],
  serverError: [500, 501, 502, 503],
});

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Generate a unique ID.
 * @returns {string}
 */
function generateId() {
  return Math.random().toString(36).substring(2, 12);
}

/**
 * Debounce a function.
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Format JSON with indentation.
 * @param {*} obj
 * @returns {string}
 */
function prettyJson(obj) {
  try {
    if (typeof obj === 'string') {
      return JSON.stringify(JSON.parse(obj), null, 2);
    }
    return JSON.stringify(obj, null, 2);
  } catch {
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  }
}

/**
 * Apply syntax highlighting to JSON for display.
 * @param {string} json
 * @returns {string}
 */
function highlightJson(json) {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // String values
    .replace(/"([^"\\]*(\\.[^"\\]*)*)"(\s*:)?/g, (match, str, _esc, colon) => {
      if (colon) {
        return `"<span class="json-key">${str}</span>"${colon}`;
      }
      return `"<span class="json-string">${str}</span>"`;
    })
    // Numbers
    .replace(/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, '<span class="json-number">$1</span>')
    // Booleans and null
    .replace(/\b(true|false|null)\b/g, '<span class="json-bool">$1</span>');
}

/**
 * Get the status category colour.
 * @param {number} status
 * @returns {string}
 */
function statusColor(status) {
  if (status >= 200 && status < 300) return '#49cc90';
  if (status >= 300 && status < 400) return '#fca130';
  if (status >= 400 && status < 500) return '#f93e3e';
  if (status >= 500) return '#f93e3e';
  return '#888';
}

// ---------------------------------------------------------------------------
// Code Generators
// ---------------------------------------------------------------------------

/**
 * Generate JavaScript (fetch API) code.
 * @param {Object} req - { method, url, headers, body }
 * @returns {string}
 */
function generateJavaScript(req) {
  const lines = [];
  lines.push(`const response = await fetch("${req.url}", {`);
  lines.push(`  method: "${req.method}",`);
  lines.push('  headers: {');
  for (const [key, val] of Object.entries(req.headers || {})) {
    lines.push(`    "${key}": "${val}",`);
  }
  lines.push('  },');
  if (req.body && ['POST', 'PATCH', 'PUT'].includes(req.method)) {
    lines.push(`  body: JSON.stringify(${prettyJson(req.body).split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n')}),`);
  }
  lines.push('});');
  lines.push('');
  lines.push('if (!response.ok) {');
  lines.push('  const error = await response.json();');
  lines.push('  throw new Error(error.error?.message || response.statusText);');
  lines.push('}');
  lines.push('');
  if (req.method === 'DELETE') {
    lines.push('// 204 No Content on success');
  } else {
    lines.push('const data = await response.json();');
    lines.push('console.log(data);');
  }
  return lines.join('\n');
}

/**
 * Generate C# (HttpClient) code.
 * @param {Object} req
 * @returns {string}
 */
function generateCSharp(req) {
  const lines = [];
  lines.push('using var client = new HttpClient();');
  lines.push('');
  for (const [key, val] of Object.entries(req.headers || {})) {
    if (key === 'Content-Type') continue; // Set separately on content
    lines.push(`client.DefaultRequestHeaders.Add("${key}", "${val}");`);
  }
  lines.push('');

  if (['POST', 'PATCH', 'PUT'].includes(req.method) && req.body) {
    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    lines.push(`var content = new StringContent(@"${bodyStr.replace(/"/g, '""')}", Encoding.UTF8, "application/json");`);
    lines.push('');

    switch (req.method) {
      case 'POST':
        lines.push(`var response = await client.PostAsync("${req.url}", content);`);
        break;
      case 'PATCH':
        lines.push(`var request = new HttpRequestMessage(new HttpMethod("PATCH"), "${req.url}") { Content = content };`);
        lines.push('var response = await client.SendAsync(request);');
        break;
      case 'PUT':
        lines.push(`var response = await client.PutAsync("${req.url}", content);`);
        break;
    }
  } else if (req.method === 'DELETE') {
    lines.push(`var response = await client.DeleteAsync("${req.url}");`);
  } else {
    lines.push(`var response = await client.GetAsync("${req.url}");`);
  }

  lines.push('');
  lines.push('response.EnsureSuccessStatusCode();');
  lines.push('var json = await response.Content.ReadAsStringAsync();');
  lines.push('Console.WriteLine(json);');
  return lines.join('\n');
}

/**
 * Generate Power Automate HTTP action JSON.
 * @param {Object} req
 * @returns {string}
 */
function generatePowerAutomate(req) {
  // Strip everything up to and including /api/data/vX.X/ to get the entity-relative path
  let relativeUri = req.url
    .replace(/^https?:\/\/[^/]+/, '')           // strip origin
    .replace(/^\/api\/data\/v[\d.]+\//, '');     // strip /api/data/v9.2/
  // If still starts with api/data (no leading slash variant), strip that too
  relativeUri = relativeUri.replace(/^api\/data\/v[\d.]+\//, '');

  const action = {
    type: 'OpenApiConnection',
    inputs: {
      host: {
        connectionName: 'shared_webcontents',
        operationId: 'InvokeHttp',
        apiId: '/providers/Microsoft.PowerApps/apis/shared_webcontents',
      },
      parameters: {
        Uri: `api/data/v9.2/${relativeUri}`,
        Method: req.method,
        headers: req.headers || {},
      },
    },
  };
  if (req.body && ['POST', 'PATCH', 'PUT'].includes(req.method)) {
    try {
      action.inputs.parameters.Body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch { action.inputs.parameters.Body = req.body; }
  }

  return [
    '// HTTP with Microsoft Entra ID (preauthorized) connector',
    '// Connection setup: Base URL = your org URL (e.g. https://org.crm.dynamics.com)',
    '// Only the relative path goes in Uri — the base URL is stored in the connection.',
    '',
    JSON.stringify(action, null, 2),
  ].join('\n');
}

/**
 * Generate a curl command.
 * @param {Object} req
 * @returns {string}
 */
function generateCurl(req) {
  const lines = [`curl -X ${req.method} \\`];
  lines.push(`  "${req.url}" \\`);
  for (const [key, val] of Object.entries(req.headers || {})) {
    lines.push(`  -H "${key}: ${val}" \\`);
  }
  if (req.body && ['POST', 'PATCH', 'PUT'].includes(req.method)) {
    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    lines.push(`  -d '${bodyStr.replace(/'/g, "'\\''")}'`);
  } else {
    // Remove trailing backslash from last line
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, '');
  }
  return lines.join('\n');
}

/**
 * Generate Python (requests) code.
 * @param {Object} req
 * @returns {string}
 */
function generatePython(req) {
  const lines = [];
  lines.push('import requests');
  lines.push('import json');
  lines.push('');
  lines.push(`url = "${req.url}"`);
  lines.push('');
  lines.push('headers = {');
  for (const [key, val] of Object.entries(req.headers || {})) {
    lines.push(`    "${key}": "${val}",`);
  }
  lines.push('}');
  lines.push('');

  if (['POST', 'PATCH', 'PUT'].includes(req.method) && req.body) {
    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 4);
    lines.push(`payload = json.loads('''${bodyStr}''')`);
    lines.push('');
    lines.push(`response = requests.${req.method.toLowerCase()}(url, headers=headers, json=payload)`);
  } else {
    lines.push(`response = requests.${req.method.toLowerCase()}(url, headers=headers)`);
  }

  lines.push('');
  lines.push('response.raise_for_status()');
  lines.push('');
  lines.push('if response.status_code != 204:');
  lines.push('    data = response.json()');
  lines.push('    print(json.dumps(data, indent=2))');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// RequestBuilder Class
// ---------------------------------------------------------------------------

/**
 * HTTP request builder designed for Dataverse Web API with full URL building,
 * header management, body editing, response viewing, history, and code generation.
 *
 * @example
 * const builder = new RequestBuilder(containerEl, apiClient, metadataCache);
 * builder.render();
 */
export class RequestBuilder {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} apiClient - API client with request(method, url, options) and baseUrl
   * @param {Object} metadataCache - Metadata cache with getEntities(), getAttributes(entity)
   */
  constructor(container, apiClient, metadataCache) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {Object} */
    this.apiClient = apiClient;

    /** @type {Object} */
    this.metadataCache = metadataCache;

    /** @type {string} */
    this.method = 'GET';

    /** @type {string} */
    this.entitySetName = '';

    /** @type {string} */
    this.recordId = '';

    /** @type {Object} - OData query options */
    this.queryOptions = {
      select: [],
      filter: '',
      expand: [],
      orderby: [],
      top: '',
      count: false,
      custom: [],
    };

    /** @type {Object<string, string>} - Request headers */
    this.headers = { ...DEFAULT_HEADERS };

    /** @type {string} - Request body JSON string */
    this.body = '';

    /** @type {Object|null} - Last response */
    this.response = null;

    /** @type {number|null} - Response time in ms */
    this.responseTime = null;

    /** @type {boolean} - Show formatted values in response */
    this.showFormattedValues = true;

    /** @type {boolean} - Show raw vs pretty response */
    this.showPrettyResponse = true;

    /** @type {Array<Object>} - Request history */
    this._history = [];

    /** @type {Array<Object>} - Starred/favourite requests */
    this._favourites = [];

    /** @type {Array<Object>} - Cached entity metadata */
    this._entities = [];

    /** @type {Map<string, Array<Object>>} - Cached attributes per entity */
    this._attributeCache = new Map();

    /** @type {Function} */
    this._debouncedBuildUrl = debounce(() => this._updateUrlDisplay(), 150);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Render the complete request builder UI.
   */
  async render() {
    this.container.innerHTML = '';
    this.container.classList.add('request-builder');

    await this._loadHistory();
    await this._loadEntities();

    this._buildMethodAndUrl();
    this._buildQueryOptions();
    this._buildHeadersSection();
    this._buildBodySection();
    this._buildActionBar();
    this._buildResponseSection();
    this._buildHistorySection();
    this._buildCodeGenSection();
  }

  /**
   * Load a request definition.
   * @param {Object} req - { method, url, headers, body }
   */
  loadRequest(req) {
    if (req.method) this.method = req.method;
    if (req.headers) this.headers = { ...DEFAULT_HEADERS, ...req.headers };
    if (req.body) this.body = typeof req.body === 'string' ? req.body : prettyJson(req.body);
    if (req.url) this._parseUrl(req.url);
    this._refreshAll();
  }

  /**
   * Get the current request definition.
   * @returns {{ method: string, url: string, headers: Object, body: string|null }}
   */
  getRequest() {
    return {
      method: this.method,
      url: this._buildFullUrl(),
      headers: { ...this.headers },
      body: ['POST', 'PATCH', 'PUT'].includes(this.method) ? this.body : null,
    };
  }

  // -------------------------------------------------------------------------
  // UI Construction
  // -------------------------------------------------------------------------

  /** Build the method selector and URL display. */
  _buildMethodAndUrl() {
    const section = document.createElement('div');
    section.className = 'rb-url-section';

    // Method selector
    const methodRow = document.createElement('div');
    methodRow.className = 'rb-method-row';

    const methodSelect = document.createElement('select');
    methodSelect.className = 'rb-method-select';
    for (const m of HTTP_METHODS) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      opt.selected = m === this.method;
      opt.style.color = METHOD_COLORS[m];
      methodSelect.appendChild(opt);
    }
    methodSelect.addEventListener('change', () => {
      this.method = methodSelect.value;
      methodSelect.style.color = METHOD_COLORS[this.method];
      this._onMethodChanged();
    });
    methodSelect.style.color = METHOD_COLORS[this.method];
    this._methodSelect = methodSelect;

    // Base URL display
    const baseUrl = document.createElement('span');
    baseUrl.className = 'rb-base-url';
    baseUrl.textContent = (this.apiClient.baseUrl || '/api/data/v9.2') + '/';
    this._baseUrlDisplay = baseUrl;

    // Entity set autocomplete
    const entityInput = document.createElement('input');
    entityInput.type = 'text';
    entityInput.className = 'rb-input rb-entity-input';
    entityInput.placeholder = 'accounts';
    entityInput.value = this.entitySetName;
    this._entityInput = entityInput;

    const entityDropdown = document.createElement('div');
    entityDropdown.className = 'rb-autocomplete-list';
    entityDropdown.style.display = 'none';
    this._entityDropdown = entityDropdown;

    entityInput.addEventListener('input', () => {
      this.entitySetName = entityInput.value;
      this._showEntityAutocomplete(entityInput.value);
      this._debouncedBuildUrl();
    });
    entityInput.addEventListener('focus', () => this._showEntityAutocomplete(entityInput.value));
    entityInput.addEventListener('blur', () => {
      setTimeout(() => { entityDropdown.style.display = 'none'; }, 200);
    });

    // Record ID input (for single record operations)
    const idWrap = document.createElement('span');
    idWrap.className = 'rb-id-wrap';
    const idParen1 = document.createElement('span');
    idParen1.textContent = '(';
    idParen1.className = 'rb-id-paren';
    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.className = 'rb-input rb-id-input';
    idInput.placeholder = 'guid';
    idInput.value = this.recordId;
    idInput.addEventListener('input', () => {
      this.recordId = idInput.value;
      this._onMethodChanged();
    });
    this._idInput = idInput;
    const idParen2 = document.createElement('span');
    idParen2.textContent = ')';
    idParen2.className = 'rb-id-paren';
    idWrap.append(idParen1, idInput, idParen2);
    this._idWrap = idWrap;

    const entityWrap = document.createElement('div');
    entityWrap.className = 'rb-entity-wrap';
    entityWrap.append(entityInput, entityDropdown);

    methodRow.append(methodSelect, baseUrl, entityWrap, idWrap);
    section.appendChild(methodRow);

    // Full URL display (copyable)
    const urlDisplay = document.createElement('div');
    urlDisplay.className = 'rb-full-url';
    urlDisplay.title = 'Click to copy full URL';
    urlDisplay.addEventListener('click', () => {
      this._copyToClipboard(this._buildFullUrl());
      this._showNotification('URL copied to clipboard.', 'success');
    });
    this._urlDisplay = urlDisplay;
    section.appendChild(urlDisplay);

    this.container.appendChild(section);
    this._updateUrlDisplay();
    this._onMethodChanged();
  }

  /** Build the OData query options builder. */
  _buildQueryOptions() {
    const section = this._createCollapsible('Query Options', 'rb-query-section');

    // $select
    const selectRow = this._createOptionRow('$select');
    const selectInput = document.createElement('input');
    selectInput.type = 'text';
    selectInput.className = 'rb-input';
    selectInput.placeholder = 'name, accountnumber, revenue (comma-separated)';
    selectInput.value = this.queryOptions.select.join(', ');
    selectInput.addEventListener('input', () => {
      this.queryOptions.select = selectInput.value.split(',').map(s => s.trim()).filter(Boolean);
      this._debouncedBuildUrl();
    });
    selectRow.appendChild(selectInput);
    section.content.appendChild(selectRow);

    // $filter
    const filterRow = this._createOptionRow('$filter');
    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'rb-input';
    filterInput.placeholder = "name eq 'Contoso' and revenue gt 1000000";
    filterInput.value = this.queryOptions.filter;
    filterInput.addEventListener('input', () => {
      this.queryOptions.filter = filterInput.value;
      this._debouncedBuildUrl();
    });
    filterRow.appendChild(filterInput);
    section.content.appendChild(filterRow);

    // $expand
    const expandRow = this._createOptionRow('$expand');
    const expandInput = document.createElement('input');
    expandInput.type = 'text';
    expandInput.className = 'rb-input';
    expandInput.placeholder = 'primarycontactid($select=fullname,emailaddress1)';
    expandInput.value = this.queryOptions.expand.join(', ');
    expandInput.addEventListener('input', () => {
      this.queryOptions.expand = expandInput.value.split(',').map(s => s.trim()).filter(Boolean);
      this._debouncedBuildUrl();
    });
    expandRow.appendChild(expandInput);
    section.content.appendChild(expandRow);

    // $orderby
    const orderRow = this._createOptionRow('$orderby');
    const orderInput = document.createElement('input');
    orderInput.type = 'text';
    orderInput.className = 'rb-input';
    orderInput.placeholder = 'name asc, createdon desc';
    orderInput.value = this.queryOptions.orderby.join(', ');
    orderInput.addEventListener('input', () => {
      this.queryOptions.orderby = orderInput.value.split(',').map(s => s.trim()).filter(Boolean);
      this._debouncedBuildUrl();
    });
    orderRow.appendChild(orderInput);
    section.content.appendChild(orderRow);

    // $top
    const topRow = this._createOptionRow('$top');
    const topInput = document.createElement('input');
    topInput.type = 'number';
    topInput.className = 'rb-input rb-input-sm';
    topInput.min = '1';
    topInput.placeholder = '50';
    topInput.value = this.queryOptions.top;
    topInput.addEventListener('input', () => {
      this.queryOptions.top = topInput.value;
      this._debouncedBuildUrl();
    });
    topRow.appendChild(topInput);
    section.content.appendChild(topRow);

    // $count
    const countRow = this._createOptionRow('$count');
    const countCheck = document.createElement('input');
    countCheck.type = 'checkbox';
    countCheck.checked = this.queryOptions.count;
    countCheck.addEventListener('change', () => {
      this.queryOptions.count = countCheck.checked;
      this._debouncedBuildUrl();
    });
    countRow.appendChild(countCheck);
    section.content.appendChild(countRow);

    // Custom query parameters
    const customLabel = document.createElement('div');
    customLabel.className = 'rb-option-label';
    customLabel.textContent = 'Custom Parameters';
    section.content.appendChild(customLabel);

    this._customParamsContainer = document.createElement('div');
    this._customParamsContainer.className = 'rb-custom-params';
    section.content.appendChild(this._customParamsContainer);
    this._buildCustomParams();

    this._querySection = section.wrapper;
    this.container.appendChild(section.wrapper);
    this._filterInput = filterInput;
  }

  /** Build custom query parameter rows. */
  _buildCustomParams() {
    this._customParamsContainer.innerHTML = '';

    for (let i = 0; i < this.queryOptions.custom.length; i++) {
      const param = this.queryOptions.custom[i];
      const row = document.createElement('div');
      row.className = 'rb-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'rb-input rb-input-sm';
      keyInput.placeholder = 'Parameter';
      keyInput.value = param.key;
      keyInput.addEventListener('input', () => {
        param.key = keyInput.value;
        this._debouncedBuildUrl();
      });

      const valInput = document.createElement('input');
      valInput.type = 'text';
      valInput.className = 'rb-input';
      valInput.placeholder = 'Value';
      valInput.value = param.value;
      valInput.addEventListener('input', () => {
        param.value = valInput.value;
        this._debouncedBuildUrl();
      });

      const removeBtn = this._createButton('\u00d7', 'btn-danger btn-sm', () => {
        this.queryOptions.custom.splice(i, 1);
        this._buildCustomParams();
        this._debouncedBuildUrl();
      });

      row.append(keyInput, valInput, removeBtn);
      this._customParamsContainer.appendChild(row);
    }

    const addBtn = this._createButton('+ Add Parameter', 'btn-outline btn-sm', () => {
      this.queryOptions.custom.push({ key: '', value: '' });
      this._buildCustomParams();
    });
    this._customParamsContainer.appendChild(addBtn);
  }

  /** Build the headers section. */
  _buildHeadersSection() {
    const section = this._createCollapsible('Headers', 'rb-headers-section');

    this._headersContainer = document.createElement('div');
    this._headersContainer.className = 'rb-headers';
    section.content.appendChild(this._headersContainer);
    this._buildHeaderRows();

    // Quick-add common headers
    const commonDiv = document.createElement('div');
    commonDiv.className = 'rb-common-headers';
    const commonLabel = document.createElement('div');
    commonLabel.className = 'rb-option-label';
    commonLabel.textContent = 'Quick Add:';
    commonDiv.appendChild(commonLabel);

    // Prefer shortcuts
    const preferDiv = document.createElement('div');
    preferDiv.className = 'rb-prefer-options';
    for (const pref of COMMON_PREFER_OPTIONS) {
      const btn = this._createButton(`Prefer: ${pref}`, 'btn-outline btn-xs', () => {
        this.headers['Prefer'] = pref;
        this._buildHeaderRows();
        this._showNotification('Prefer header set.', 'success');
      });
      btn.title = `Set Prefer: ${pref}`;
      preferDiv.appendChild(btn);
    }
    commonDiv.appendChild(preferDiv);

    // Other common headers
    for (const ch of COMMON_HEADERS) {
      if (ch.name === 'Prefer') continue;
      const btn = this._createButton(ch.name, 'btn-outline btn-xs', () => {
        if (!this.headers[ch.name]) {
          this.headers[ch.name] = '';
          this._buildHeaderRows();
        }
      });
      btn.title = ch.description;
      commonDiv.appendChild(btn);
    }

    section.content.appendChild(commonDiv);
    this.container.appendChild(section.wrapper);
  }

  /** Build individual header key-value rows. */
  _buildHeaderRows() {
    this._headersContainer.innerHTML = '';

    const entries = Object.entries(this.headers);
    for (const [key, val] of entries) {
      const row = document.createElement('div');
      row.className = 'rb-row rb-header-row';

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'rb-input rb-input-sm';
      keyInput.value = key;
      keyInput.readOnly = Object.keys(DEFAULT_HEADERS).includes(key);
      if (keyInput.readOnly) keyInput.classList.add('rb-readonly');

      const valInput = document.createElement('input');
      valInput.type = 'text';
      valInput.className = 'rb-input';
      valInput.value = val;
      valInput.placeholder = 'Header value';

      valInput.addEventListener('input', () => {
        delete this.headers[key];
        this.headers[keyInput.value] = valInput.value;
      });
      keyInput.addEventListener('change', () => {
        const oldKey = key;
        const newKey = keyInput.value;
        if (newKey !== oldKey) {
          const val = this.headers[oldKey];
          delete this.headers[oldKey];
          this.headers[newKey] = val;
        }
      });

      const removeBtn = this._createButton('\u00d7', 'btn-danger btn-sm', () => {
        delete this.headers[key];
        this._buildHeaderRows();
      });

      row.append(keyInput, valInput, removeBtn);
      this._headersContainer.appendChild(row);
    }

    const addBtn = this._createButton('+ Add Header', 'btn-outline btn-sm', () => {
      this.headers[''] = '';
      this._buildHeaderRows();
    });
    this._headersContainer.appendChild(addBtn);
  }

  /** Build the request body section. */
  _buildBodySection() {
    const section = this._createCollapsible('Body', 'rb-body-section');
    this._bodySection = section;

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'rb-body-toolbar';

    const formatBtn = this._createButton('Format', 'btn-outline btn-sm', () => this._formatBody());
    const validateBtn = this._createButton('Validate', 'btn-outline btn-sm', () => this._validateBody());
    const genTemplateBtn = this._createButton('Generate Template', 'btn-outline btn-sm', () => this._generateBodyTemplate());
    genTemplateBtn.title = 'Auto-generate body from entity metadata';

    toolbar.append(formatBtn, validateBtn, genTemplateBtn);
    section.content.appendChild(toolbar);

    // JSON editor
    const editorWrap = document.createElement('div');
    editorWrap.className = 'rb-body-editor-wrap';

    const lineNumbers = document.createElement('div');
    lineNumbers.className = 'rb-line-numbers';
    this._bodyLineNumbers = lineNumbers;

    const textarea = document.createElement('textarea');
    textarea.className = 'rb-body-textarea';
    textarea.spellcheck = false;
    textarea.wrap = 'off';
    textarea.placeholder = '{\n  "name": "Sample Account",\n  "revenue": 1000000\n}';
    textarea.value = this.body;
    this._bodyTextarea = textarea;

    const highlight = document.createElement('pre');
    highlight.className = 'rb-body-highlight';
    this._bodyHighlight = highlight;

    textarea.addEventListener('scroll', () => {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
      lineNumbers.scrollTop = textarea.scrollTop;
    });

    textarea.addEventListener('input', () => {
      this.body = textarea.value;
      this._updateBodyLineNumbers();
      this._updateBodyHighlight();
    });

    // Tab key inserts spaces
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        this.body = textarea.value;
        this._updateBodyLineNumbers();
        this._updateBodyHighlight();
      }
    });

    // Ctrl+Enter to send
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this._sendRequest();
      }
    });

    editorWrap.append(lineNumbers, textarea, highlight);
    section.content.appendChild(editorWrap);

    this.container.appendChild(section.wrapper);
    this._updateBodyLineNumbers();
    this._updateBodyHighlight();
  }

  /** Build the action bar with Send button. */
  _buildActionBar() {
    const bar = document.createElement('div');
    bar.className = 'rb-action-bar';

    const sendBtn = this._createButton('Send Request', 'btn-primary', () => this._sendRequest());
    sendBtn.title = 'Send the request (Ctrl+Enter)';
    this._sendBtn = sendBtn;

    const cancelBtn = this._createButton('Cancel', 'btn-secondary', () => this._cancelRequest());
    cancelBtn.style.display = 'none';
    this._cancelBtn = cancelBtn;

    bar.append(sendBtn, cancelBtn);
    this.container.appendChild(bar);
  }

  /** Build the response viewer section. */
  _buildResponseSection() {
    const section = this._createCollapsible('Response', 'rb-response-section');
    section.wrapper.style.display = 'none';
    this._responseSection = section;

    // Status bar
    const statusBar = document.createElement('div');
    statusBar.className = 'rb-status-bar';
    this._statusBar = statusBar;
    section.content.appendChild(statusBar);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'rb-response-toolbar';

    const prettyToggle = this._createButton('Pretty', 'btn-outline btn-sm rb-active', () => {
      this.showPrettyResponse = true;
      prettyToggle.classList.add('rb-active');
      rawToggle.classList.remove('rb-active');
      this._renderResponseBody();
    });
    const rawToggle = this._createButton('Raw', 'btn-outline btn-sm', () => {
      this.showPrettyResponse = false;
      rawToggle.classList.add('rb-active');
      prettyToggle.classList.remove('rb-active');
      this._renderResponseBody();
    });
    const copyBtn = this._createButton('Copy Response', 'btn-outline btn-sm', () => {
      if (this.response?.data) {
        this._copyToClipboard(prettyJson(this.response.data));
        this._showNotification('Response copied.', 'success');
      }
    });

    toolbar.append(prettyToggle, rawToggle, copyBtn);
    section.content.appendChild(toolbar);

    // Response headers (collapsible)
    const headersDiv = document.createElement('div');
    headersDiv.className = 'rb-response-headers';
    const headersToggle = this._createButton('Response Headers', 'btn-outline btn-sm', () => {
      headersBody.style.display = headersBody.style.display === 'none' ? 'block' : 'none';
    });
    const headersBody = document.createElement('pre');
    headersBody.className = 'rb-response-headers-body';
    headersBody.style.display = 'none';
    this._responseHeadersBody = headersBody;
    headersDiv.append(headersToggle, headersBody);
    section.content.appendChild(headersDiv);

    // Response body
    const bodyDiv = document.createElement('pre');
    bodyDiv.className = 'rb-response-body';
    this._responseBody = bodyDiv;
    section.content.appendChild(bodyDiv);

    this.container.appendChild(section.wrapper);
  }

  /** Build the history section. */
  _buildHistorySection() {
    const section = this._createCollapsible('History', 'rb-history-section');

    // Search
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'rb-input';
    search.placeholder = 'Search history...';
    search.addEventListener('input', () => this._filterHistory(search.value));
    section.content.appendChild(search);

    // History list
    this._historyList = document.createElement('div');
    this._historyList.className = 'rb-history-list';
    section.content.appendChild(this._historyList);

    // Import/Export
    const importExportRow = document.createElement('div');
    importExportRow.className = 'rb-row';
    const exportBtn = this._createButton('Export Collection', 'btn-outline btn-sm', () => this._exportCollection());
    const importBtn = this._createButton('Import Collection', 'btn-outline btn-sm', () => this._importCollection());
    importExportRow.append(exportBtn, importBtn);
    section.content.appendChild(importExportRow);

    this.container.appendChild(section.wrapper);
    this._renderHistory();
  }

  /** Build the code generation section. */
  _buildCodeGenSection() {
    const section = this._createCollapsible('Code Generation', 'rb-codegen-section');

    const languages = [
      { name: 'JavaScript (fetch)', gen: generateJavaScript },
      { name: 'C# (HttpClient)', gen: generateCSharp },
      { name: 'Python (requests)', gen: generatePython },
      { name: 'curl', gen: generateCurl },
      { name: 'Power Automate', gen: generatePowerAutomate },
    ];

    // Language tabs
    const tabs = document.createElement('div');
    tabs.className = 'rb-codegen-tabs';

    const codeDisplay = document.createElement('pre');
    codeDisplay.className = 'rb-codegen-display';
    this._codeDisplay = codeDisplay;

    const copyCodeBtn = this._createButton('Copy Code', 'btn-outline btn-sm', () => {
      this._copyToClipboard(codeDisplay.textContent);
      this._showNotification('Code copied.', 'success');
    });

    let activeGenerator = languages[0].gen;

    for (const lang of languages) {
      const tab = this._createButton(lang.name, 'btn-outline btn-sm', () => {
        for (const t of tabs.children) t.classList.remove('rb-active');
        tab.classList.add('rb-active');
        activeGenerator = lang.gen;
        this._updateCodeGen(lang.gen);
      });
      tabs.appendChild(tab);
    }
    // Activate first tab
    if (tabs.firstChild) tabs.firstChild.classList.add('rb-active');

    section.content.append(tabs, copyCodeBtn, codeDisplay);
    this.container.appendChild(section.wrapper);

    this._activeCodeGenerator = activeGenerator;
    this._updateCodeGen(activeGenerator);
  }

  // -------------------------------------------------------------------------
  // Request Execution
  // -------------------------------------------------------------------------

  /** Send the current request. */
  async _sendRequest() {
    const req = this.getRequest();

    // Validate + parse body for mutations
    let parsedBody;
    if (req.body) {
      try {
        parsedBody = JSON.parse(req.body);
      } catch (err) {
        if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
          this._showNotification(`Invalid JSON body: ${err.message}`, 'error');
          return;
        }
        parsedBody = req.body; // non-mutation with non-JSON body — pass through as string
      }
    }

    this._sendBtn.disabled = true;
    this._sendBtn.textContent = 'Sending...';
    this._cancelBtn.style.display = '';

    try {
      const startTime = performance.now();
      const response = await this.apiClient.requestRaw(req.method, req.url, {
        headers: req.headers,
        body: parsedBody,
      });
      const endTime = performance.now();

      this.response = response;
      this.responseTime = Math.round(endTime - startTime);

      await this._addToHistory(req, response);
      this._renderResponse();
    } finally {
      this._sendBtn.disabled = false;
      this._sendBtn.textContent = 'Send Request';
      this._cancelBtn.style.display = 'none';
    }
  }

  /** Cancel the current request (placeholder - actual abort requires AbortController in apiClient). */
  _cancelRequest() {
    this._showNotification('Request cancellation requested.', 'info');
  }

  // -------------------------------------------------------------------------
  // Response Rendering
  // -------------------------------------------------------------------------

  /** Render the full response. */
  _renderResponse() {
    this._responseSection.wrapper.style.display = '';

    // Status bar
    const status = this.response?.status || 0;
    const statusText = this.response?.statusText || 'Unknown';
    this._statusBar.innerHTML = '';

    const badge = document.createElement('span');
    badge.className = 'rb-status-badge';
    badge.style.backgroundColor = statusColor(status);
    badge.textContent = `${status} ${statusText}`;
    this._statusBar.appendChild(badge);

    const time = document.createElement('span');
    time.className = 'rb-response-time';
    time.textContent = `${this.responseTime}ms`;
    this._statusBar.appendChild(time);

    // Response headers
    const headers = this.response?.headers || {};
    this._responseHeadersBody.textContent = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    // Response body
    this._renderResponseBody();
  }

  /** Render just the response body (for toggle between raw/pretty). */
  _renderResponseBody() {
    const data = this.response?.data;
    if (data == null) {
      this._responseBody.textContent = '(no content)';
      return;
    }

    if (this.showPrettyResponse) {
      const json = prettyJson(data);
      this._responseBody.innerHTML = highlightJson(json);
    } else {
      this._responseBody.textContent = typeof data === 'string' ? data : JSON.stringify(data);
    }

    // Make GUIDs clickable for navigation
    this._responseBody.querySelectorAll('.json-string').forEach(el => {
      const text = el.textContent;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
        el.classList.add('rb-clickable-guid');
        el.title = 'Click to look up this record';
        el.addEventListener('click', () => {
          this._showNotification(`GUID: ${text} - Use in a new request to look up.`, 'info');
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // History Management
  // -------------------------------------------------------------------------

  /** Load history from storage. */
  async _loadHistory() {
    try {
      const result = await chrome.storage.local.get(['rb_history', 'rb_favourites']);
      this._history = result.rb_history || [];
      this._favourites = result.rb_favourites || [];
    } catch {
      this._history = [];
      this._favourites = [];
    }
  }

  /**
   * Add a request to history.
   * @param {Object} req
   * @param {Object} response
   */
  async _addToHistory(req, response) {
    const entry = {
      id: generateId(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      status: response?.status || 0,
      timestamp: Date.now(),
      starred: false,
    };

    this._history.unshift(entry);
    if (this._history.length > MAX_HISTORY) {
      this._history = this._history.slice(0, MAX_HISTORY);
    }

    try {
      await chrome.storage.local.set({ rb_history: this._history });
    } catch { /* storage full */ }

    this._renderHistory();
  }

  /** Render the history list. */
  _renderHistory() {
    if (!this._historyList) return;
    this._historyList.innerHTML = '';

    const sorted = [...this._favourites.map(f => ({ ...f, starred: true })), ...this._history.filter(h => !this._favourites.find(f => f.id === h.id))];

    for (const entry of sorted) {
      const item = document.createElement('div');
      item.className = 'rb-history-item';
      item.dataset.method = entry.method;
      item.dataset.url = entry.url;

      const methodBadge = document.createElement('span');
      methodBadge.className = 'rb-method-badge';
      methodBadge.style.backgroundColor = METHOD_COLORS[entry.method] || '#888';
      methodBadge.textContent = entry.method;

      const urlText = document.createElement('span');
      urlText.className = 'rb-history-url';
      urlText.textContent = entry.url;
      urlText.title = entry.url;

      const statusBadge = document.createElement('span');
      statusBadge.className = 'rb-status-badge-sm';
      statusBadge.style.color = statusColor(entry.status);
      statusBadge.textContent = entry.status || '';

      const time = document.createElement('span');
      time.className = 'rb-history-time';
      time.textContent = new Date(entry.timestamp).toLocaleString();

      const starBtn = this._createButton(entry.starred ? '\u2605' : '\u2606', 'btn-outline btn-xs', (e) => {
        e.stopPropagation();
        this._toggleStar(entry);
      });
      starBtn.title = entry.starred ? 'Remove from favourites' : 'Add to favourites';

      item.append(methodBadge, urlText, statusBadge, time, starBtn);
      item.addEventListener('click', () => this.loadRequest(entry));

      this._historyList.appendChild(item);
    }

    if (sorted.length === 0) {
      this._historyList.innerHTML = '<div class="rb-empty">No request history yet.</div>';
    }
  }

  /**
   * Filter history by search query.
   * @param {string} query
   */
  _filterHistory(query) {
    if (!this._historyList) return;
    const q = query.toLowerCase();
    for (const item of this._historyList.children) {
      const url = item.dataset.url || '';
      const method = item.dataset.method || '';
      item.style.display = (url.toLowerCase().includes(q) || method.toLowerCase().includes(q)) ? '' : 'none';
    }
  }

  /**
   * Toggle star status on a history entry.
   * @param {Object} entry
   */
  async _toggleStar(entry) {
    const idx = this._favourites.findIndex(f => f.id === entry.id);
    if (idx >= 0) {
      this._favourites.splice(idx, 1);
    } else {
      this._favourites.push({ ...entry, starred: true });
    }
    try {
      await chrome.storage.local.set({ rb_favourites: this._favourites });
    } catch { /* ignore */ }
    this._renderHistory();
  }

  /** Export request collection as JSON. */
  _exportCollection() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      history: this._history,
      favourites: this._favourites,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dataverse-requests.json';
    a.click();
    URL.revokeObjectURL(url);
    this._showNotification('Collection exported.', 'success');
  }

  /** Import request collection from JSON file. */
  _importCollection() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.history) {
          this._history = [...data.history, ...this._history].slice(0, MAX_HISTORY);
          await chrome.storage.local.set({ rb_history: this._history });
        }
        if (data.favourites) {
          this._favourites = [...data.favourites, ...this._favourites];
          await chrome.storage.local.set({ rb_favourites: this._favourites });
        }
        this._renderHistory();
        this._showNotification(`Imported ${(data.history?.length || 0)} requests.`, 'success');
      } catch (err) {
        this._showNotification(`Import failed: ${err.message}`, 'error');
      }
    });
    input.click();
  }

  // -------------------------------------------------------------------------
  // URL Building
  // -------------------------------------------------------------------------

  /**
   * Build the full request URL from components.
   * @returns {string}
   */
  _buildFullUrl() {
    const base = this.apiClient.baseUrl || '/api/data/v9.2';
    let url = `${base}/${this.entitySetName}`;

    // Add record ID for single-record operations
    if (this.recordId && ['GET', 'PATCH', 'DELETE'].includes(this.method)) {
      url += `(${this.recordId})`;
    }

    // Build query string for GET requests
    if (this.method === 'GET') {
      const params = [];
      if (this.queryOptions.select.length > 0) {
        params.push(`$select=${this.queryOptions.select.join(',')}`);
      }
      if (this.queryOptions.filter) {
        params.push(`$filter=${this.queryOptions.filter}`);
      }
      if (this.queryOptions.expand.length > 0) {
        params.push(`$expand=${this.queryOptions.expand.join(',')}`);
      }
      if (this.queryOptions.orderby.length > 0) {
        params.push(`$orderby=${this.queryOptions.orderby.join(',')}`);
      }
      if (this.queryOptions.top) {
        params.push(`$top=${this.queryOptions.top}`);
      }
      if (this.queryOptions.count) {
        params.push('$count=true');
      }
      for (const cp of this.queryOptions.custom) {
        if (cp.key) params.push(`${cp.key}=${cp.value}`);
      }
      if (params.length > 0) {
        url += '?' + params.join('&');
      }
    }

    return url;
  }

  /** Update the URL display. */
  _updateUrlDisplay() {
    if (!this._urlDisplay) return;
    const url = this._buildFullUrl();
    this._urlDisplay.textContent = url;
    this._urlDisplay.title = `Click to copy: ${url}`;
  }

  /**
   * Parse a URL and populate the builder fields.
   * @param {string} url
   */
  _parseUrl(url) {
    try {
      // Extract entity set and record ID from path
      const pathMatch = url.match(/\/api\/data\/v[\d.]+\/(\w+)(?:\(([^)]+)\))?/);
      if (pathMatch) {
        this.entitySetName = pathMatch[1];
        this.recordId = pathMatch[2] || '';
      }

      // Parse query parameters
      const qIndex = url.indexOf('?');
      if (qIndex >= 0) {
        const params = new URLSearchParams(url.substring(qIndex));
        if (params.has('$select')) this.queryOptions.select = params.get('$select').split(',').map(s => s.trim());
        if (params.has('$filter')) this.queryOptions.filter = params.get('$filter');
        if (params.has('$expand')) this.queryOptions.expand = params.get('$expand').split(',').map(s => s.trim());
        if (params.has('$orderby')) this.queryOptions.orderby = params.get('$orderby').split(',').map(s => s.trim());
        if (params.has('$top')) this.queryOptions.top = params.get('$top');
        if (params.has('$count')) this.queryOptions.count = params.get('$count') === 'true';
      }
    } catch {
      // If parsing fails, just use the URL as-is
    }
  }

  // -------------------------------------------------------------------------
  // Method / Entity change handlers
  // -------------------------------------------------------------------------

  /** Handle method selection change. */
  _onMethodChanged() {
    const isPost = this.method === 'POST';
    const needsBody = ['POST', 'PATCH', 'PUT'].includes(this.method);
    const hasId = this.recordId?.trim().length > 0;

    // ID field: POST creates new records so ID is irrelevant; PATCH/DELETE require it
    if (this._idWrap) {
      this._idWrap.style.display = isPost ? 'none' : '';
      this._idWrap.style.opacity = ['PATCH', 'DELETE'].includes(this.method) ? '1' : '0.6';
    }

    // Body section: only for mutations
    if (this._bodySection) {
      this._bodySection.wrapper.style.display = needsBody ? '' : 'none';
    }

    // Query Options: hide entirely for POST (creating a record has no query params)
    // Also disable $filter when a record ID is entered (single record — filter makes no sense)
    if (this._querySection) {
      this._querySection.style.display = isPost ? 'none' : '';
    }
    if (this._filterInput) {
      this._filterInput.disabled = hasId;
      this._filterInput.title = hasId ? '$filter is not applicable when a record ID is specified' : '';
      if (hasId) {
        this._filterInput.style.opacity = '0.4';
      } else {
        this._filterInput.style.opacity = '';
      }
    }

    this._debouncedBuildUrl();
  }

  /**
   * Show entity autocomplete dropdown.
   * @param {string} filter
   */
  _showEntityAutocomplete(filter) {
    if (!this._entityDropdown) return;
    this._entityDropdown.innerHTML = '';
    const q = filter.toLowerCase();

    const matches = this._entities
      .filter(e => {
        const setName = e.entitySetName || e.EntitySetName || e.logicalCollectionName || '';
        const logicalName = e.logicalName || e.LogicalName || '';
        const displayName = e.displayName || e.DisplayName?.UserLocalizedLabel?.Label || '';
        return setName.toLowerCase().includes(q) || logicalName.toLowerCase().includes(q) || displayName.toLowerCase().includes(q);
      })
      .slice(0, 50);

    for (const e of matches) {
      const setName = e.entitySetName || e.EntitySetName || e.logicalCollectionName || `${e.logicalName || e.LogicalName}s`;
      const displayName = e.displayName || e.DisplayName?.UserLocalizedLabel?.Label || e.logicalName || e.LogicalName;
      const item = document.createElement('div');
      item.className = 'rb-autocomplete-item';
      item.textContent = `${setName} (${displayName})`;
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.entitySetName = setName;
        this._entityInput.value = setName;
        this._entityDropdown.style.display = 'none';
        this._debouncedBuildUrl();
        this._loadEntityAttributes(e.logicalName || e.LogicalName);
      });
      this._entityDropdown.appendChild(item);
    }

    this._entityDropdown.style.display = matches.length > 0 ? 'block' : 'none';
  }

  // -------------------------------------------------------------------------
  // Body Helpers
  // -------------------------------------------------------------------------

  /** Format the body JSON. */
  _formatBody() {
    try {
      this.body = prettyJson(this.body);
      this._bodyTextarea.value = this.body;
      this._updateBodyLineNumbers();
      this._updateBodyHighlight();
    } catch (err) {
      this._showNotification(`Cannot format: ${err.message}`, 'error');
    }
  }

  /** Validate the body JSON. */
  _validateBody() {
    try {
      JSON.parse(this.body || '{}');
      this._showNotification('JSON is valid.', 'success');
    } catch (err) {
      this._showNotification(`Invalid JSON: ${err.message}`, 'error');
    }
  }

  /** Generate a body template from entity metadata. */
  async _generateBodyTemplate() {
    // Determine which entity we're targeting
    const entitySetName = this.entitySetName;
    if (!entitySetName) {
      this._showNotification('Select an entity first.', 'warning');
      return;
    }

    // Find the logical name from the entity set name
    const entityMeta = this._entities.find(e => {
      const setName = e.entitySetName || e.EntitySetName || e.logicalCollectionName || '';
      return setName === entitySetName;
    });
    const logicalName = entityMeta?.logicalName || entityMeta?.LogicalName || entitySetName;

    let attrs = this._attributeCache.get(logicalName);
    if (!attrs) {
      try {
        attrs = await this.metadataCache.getAttributes(logicalName) || [];
        this._attributeCache.set(logicalName, attrs);
      } catch {
        attrs = [];
      }
    }

    if (attrs.length === 0) {
      this._showNotification('No attributes found for this entity.', 'warning');
      return;
    }

    // Build template with comments showing types
    const template = {};
    for (const attr of attrs) {
      const name = attr.logicalName || attr.LogicalName || '';
      const type = attr.attributeType || attr.AttributeType || 'String';
      const isWritable = attr.isValidForCreate !== false && attr.IsValidForCreate !== false;

      if (!isWritable || name.endsWith('_base') || name.startsWith('versionnumber')) continue;

      switch (type) {
        case 'String':
        case 'Memo':
          template[name] = `"" /* ${type} */`;
          break;
        case 'Integer':
        case 'BigInt':
          template[name] = `0 /* ${type} */`;
          break;
        case 'Double':
        case 'Decimal':
        case 'Money':
          template[name] = `0.0 /* ${type} */`;
          break;
        case 'Boolean':
          template[name] = `false /* ${type} */`;
          break;
        case 'DateTime':
          template[name] = `"2025-01-01T00:00:00Z" /* ${type} */`;
          break;
        case 'Picklist':
        case 'State':
        case 'Status':
          template[name] = `0 /* ${type} - option value */`;
          break;
        case 'Lookup':
        case 'Customer':
        case 'Owner':
          template[`${name}@odata.bind`] = `"/<entityset>(<guid>)" /* ${type} */`;
          break;
        case 'Uniqueidentifier':
          // Primary key - skip for create
          break;
        default:
          template[name] = `null /* ${type} */`;
      }
    }

    // Convert to JSON string but keep "comments" in values
    let json = '{\n';
    const entries = Object.entries(template);
    for (let i = 0; i < entries.length; i++) {
      const [key, val] = entries[i];
      const comma = i < entries.length - 1 ? ',' : '';
      // Values are already formatted strings
      json += `  "${key}": ${val}${comma}\n`;
    }
    json += '}';

    this.body = json;
    this._bodyTextarea.value = json;
    this._updateBodyLineNumbers();
    this._updateBodyHighlight();
    this._showNotification(`Template generated with ${entries.length} fields.`, 'success');
  }

  /** Update body editor line numbers. */
  _updateBodyLineNumbers() {
    if (!this._bodyLineNumbers || !this._bodyTextarea) return;
    const lines = this._bodyTextarea.value.split('\n');
    this._bodyLineNumbers.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
  }

  /** Update body editor syntax highlight. */
  _updateBodyHighlight() {
    if (!this._bodyHighlight || !this._bodyTextarea) return;
    this._bodyHighlight.innerHTML = highlightJson(
      this._bodyTextarea.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    );
  }

  // -------------------------------------------------------------------------
  // Code Generation
  // -------------------------------------------------------------------------

  /**
   * Update the code generation display.
   * @param {Function} generator
   */
  _updateCodeGen(generator) {
    if (!this._codeDisplay) return;
    this._activeCodeGenerator = generator;
    try {
      const req = this.getRequest();
      this._codeDisplay.textContent = generator(req);
    } catch (err) {
      this._codeDisplay.textContent = `// Error generating code: ${err.message}`;
    }
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  /** Load entity list from metadata cache. */
  async _loadEntities() {
    try {
      this._entities = await this.metadataCache.getEntities() || [];
    } catch {
      this._entities = [];
    }
  }

  /**
   * Load attributes for a specific entity.
   * @param {string} logicalName
   */
  async _loadEntityAttributes(logicalName) {
    if (this._attributeCache.has(logicalName)) return;
    try {
      const attrs = await this.metadataCache.getAttributes(logicalName) || [];
      this._attributeCache.set(logicalName, attrs);
    } catch {
      this._attributeCache.set(logicalName, []);
    }
  }

  // -------------------------------------------------------------------------
  // UI Helpers
  // -------------------------------------------------------------------------

  /** Refresh all UI sections. */
  _refreshAll() {
    if (this._methodSelect) this._methodSelect.value = this.method;
    if (this._entityInput) this._entityInput.value = this.entitySetName;
    if (this._idInput) this._idInput.value = this.recordId;
    if (this._bodyTextarea) {
      this._bodyTextarea.value = this.body;
      this._updateBodyLineNumbers();
      this._updateBodyHighlight();
    }
    this._onMethodChanged();
    this._updateUrlDisplay();
    if (this._activeCodeGenerator) this._updateCodeGen(this._activeCodeGenerator);
  }

  /**
   * Create a collapsible section.
   * @param {string} title
   * @param {string} className
   * @returns {{ wrapper: HTMLElement, content: HTMLElement }}
   */
  _createCollapsible(title, className) {
    const wrapper = document.createElement('div');
    wrapper.className = `rb-section ${className || ''}`;

    const header = document.createElement('div');
    header.className = 'rb-section-header';
    header.textContent = title;

    const content = document.createElement('div');
    content.className = 'rb-section-content';

    header.addEventListener('click', () => {
      wrapper.classList.toggle('collapsed');
    });

    wrapper.append(header, content);
    return { wrapper, content };
  }

  /**
   * Create an option row with label.
   * @param {string} label
   * @returns {HTMLElement}
   */
  _createOptionRow(label) {
    const row = document.createElement('div');
    row.className = 'rb-option-row';

    const lbl = document.createElement('label');
    lbl.className = 'rb-option-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    return row;
  }

  /**
   * Create a styled button.
   * @param {string} text
   * @param {string} className
   * @param {Function} onClick
   * @returns {HTMLButtonElement}
   */
  _createButton(text, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `rb-btn ${className}`;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * Show a temporary notification.
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} type
   */
  _showNotification(message, type = 'info') {
    const existing = this.container.querySelector('.rb-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.className = `rb-notification rb-notification-${type}`;
    notif.textContent = message;
    this.container.prepend(notif);
    setTimeout(() => notif.remove(), 4000);
  }

  /**
   * Copy text to clipboard.
   * @param {string} text
   */
  async _copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }
}

export default RequestBuilder;
