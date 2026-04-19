/**
 * Dataverse Toolkit - Form Tools Module
 *
 * Inspect and manipulate Dynamics 365 model-driven app forms:
 * field inspector, schema overlay, form event viewer, JSON record viewer,
 * environment badge, record bookmarks, and quick clone.
 *
 * @module form-tools
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CSS = 'ft';
const BOOKMARKS_KEY = 'dvt_bookmarks';
const MAX_BOOKMARKS = 50;

const SUB_TABS = Object.freeze([
  { id: 'fields', label: 'Fields' },
  { id: 'events', label: 'Events' },
  { id: 'json', label: 'JSON' },
  { id: 'tools', label: 'Tools' },
]);

const FIELD_FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'dirty', label: 'Dirty' },
  { id: 'required', label: 'Required' },
  { id: 'hidden', label: 'Hidden' },
  { id: 'disabled', label: 'Disabled' },
]);

const SYSTEM_FIELDS = new Set([
  'createdon', 'modifiedon', 'createdby', 'modifiedby', 'ownerid',
  'owningbusinessunit', 'owningteam', 'owninguser', 'statecode', 'statuscode',
  'versionnumber', 'timezoneruleversionnumber', 'utcconversiontimezonecode',
  'overriddencreatedon', 'importsequencenumber',
]);

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

function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function truncate(val, max = 60) {
  const s = typeof val === 'string' ? val : JSON.stringify(val) ?? '';
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

function formatValue(val) {
  if (val === null || val === undefined) return '<span class="ft-null">null</span>';
  if (typeof val === 'boolean') return `<span class="ft-bool">${val}</span>`;
  if (typeof val === 'number') return `<span class="ft-num">${val}</span>`;
  if (Array.isArray(val) && val.length && val[0]?.id) {
    return escapeHtml(val.map((v) => `${v.name || ''} (${v.entityType})`).join(', '));
  }
  return escapeHtml(truncate(val));
}

function syntaxHighlight(json) {
  const str = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)":/g, '<span class="ft-json-key">"$1"</span>:')
    .replace(/: "(.*?)"/g, ': <span class="ft-json-str">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="ft-json-num">$1</span>')
    .replace(/: (true|false)/g, ': <span class="ft-json-bool">$1</span>')
    .replace(/: (null)/g, ': <span class="ft-json-null">$1</span>');
}

function detectEnvType(url) {
  const lower = (url || '').toLowerCase();
  if (/[\.\-](dev|sandbox)/.test(lower)) return { type: 'DEV', color: '#27ae60' };
  if (/[\.\-](test|uat|staging|qa)/.test(lower)) return { type: 'TEST', color: '#e67e22' };
  return { type: 'PROD', color: '#e74c3c' };
}

// ---------------------------------------------------------------------------
// FormTools class
// ---------------------------------------------------------------------------

export class FormTools {
  constructor(container, apiClient, metadataCache) {
    this.container = container;
    this.api = apiClient;
    this.cache = metadataCache;

    // Sub-tab state
    this._activeSubTab = 'fields';
    this._root = null;

    // Fields tab state
    this._formContext = null;
    this._schemaMetadata = null;
    this._mergedFields = [];
    this._fieldFilter = 'all';
    this._fieldSearch = '';
    this._fieldSort = { col: 'name', asc: true };
    this._autoRefresh = false;
    this._autoRefreshTimer = null;
    this._revealActive = false;
    this._highlightActive = false;
    this._expandedField = null;

    // Events tab state
    this._formEvents = null;
    this._eventsLoading = false;

    // JSON tab state
    this._recordData = null;
    this._jsonSource = 'xrm'; // 'xrm' | 'api'
    this._apiRecordData = null;

    // Tools tab state
    this._bookmarks = [];
    this._badgeActive = false;
    this._envInfo = null;
    this._cloneFields = null;
    this._cloneSelection = new Set();
    this._cloning = false;

    this._loading = false;
    this._error = null;

    this._debouncedSearch = debounce((val) => {
      this._fieldSearch = val;
      this._renderFieldTable();
    }, 300);

    this._injectStyles();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  render() {
    this._buildUI();
  }

  onHide() {
    this._stopAutoRefresh();
    if (this._highlightActive) {
      this.api.formInspect('highlightDirty', { enable: false }).catch(() => {});
      this._highlightActive = false;
    }
  }

  /**
   * Called when the Dynamics 365 page URL changes (record/entity navigation).
   * Invalidates cached form context and reloads if the fields tab is visible.
   */
  onPageChanged() {
    this._formContext = null;
    this._schemaMetadata = null;
    this._mergedFields = [];
    this._formEvents = null;
    this._recordData = null;
    this._apiRecordData = null;
    if (this._root) {
      this._renderActiveTab();
    }
  }

  destroy() {
    this.onHide();
    if (this._root) { this._root.remove(); this._root = null; }
  }

  // -----------------------------------------------------------------------
  // UI Construction
  // -----------------------------------------------------------------------

  _buildUI() {
    if (this._root) this._root.remove();

    const root = document.createElement('div');
    root.className = `${CSS}-root`;
    this._root = root;

    root.appendChild(this._buildTabBar());

    const content = document.createElement('div');
    content.className = `${CSS}-content`;
    root.appendChild(content);

    this.container.innerHTML = '';
    this.container.appendChild(root);
    this._renderActiveTab();
  }

  _buildTabBar() {
    const bar = document.createElement('div');
    bar.className = `${CSS}-tabs`;

    for (const tab of SUB_TABS) {
      const btn = document.createElement('button');
      btn.className = `${CSS}-tab${tab.id === this._activeSubTab ? ' active' : ''}`;
      btn.textContent = tab.label;
      btn.dataset.tab = tab.id;
      btn.addEventListener('click', () => {
        this._activeSubTab = tab.id;
        this._root.querySelectorAll(`.${CSS}-tab`).forEach((t) => {
          t.classList.toggle('active', t.dataset.tab === tab.id);
        });
        this._renderActiveTab();
      });
      bar.appendChild(btn);
    }

    return bar;
  }

  _getContentEl() {
    return this._root?.querySelector(`.${CSS}-content`);
  }

  _renderActiveTab() {
    const content = this._getContentEl();
    if (!content) return;
    content.innerHTML = '';

    switch (this._activeSubTab) {
      case 'fields': this._renderFieldsTab(content); break;
      case 'events': this._renderEventsTab(content); break;
      case 'json': this._renderJsonTab(content); break;
      case 'tools': this._renderToolsTab(content); break;
    }
  }

  // -----------------------------------------------------------------------
  // Fields Tab
  // -----------------------------------------------------------------------

  async _renderFieldsTab(container) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS}-fields-wrap`;
    container.appendChild(wrapper);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = `${CSS}-toolbar`;
    toolbar.innerHTML = `
      <button class="${CSS}-btn ${CSS}-btn-refresh" title="Refresh">&#x21BB;</button>
      <select class="${CSS}-filter-select">
        ${FIELD_FILTERS.map((f) => `<option value="${f.id}"${f.id === this._fieldFilter ? ' selected' : ''}>${f.label}</option>`).join('')}
      </select>
      <input type="text" class="${CSS}-search" placeholder="Search fields\u2026" value="${escapeHtml(this._fieldSearch)}" />
      <label class="${CSS}-toggle-label" title="Highlight dirty fields on the form">
        <input type="checkbox" class="${CSS}-highlight-cb" ${this._highlightActive ? 'checked' : ''} /> Dirty
      </label>
      <label class="${CSS}-toggle-label" title="Reveal hidden controls on the form">
        <input type="checkbox" class="${CSS}-reveal-cb" ${this._revealActive ? 'checked' : ''} /> Hidden
      </label>
      <label class="${CSS}-toggle-label" title="Auto-refresh every 3s">
        <input type="checkbox" class="${CSS}-autorefresh-cb" ${this._autoRefresh ? 'checked' : ''} /> Auto
      </label>
    `;
    wrapper.appendChild(toolbar);

    // Wire toolbar events
    toolbar.querySelector(`.${CSS}-btn-refresh`).addEventListener('click', () => this._loadFieldData(wrapper));
    toolbar.querySelector(`.${CSS}-filter-select`).addEventListener('change', (e) => {
      this._fieldFilter = e.target.value;
      this._renderFieldTable();
    });
    toolbar.querySelector(`.${CSS}-search`).addEventListener('input', (e) => this._debouncedSearch(e.target.value));
    toolbar.querySelector(`.${CSS}-highlight-cb`).addEventListener('change', (e) => this._toggleHighlight(e.target.checked));
    toolbar.querySelector(`.${CSS}-reveal-cb`).addEventListener('change', (e) => this._toggleReveal(e.target.checked));
    toolbar.querySelector(`.${CSS}-autorefresh-cb`).addEventListener('change', (e) => {
      this._autoRefresh = e.target.checked;
      if (this._autoRefresh) this._startAutoRefresh(wrapper);
      else this._stopAutoRefresh();
    });

    // Table container
    const tableWrap = document.createElement('div');
    tableWrap.className = `${CSS}-table-wrap`;
    wrapper.appendChild(tableWrap);

    // Load data
    await this._loadFieldData(wrapper);
  }

  async _loadFieldData(wrapper) {
    const tableWrap = wrapper?.querySelector(`.${CSS}-table-wrap`) || this._getContentEl()?.querySelector(`.${CSS}-table-wrap`);
    if (!tableWrap) return;

    tableWrap.innerHTML = `<div class="${CSS}-loading">Loading form data\u2026</div>`;

    try {
      this._formContext = await this.api.formInspect('getFormContext');

      // Show form info header
      this._renderFormHeader(wrapper);

      // Fetch schema metadata (cached)
      try {
        const attrs = await this.cache.getAttributes(this._formContext.entityName);
        this._schemaMetadata = new Map();
        for (const a of (attrs?.value || attrs || [])) {
          this._schemaMetadata.set(a.LogicalName, a);
        }
      } catch {
        this._schemaMetadata = new Map();
      }

      this._mergeFieldData();
      this._renderFieldTable();
    } catch (err) {
      tableWrap.innerHTML = `<div class="${CSS}-empty">${escapeHtml(err.message)}</div>`;
    }
  }

  _renderFormHeader(wrapper) {
    let header = wrapper.querySelector(`.${CSS}-form-header`);
    if (!header) {
      header = document.createElement('div');
      header.className = `${CSS}-form-header`;
      const toolbar = wrapper.querySelector(`.${CSS}-toolbar`);
      if (toolbar) toolbar.after(header);
    }
    const ctx = this._formContext;
    header.innerHTML = `
      <span class="${CSS}-form-entity">${escapeHtml(ctx.entityName)}</span>
      <span class="${CSS}-form-id" title="${escapeHtml(ctx.recordId)}">${escapeHtml(ctx.recordId?.slice(0, 8))}\u2026</span>
      ${ctx.formName ? `<span class="${CSS}-form-name">${escapeHtml(ctx.formName)}</span>` : ''}
      <span class="${CSS}-form-counts">${ctx.attributes.length} attrs &middot; ${ctx.controls.length} ctrls</span>
    `;
  }

  _mergeFieldData() {
    if (!this._formContext) return;
    const controlMap = new Map();
    for (const c of this._formContext.controls) {
      controlMap.set(c.name, c);
    }

    this._mergedFields = this._formContext.attributes.map((attr) => {
      const ctrl = controlMap.get(attr.name);
      const schema = this._schemaMetadata?.get(attr.name);
      return { ...attr, ctrl, schema };
    });
  }

  _getFilteredFields() {
    let fields = this._mergedFields;

    switch (this._fieldFilter) {
      case 'dirty': fields = fields.filter((f) => f.isDirty); break;
      case 'required': fields = fields.filter((f) => f.requiredLevel === 'required'); break;
      case 'hidden': fields = fields.filter((f) => f.ctrl && !f.ctrl.visible); break;
      case 'disabled': fields = fields.filter((f) => f.ctrl?.disabled); break;
    }

    if (this._fieldSearch) {
      const q = this._fieldSearch.toLowerCase();
      fields = fields.filter((f) => f.name.toLowerCase().includes(q));
    }

    const { col, asc } = this._fieldSort;
    fields.sort((a, b) => {
      let av, bv;
      switch (col) {
        case 'name': av = a.name; bv = b.name; break;
        case 'type': av = a.type; bv = b.type; break;
        case 'dirty': av = a.isDirty ? 1 : 0; bv = b.isDirty ? 1 : 0; break;
        case 'required': av = a.requiredLevel; bv = b.requiredLevel; break;
        default: av = a.name; bv = b.name;
      }
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });

    return fields;
  }

  _renderFieldTable() {
    const tableWrap = this._getContentEl()?.querySelector(`.${CSS}-table-wrap`);
    if (!tableWrap) return;

    const fields = this._getFilteredFields();
    if (!fields.length) {
      tableWrap.innerHTML = `<div class="${CSS}-empty">${this._mergedFields.length ? 'No fields match filter.' : 'No form data loaded.'}</div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    // Header
    const header = document.createElement('div');
    header.className = `${CSS}-table-header`;
    const cols = [
      { id: 'name', label: 'Field', flex: 3 },
      { id: 'type', label: 'Type', flex: 1.5 },
      { id: 'value', label: 'Value', flex: 3 },
      { id: 'badges', label: '', flex: 2 },
    ];
    for (const c of cols) {
      const cell = document.createElement('div');
      cell.className = `${CSS}-th`;
      cell.style.flex = c.flex;
      cell.textContent = c.label;
      if (c.id === 'name' || c.id === 'type') {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
          if (this._fieldSort.col === c.id) this._fieldSort.asc = !this._fieldSort.asc;
          else { this._fieldSort.col = c.id; this._fieldSort.asc = true; }
          this._renderFieldTable();
        });
        if (this._fieldSort.col === c.id) cell.textContent += this._fieldSort.asc ? ' \u25B2' : ' \u25BC';
      }
      header.appendChild(cell);
    }
    frag.appendChild(header);

    // Rows
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = `${CSS}-tr${f.isDirty ? ' ft-dirty' : ''}`;
      row.dataset.field = f.name;

      const nameCell = document.createElement('div');
      nameCell.className = `${CSS}-td`;
      nameCell.style.flex = 3;
      nameCell.textContent = f.name;
      nameCell.style.cursor = 'pointer';
      nameCell.title = 'Click to expand schema details';
      row.appendChild(nameCell);

      const typeCell = document.createElement('div');
      typeCell.className = `${CSS}-td ${CSS}-type`;
      typeCell.style.flex = 1.5;
      typeCell.textContent = f.type;
      row.appendChild(typeCell);

      const valCell = document.createElement('div');
      valCell.className = `${CSS}-td`;
      valCell.style.flex = 3;
      valCell.innerHTML = formatValue(f.value);
      row.appendChild(valCell);

      const badgeCell = document.createElement('div');
      badgeCell.className = `${CSS}-td ${CSS}-badges`;
      badgeCell.style.flex = 2;
      const badges = [];
      if (f.isDirty) badges.push(`<span class="${CSS}-badge ${CSS}-badge-dirty">dirty</span>`);
      if (f.requiredLevel === 'required') badges.push(`<span class="${CSS}-badge ${CSS}-badge-required">req</span>`);
      if (f.requiredLevel === 'recommended') badges.push(`<span class="${CSS}-badge ${CSS}-badge-recommended">rec</span>`);
      if (f.ctrl && !f.ctrl.visible) badges.push(`<span class="${CSS}-badge ${CSS}-badge-hidden">hidden</span>`);
      if (f.ctrl?.disabled) badges.push(`<span class="${CSS}-badge ${CSS}-badge-disabled">disabled</span>`);
      badgeCell.innerHTML = badges.join(' ');
      row.appendChild(badgeCell);

      // Click to expand schema overlay
      nameCell.addEventListener('click', () => this._toggleSchemaOverlay(f, row));

      frag.appendChild(row);

      // Render expanded overlay if this field was expanded
      if (this._expandedField === f.name) {
        frag.appendChild(this._createSchemaOverlay(f));
      }
    }

    tableWrap.innerHTML = '';
    tableWrap.appendChild(frag);
  }

  _toggleSchemaOverlay(field, row) {
    if (this._expandedField === field.name) {
      this._expandedField = null;
    } else {
      this._expandedField = field.name;
    }
    this._renderFieldTable();
  }

  _createSchemaOverlay(field) {
    const overlay = document.createElement('div');
    overlay.className = `${CSS}-schema-overlay`;

    const entries = [
      ['Submit Mode', field.submitMode],
      ['Required Level', field.requiredLevel],
    ];

    if (field.ctrl) {
      entries.push(
        ['Control Type', field.ctrl.controlType],
        ['Label', field.ctrl.label],
        ['Visible', field.ctrl.visible],
        ['Disabled', field.ctrl.disabled],
      );
    }

    if (field.schema) {
      const s = field.schema;
      if (s.AttributeType) entries.push(['Attribute Type', s.AttributeType]);
      if (s.AttributeTypeName?.Value) entries.push(['Type Name', s.AttributeTypeName.Value]);
      if (s.MaxLength !== undefined) entries.push(['Max Length', s.MaxLength]);
      if (s.MinValue !== undefined) entries.push(['Min Value', s.MinValue]);
      if (s.MaxValue !== undefined) entries.push(['Max Value', s.MaxValue]);
      if (s.Precision !== undefined) entries.push(['Precision', s.Precision]);
      if (s.Format) entries.push(['Format', s.Format]);
      if (s.FormulaDefinition) entries.push(['Formula', s.FormulaDefinition]);
      if (s.DisplayName?.UserLocalizedLabel?.Label) entries.push(['Display Name', s.DisplayName.UserLocalizedLabel.Label]);
      if (s.SchemaName) entries.push(['Schema Name', s.SchemaName]);
      if (s.Description?.UserLocalizedLabel?.Label) entries.push(['Description', s.Description.UserLocalizedLabel.Label]);
      if (s.IsCustomAttribute !== undefined) entries.push(['Custom', s.IsCustomAttribute]);
      if (s.IsManaged !== undefined) entries.push(['Managed', s.IsManaged]);
      if (s.IsPrimaryId) entries.push(['Primary ID', true]);
      if (s.IsPrimaryName) entries.push(['Primary Name', true]);
    }

    overlay.innerHTML = `<table class="${CSS}-schema-table">
      ${entries.map(([k, v]) => `<tr><td class="${CSS}-schema-key">${escapeHtml(k)}</td><td class="${CSS}-schema-val">${escapeHtml(String(v))}</td></tr>`).join('')}
    </table>`;

    return overlay;
  }

  async _toggleHighlight(enable) {
    this._highlightActive = enable;
    try {
      await this.api.formInspect('highlightDirty', { enable });
    } catch { /* ignore */ }
  }

  async _toggleReveal(reveal) {
    this._revealActive = reveal;
    try {
      await this.api.formInspect('revealHidden', { reveal });
      // Re-load to reflect visibility changes
      if (!reveal) {
        const wrapper = this._getContentEl()?.querySelector(`.${CSS}-fields-wrap`);
        if (wrapper) await this._loadFieldData(wrapper);
      }
    } catch { /* ignore */ }
  }

  _startAutoRefresh(wrapper) {
    this._stopAutoRefresh();
    this._autoRefreshTimer = setInterval(() => this._loadFieldData(wrapper), 3000);
  }

  _stopAutoRefresh() {
    if (this._autoRefreshTimer) { clearInterval(this._autoRefreshTimer); this._autoRefreshTimer = null; }
  }

  // -----------------------------------------------------------------------
  // Events Tab
  // -----------------------------------------------------------------------

  async _renderEventsTab(container) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS}-events-wrap`;
    container.appendChild(wrapper);

    wrapper.innerHTML = `<div class="${CSS}-loading">Loading form events\u2026</div>`;

    try {
      // Get form context for entity + form ID
      if (!this._formContext) {
        this._formContext = await this.api.formInspect('getFormContext');
      }

      const { entityName, formId } = this._formContext;
      if (!entityName) throw new Error('No entity context available.');

      // Query the systemform entity for formxml
      let filterExpr = `objecttypecode eq '${entityName}'`;
      if (formId) filterExpr += ` and formid eq '${formId}'`;

      const data = await this.api.request('GET', `systemforms?$filter=${filterExpr}&$select=formxml,name,type&$top=1`);
      const form = (data.value || [])[0];

      if (!form?.formxml) {
        wrapper.innerHTML = `<div class="${CSS}-empty">No form XML found. You may not have read access to systemforms.</div>`;
        return;
      }

      const events = this._parseFormEvents(form.formxml);
      this._formEvents = events;
      this._renderEventList(wrapper, form.name);
    } catch (err) {
      wrapper.innerHTML = `<div class="${CSS}-empty">${escapeHtml(err.message)}</div>`;
    }
  }

  _parseFormEvents(formxml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(formxml, 'text/xml');
    const groups = { onload: [], onsave: [], onchange: [] };

    // Form-level events
    const formEvents = doc.querySelectorAll('form > events > event');
    for (const evt of formEvents) {
      const eventName = (evt.getAttribute('name') || '').toLowerCase();
      const handlers = this._extractHandlers(evt);
      if (groups[eventName]) {
        groups[eventName].push(...handlers);
      }
    }

    // Tab-level and field-level events in some form definitions
    const allEvents = doc.querySelectorAll('event');
    for (const evt of allEvents) {
      const eventName = (evt.getAttribute('name') || '').toLowerCase();
      const controlId = evt.getAttribute('attribute') || evt.getAttribute('control') || '';
      const handlers = this._extractHandlers(evt, controlId);
      if (eventName === 'onchange' && controlId) {
        groups.onchange.push(...handlers);
      }
    }

    // Deduplicate
    for (const key of Object.keys(groups)) {
      const seen = new Set();
      groups[key] = groups[key].filter((h) => {
        const k = `${h.library}:${h.functionName}:${h.field}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    return groups;
  }

  _extractHandlers(eventEl, field = '') {
    const handlers = [];
    for (const h of eventEl.querySelectorAll('Handler, handler')) {
      handlers.push({
        library: h.getAttribute('libraryName') || '',
        functionName: h.getAttribute('functionName') || '',
        enabled: h.getAttribute('enabled') !== 'false',
        passContext: h.getAttribute('passExecutionContext') === 'true',
        parameters: h.getAttribute('parameters') || '',
        field: field || h.closest('[attribute]')?.getAttribute('attribute') || '',
      });
    }
    return handlers;
  }

  _renderEventList(wrapper, formName) {
    const events = this._formEvents;
    const frag = document.createDocumentFragment();

    const header = document.createElement('div');
    header.className = `${CSS}-events-header`;
    header.textContent = formName ? `Form: ${formName}` : 'Form Events';
    frag.appendChild(header);

    for (const [eventType, handlers] of Object.entries(events)) {
      const group = document.createElement('div');
      group.className = `${CSS}-event-group`;

      const title = document.createElement('div');
      title.className = `${CSS}-event-type`;
      title.innerHTML = `${escapeHtml(eventType)} <span class="${CSS}-event-count">(${handlers.length})</span>`;
      group.appendChild(title);

      if (!handlers.length) {
        const empty = document.createElement('div');
        empty.className = `${CSS}-event-empty`;
        empty.textContent = 'No handlers registered';
        group.appendChild(empty);
      }

      for (const h of handlers) {
        const item = document.createElement('div');
        item.className = `${CSS}-event-handler${h.enabled ? '' : ' ft-handler-disabled'}`;
        item.innerHTML = `
          <div class="${CSS}-handler-fn">${escapeHtml(h.functionName)}</div>
          <div class="${CSS}-handler-meta">
            <span class="${CSS}-handler-lib">${escapeHtml(h.library)}</span>
            ${h.field ? `<span class="${CSS}-handler-field">on: ${escapeHtml(h.field)}</span>` : ''}
            ${h.passContext ? `<span class="${CSS}-handler-ctx">ctx</span>` : ''}
            ${!h.enabled ? `<span class="${CSS}-handler-off">disabled</span>` : ''}
          </div>
        `;
        group.appendChild(item);
      }

      frag.appendChild(group);
    }

    wrapper.innerHTML = '';
    wrapper.appendChild(frag);
  }

  // -----------------------------------------------------------------------
  // JSON Tab
  // -----------------------------------------------------------------------

  async _renderJsonTab(container) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS}-json-wrap`;
    container.appendChild(wrapper);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = `${CSS}-toolbar`;
    toolbar.innerHTML = `
      <select class="${CSS}-json-source">
        <option value="xrm"${this._jsonSource === 'xrm' ? ' selected' : ''}>Xrm Form Values</option>
        <option value="api"${this._jsonSource === 'api' ? ' selected' : ''}>Web API Record</option>
      </select>
      <button class="${CSS}-btn" title="Copy to clipboard">Copy</button>
      <button class="${CSS}-btn" title="Download as JSON">Download</button>
      <button class="${CSS}-btn ${CSS}-btn-refresh" title="Refresh">&#x21BB;</button>
    `;
    wrapper.appendChild(toolbar);

    const pre = document.createElement('pre');
    pre.className = `${CSS}-json-viewer`;
    wrapper.appendChild(pre);

    toolbar.querySelector(`.${CSS}-json-source`).addEventListener('change', (e) => {
      this._jsonSource = e.target.value;
      this._loadJsonData(wrapper);
    });

    const [copyBtn, downloadBtn] = toolbar.querySelectorAll(`.${CSS}-btn:not(.${CSS}-btn-refresh)`);
    copyBtn.addEventListener('click', () => {
      const text = JSON.stringify(this._jsonSource === 'xrm' ? this._recordData?.attributes : this._apiRecordData, null, 2);
      navigator.clipboard.writeText(text || '').catch(() => {});
    });
    downloadBtn.addEventListener('click', () => {
      const data = this._jsonSource === 'xrm' ? this._recordData?.attributes : this._apiRecordData;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this._formContext?.entityName || 'record'}_${this._formContext?.recordId?.slice(0, 8) || 'data'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
    toolbar.querySelector(`.${CSS}-btn-refresh`).addEventListener('click', () => this._loadJsonData(wrapper));

    await this._loadJsonData(wrapper);
  }

  async _loadJsonData(wrapper) {
    const pre = wrapper.querySelector(`.${CSS}-json-viewer`);
    if (!pre) return;
    pre.innerHTML = `<span class="${CSS}-loading">Loading\u2026</span>`;

    try {
      if (this._jsonSource === 'xrm') {
        this._recordData = await this.api.formInspect('getRecordData');
        pre.innerHTML = syntaxHighlight(this._recordData.attributes);
      } else {
        if (!this._formContext) this._formContext = await this.api.formInspect('getFormContext');
        const entities = await this.cache.getEntities();
        const entityMeta = (entities?.value || entities || []).find(
          (e) => e.LogicalName === this._formContext.entityName,
        );
        if (!entityMeta?.EntitySetName) throw new Error('Could not determine entity set name.');
        const data = await this.api.request('GET', `${entityMeta.EntitySetName}(${this._formContext.recordId})`);
        this._apiRecordData = data;
        pre.innerHTML = syntaxHighlight(data);
      }
    } catch (err) {
      pre.innerHTML = `<span class="${CSS}-error">${escapeHtml(err.message)}</span>`;
    }
  }

  // -----------------------------------------------------------------------
  // Tools Tab
  // -----------------------------------------------------------------------

  async _renderToolsTab(container) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS}-tools-wrap`;
    container.appendChild(wrapper);

    // Load env info
    try {
      this._envInfo = await this.api.getEnvironment();
    } catch { /* ignore */ }

    // Load bookmarks
    await this._loadBookmarks();

    const frag = document.createDocumentFragment();

    // Environment Badge section
    frag.appendChild(this._buildEnvBadgeSection());

    // Record Bookmarks section
    frag.appendChild(this._buildBookmarksSection());

    // Quick Clone section
    frag.appendChild(await this._buildCloneSection());

    wrapper.appendChild(frag);
  }

  // -- Environment Badge --

  _buildEnvBadgeSection() {
    const section = document.createElement('div');
    section.className = `${CSS}-section`;

    const env = detectEnvType(this._envInfo?.url);

    section.innerHTML = `
      <div class="${CSS}-section-title">Environment Badge</div>
      <div class="${CSS}-section-body">
        <div class="${CSS}-env-info">
          <span class="${CSS}-env-chip" style="background:${env.color}">${escapeHtml(env.type)}</span>
          <span class="${CSS}-env-url">${escapeHtml(this._envInfo?.url || 'Unknown')}</span>
        </div>
        <button class="${CSS}-btn ${CSS}-btn-badge">${this._badgeActive ? 'Hide Badge' : 'Show Badge'}</button>
      </div>
    `;

    section.querySelector(`.${CSS}-btn-badge`).addEventListener('click', async () => {
      this._badgeActive = !this._badgeActive;
      try {
        await this.api.formInspect('toggleBadge', {
          show: this._badgeActive,
          envType: env.type,
          color: env.color,
        });
      } catch { /* ignore */ }
      section.querySelector(`.${CSS}-btn-badge`).textContent = this._badgeActive ? 'Hide Badge' : 'Show Badge';
    });

    return section;
  }

  // -- Record Bookmarks --

  async _loadBookmarks() {
    try {
      const stored = await chrome.storage.local.get(BOOKMARKS_KEY);
      this._bookmarks = stored[BOOKMARKS_KEY] || [];
    } catch {
      this._bookmarks = [];
    }
  }

  async _saveBookmarks() {
    await chrome.storage.local.set({ [BOOKMARKS_KEY]: this._bookmarks });
  }

  _buildBookmarksSection() {
    const section = document.createElement('div');
    section.className = `${CSS}-section`;

    const buildList = () => {
      const envUrl = this._envInfo?.url || '';
      const envBookmarks = this._bookmarks.filter((b) => b.envUrl === envUrl);

      let listHtml = '';
      if (!envBookmarks.length) {
        listHtml = `<div class="${CSS}-empty-sm">No bookmarks yet</div>`;
      } else {
        listHtml = envBookmarks.map((b, i) => `
          <div class="${CSS}-bookmark" data-idx="${i}">
            <span class="${CSS}-bm-entity">${escapeHtml(b.entityName)}</span>
            <span class="${CSS}-bm-name">${escapeHtml(b.displayName || b.recordId.slice(0, 8))}</span>
            <span class="${CSS}-bm-actions">
              <button class="${CSS}-bm-open" title="Open record">Open</button>
              <button class="${CSS}-bm-del" title="Remove bookmark">&times;</button>
            </span>
          </div>
        `).join('');
      }

      return listHtml;
    };

    section.innerHTML = `
      <div class="${CSS}-section-title">Record Bookmarks</div>
      <div class="${CSS}-section-body">
        <button class="${CSS}-btn ${CSS}-btn-bookmark">Bookmark This Record</button>
        <div class="${CSS}-bookmark-list">${buildList()}</div>
      </div>
    `;

    // Bookmark current record
    section.querySelector(`.${CSS}-btn-bookmark`).addEventListener('click', async () => {
      try {
        if (!this._formContext) this._formContext = await this.api.formInspect('getFormContext');
        const ctx = this._formContext;
        if (!ctx?.recordId) throw new Error('No record open.');

        const envUrl = this._envInfo?.url || '';
        const exists = this._bookmarks.some((b) => b.recordId === ctx.recordId && b.envUrl === envUrl);
        if (exists) return;

        // Get primary name attribute value for display
        let displayName = '';
        const nameAttr = ctx.attributes.find((a) => a.type === 'string' && a.value);
        if (nameAttr) displayName = String(nameAttr.value);

        this._bookmarks.unshift({
          entityName: ctx.entityName,
          recordId: ctx.recordId,
          displayName,
          envUrl,
          savedAt: Date.now(),
        });
        if (this._bookmarks.length > MAX_BOOKMARKS) this._bookmarks.length = MAX_BOOKMARKS;
        await this._saveBookmarks();

        section.querySelector(`.${CSS}-bookmark-list`).innerHTML = buildList();
        this._wireBookmarkEvents(section);
      } catch { /* ignore */ }
    });

    this._wireBookmarkEvents(section);
    return section;
  }

  _wireBookmarkEvents(section) {
    for (const openBtn of section.querySelectorAll(`.${CSS}-bm-open`)) {
      openBtn.addEventListener('click', (e) => {
        const idx = +e.target.closest(`.${CSS}-bookmark`).dataset.idx;
        const envUrl = this._envInfo?.url || '';
        const envBookmarks = this._bookmarks.filter((b) => b.envUrl === envUrl);
        const bm = envBookmarks[idx];
        if (!bm) return;
        const url = `${bm.envUrl}/main.aspx?etn=${bm.entityName}&id=${bm.recordId}&pagetype=entityrecord`;
        window.open(url, '_blank');
      });
    }
    for (const delBtn of section.querySelectorAll(`.${CSS}-bm-del`)) {
      delBtn.addEventListener('click', async (e) => {
        const idx = +e.target.closest(`.${CSS}-bookmark`).dataset.idx;
        const envUrl = this._envInfo?.url || '';
        const envBookmarks = this._bookmarks.filter((b) => b.envUrl === envUrl);
        const bm = envBookmarks[idx];
        if (!bm) return;
        this._bookmarks = this._bookmarks.filter((b) => !(b.recordId === bm.recordId && b.envUrl === bm.envUrl));
        await this._saveBookmarks();
        const listEl = section.querySelector(`.${CSS}-bookmark-list`);
        if (listEl) {
          const envBm = this._bookmarks.filter((b) => b.envUrl === envUrl);
          listEl.innerHTML = !envBm.length
            ? `<div class="${CSS}-empty-sm">No bookmarks yet</div>`
            : envBm.map((b, i) => `
              <div class="${CSS}-bookmark" data-idx="${i}">
                <span class="${CSS}-bm-entity">${escapeHtml(b.entityName)}</span>
                <span class="${CSS}-bm-name">${escapeHtml(b.displayName || b.recordId.slice(0, 8))}</span>
                <span class="${CSS}-bm-actions">
                  <button class="${CSS}-bm-open" title="Open record">Open</button>
                  <button class="${CSS}-bm-del" title="Remove bookmark">&times;</button>
                </span>
              </div>
            `).join('');
          this._wireBookmarkEvents(section);
        }
      });
    }
  }

  // -- Quick Clone --

  async _buildCloneSection() {
    const section = document.createElement('div');
    section.className = `${CSS}-section`;

    let fieldsHtml = '';
    try {
      if (!this._formContext) this._formContext = await this.api.formInspect('getFormContext');
      const cloneableFields = this._formContext.attributes.filter(
        (a) => !SYSTEM_FIELDS.has(a.name) && !a.name.endsWith('_base'),
      );
      this._cloneFields = cloneableFields;
      // Pre-select non-null, non-system fields
      this._cloneSelection = new Set(cloneableFields.filter((f) => f.value !== null).map((f) => f.name));

      fieldsHtml = `
        <div class="${CSS}-clone-controls">
          <button class="${CSS}-btn ${CSS}-btn-sm" data-action="all">All</button>
          <button class="${CSS}-btn ${CSS}-btn-sm" data-action="none">None</button>
          <span class="${CSS}-clone-count">${this._cloneSelection.size} fields selected</span>
        </div>
        <div class="${CSS}-clone-fields">
          ${cloneableFields.map((f) => `
            <label class="${CSS}-clone-field">
              <input type="checkbox" value="${escapeHtml(f.name)}" ${this._cloneSelection.has(f.name) ? 'checked' : ''} />
              <span>${escapeHtml(f.name)}</span>
              <span class="${CSS}-clone-val">${escapeHtml(truncate(f.value, 30))}</span>
            </label>
          `).join('')}
        </div>
        <button class="${CSS}-btn ${CSS}-btn-clone">Clone Record</button>
      `;
    } catch (err) {
      fieldsHtml = `<div class="${CSS}-empty-sm">${escapeHtml(err.message)}</div>`;
    }

    section.innerHTML = `
      <div class="${CSS}-section-title">Quick Clone</div>
      <div class="${CSS}-section-body">${fieldsHtml}</div>
    `;

    // Wire clone events
    const updateCount = () => {
      const countEl = section.querySelector(`.${CSS}-clone-count`);
      if (countEl) countEl.textContent = `${this._cloneSelection.size} fields selected`;
    };

    section.querySelector('[data-action="all"]')?.addEventListener('click', () => {
      this._cloneSelection = new Set((this._cloneFields || []).map((f) => f.name));
      section.querySelectorAll(`.${CSS}-clone-field input`).forEach((cb) => { cb.checked = true; });
      updateCount();
    });
    section.querySelector('[data-action="none"]')?.addEventListener('click', () => {
      this._cloneSelection.clear();
      section.querySelectorAll(`.${CSS}-clone-field input`).forEach((cb) => { cb.checked = false; });
      updateCount();
    });

    section.querySelectorAll(`.${CSS}-clone-field input`).forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) this._cloneSelection.add(cb.value);
        else this._cloneSelection.delete(cb.value);
        updateCount();
      });
    });

    section.querySelector(`.${CSS}-btn-clone`)?.addEventListener('click', () => this._executeClone(section));

    return section;
  }

  async _executeClone(section) {
    if (this._cloning || !this._formContext || !this._cloneSelection.size) return;
    this._cloning = true;

    const btn = section.querySelector(`.${CSS}-btn-clone`);
    if (btn) { btn.disabled = true; btn.textContent = 'Cloning\u2026'; }

    try {
      const ctx = this._formContext;
      const entities = await this.cache.getEntities();
      const entityMeta = (entities?.value || entities || []).find((e) => e.LogicalName === ctx.entityName);
      if (!entityMeta?.EntitySetName) throw new Error('Could not determine entity set name.');

      // Build create payload
      const payload = {};
      for (const attr of ctx.attributes) {
        if (!this._cloneSelection.has(attr.name)) continue;
        if (attr.name === entityMeta.PrimaryIdAttribute) continue;

        if (attr.type === 'lookup' && Array.isArray(attr.value) && attr.value.length) {
          const lookup = attr.value[0];
          const lookupEntity = (entities?.value || entities || []).find((e) => e.LogicalName === lookup.entityType);
          if (lookupEntity?.EntitySetName) {
            payload[`${attr.name}@odata.bind`] = `/${lookupEntity.EntitySetName}(${lookup.id.replace(/[{}]/g, '').toLowerCase()})`;
          }
        } else if (attr.value !== null && attr.value !== undefined) {
          payload[attr.name] = attr.value;
        }
      }

      const result = await this.api.create(entityMeta.EntitySetName, payload);
      const newId = result?.[entityMeta.PrimaryIdAttribute]
        || result?.['@odata.editLink']?.match(/\(([^)]+)\)/)?.[1]
        || '';

      if (btn) {
        btn.textContent = 'Cloned!';
        btn.disabled = false;
        if (newId) {
          const link = document.createElement('a');
          link.href = '#';
          link.className = `${CSS}-clone-link`;
          link.textContent = ` Open new record`;
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const url = `${this._envInfo?.url || ''}/main.aspx?etn=${ctx.entityName}&id=${newId}&pagetype=entityrecord`;
            window.open(url, '_blank');
          });
          btn.after(link);
        }
        setTimeout(() => { btn.textContent = 'Clone Record'; }, 3000);
      }
    } catch (err) {
      if (btn) { btn.textContent = 'Clone Record'; btn.disabled = false; }
      const errEl = document.createElement('div');
      errEl.className = `${CSS}-error`;
      errEl.textContent = err.message;
      section.querySelector(`.${CSS}-section-body`)?.appendChild(errEl);
      setTimeout(() => errEl.remove(), 5000);
    } finally {
      this._cloning = false;
    }
  }

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById(`${CSS}-styles`)) return;

    const style = document.createElement('style');
    style.id = `${CSS}-styles`;
    style.textContent = `
      /* Root */
      .${CSS}-root {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: var(--color-text-primary, #ccc);
      }

      /* Sub-tab bar */
      .${CSS}-tabs {
        display: flex;
        border-bottom: 1px solid var(--color-border, #404040);
        flex-shrink: 0;
      }
      .${CSS}-tab {
        padding: 7px 14px;
        border: none;
        background: none;
        color: var(--color-text-muted, #808080);
        font-size: 11px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        white-space: nowrap;
        transition: color 0.15s, border-color 0.15s;
      }
      .${CSS}-tab:hover { color: var(--color-text-primary, #ccc); }
      .${CSS}-tab.active {
        color: var(--color-text-bright, #fff);
        border-bottom-color: var(--color-accent-primary, #0078d4);
      }

      /* Content */
      .${CSS}-content {
        flex: 1;
        overflow-y: auto;
        padding: 0;
      }

      /* Toolbar */
      .${CSS}-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--color-border-subtle, #333);
        flex-wrap: wrap;
      }
      .${CSS}-btn {
        padding: 4px 10px;
        border: 1px solid var(--color-border, #404040);
        border-radius: 3px;
        background: var(--color-bg-input, #3c3c3c);
        color: var(--color-text-primary, #ccc);
        font-size: 11px;
        cursor: pointer;
        white-space: nowrap;
      }
      .${CSS}-btn:hover { background: var(--color-bg-hover, #333); }
      .${CSS}-btn:disabled { opacity: 0.5; cursor: default; }
      .${CSS}-btn-sm { padding: 2px 6px; font-size: 10px; }
      .${CSS}-btn-refresh { font-size: 14px; padding: 2px 8px; }
      .${CSS}-filter-select, .${CSS}-json-source {
        padding: 3px 6px;
        border: 1px solid var(--color-border, #404040);
        border-radius: 3px;
        background: var(--color-bg-input, #3c3c3c);
        color: var(--color-text-primary, #ccc);
        font-size: 11px;
      }
      .${CSS}-search {
        flex: 1;
        min-width: 100px;
        padding: 3px 8px;
        border: 1px solid var(--color-border, #404040);
        border-radius: 3px;
        background: var(--color-bg-input, #3c3c3c);
        color: var(--color-text-primary, #ccc);
        font-size: 11px;
      }
      .${CSS}-search:focus { border-color: var(--color-border-focus, #007fd4); outline: none; }
      .${CSS}-toggle-label {
        display: flex;
        align-items: center;
        gap: 3px;
        font-size: 10px;
        color: var(--color-text-muted, #808080);
        cursor: pointer;
        white-space: nowrap;
      }

      /* Form header */
      .${CSS}-form-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        font-size: 11px;
        color: var(--color-text-muted, #808080);
        border-bottom: 1px solid var(--color-border-subtle, #333);
      }
      .${CSS}-form-entity {
        font-weight: 600;
        color: var(--color-accent-secondary, #569cd6);
      }
      .${CSS}-form-id { font-family: monospace; font-size: 10px; }
      .${CSS}-form-name {
        padding: 1px 6px;
        border-radius: 3px;
        background: var(--color-bg-badge, #4d4d4d);
        font-size: 10px;
      }
      .${CSS}-form-counts { margin-left: auto; font-size: 10px; }

      /* Field table */
      .${CSS}-table-wrap { flex: 1; overflow-y: auto; }
      .${CSS}-table-header {
        display: flex;
        padding: 4px 10px;
        border-bottom: 1px solid var(--color-border, #404040);
        position: sticky;
        top: 0;
        background: var(--color-bg-panel, #2d2d2d);
        z-index: 1;
      }
      .${CSS}-th {
        font-size: 10px;
        font-weight: 600;
        color: var(--color-text-muted, #808080);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 2px 4px;
      }
      .${CSS}-tr {
        display: flex;
        padding: 3px 10px;
        border-bottom: 1px solid var(--color-border-subtle, #333);
        align-items: center;
      }
      .${CSS}-tr:hover { background: var(--color-bg-hover, #333); }
      .${CSS}-tr.ft-dirty { background: var(--color-warning-bg, rgba(220,220,170,0.12)); }
      .${CSS}-td {
        padding: 2px 4px;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${CSS}-type { color: var(--color-text-muted, #808080); }

      /* Badges */
      .${CSS}-badges { display: flex; gap: 3px; flex-wrap: wrap; }
      .${CSS}-badge {
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .${CSS}-badge-dirty { background: var(--color-warning-bg); color: var(--color-warning); border: 1px solid var(--color-warning-border); }
      .${CSS}-badge-required { background: var(--color-error-bg); color: var(--color-error); border: 1px solid var(--color-error-border); }
      .${CSS}-badge-recommended { background: var(--color-info-bg); color: var(--color-info); border: 1px solid var(--color-info-border); }
      .${CSS}-badge-hidden { background: var(--color-bg-badge, #4d4d4d); color: var(--color-text-muted); border: 1px solid var(--color-border); }
      .${CSS}-badge-disabled { background: var(--color-bg-badge, #4d4d4d); color: var(--color-text-disabled); border: 1px solid var(--color-border); }

      /* Schema overlay */
      .${CSS}-schema-overlay {
        padding: 8px 10px 8px 20px;
        background: var(--color-bg-active, #37373d);
        border-bottom: 1px solid var(--color-border, #404040);
      }
      .${CSS}-schema-table { width: 100%; border-collapse: collapse; }
      .${CSS}-schema-table td { padding: 2px 8px; font-size: 11px; }
      .${CSS}-schema-key { color: var(--color-text-muted); white-space: nowrap; width: 120px; }
      .${CSS}-schema-val { color: var(--color-text-primary); font-family: monospace; font-size: 11px; }

      /* Value formatting */
      .ft-null { color: var(--color-text-disabled, #5a5a5a); font-style: italic; }
      .ft-bool { color: var(--color-accent-secondary, #569cd6); }
      .ft-num { color: var(--color-success, #4ec9b0); }

      /* Events tab */
      .${CSS}-events-wrap { padding: 0; }
      .${CSS}-events-header {
        padding: 8px 10px;
        font-weight: 600;
        font-size: 12px;
        border-bottom: 1px solid var(--color-border, #404040);
        color: var(--color-text-bright, #fff);
      }
      .${CSS}-event-group { border-bottom: 1px solid var(--color-border-subtle, #333); }
      .${CSS}-event-type {
        padding: 6px 10px;
        font-weight: 600;
        font-size: 11px;
        color: var(--color-accent-secondary, #569cd6);
        background: var(--color-bg-active, #37373d);
        text-transform: capitalize;
      }
      .${CSS}-event-count { color: var(--color-text-muted); font-weight: 400; }
      .${CSS}-event-empty {
        padding: 4px 10px 4px 20px;
        color: var(--color-text-disabled, #5a5a5a);
        font-style: italic;
        font-size: 11px;
      }
      .${CSS}-event-handler {
        padding: 4px 10px 4px 20px;
        border-bottom: 1px solid var(--color-border-subtle, #333);
      }
      .${CSS}-event-handler.ft-handler-disabled { opacity: 0.5; }
      .${CSS}-handler-fn {
        font-family: monospace;
        font-size: 11px;
        color: var(--color-text-bright, #fff);
      }
      .${CSS}-handler-meta {
        display: flex;
        gap: 8px;
        margin-top: 2px;
        font-size: 10px;
        color: var(--color-text-muted, #808080);
      }
      .${CSS}-handler-lib { color: var(--color-warning, #dcdcaa); }
      .${CSS}-handler-field { color: var(--color-info, #4fc1ff); }
      .${CSS}-handler-ctx {
        padding: 0 4px;
        border-radius: 2px;
        background: var(--color-info-bg);
        color: var(--color-info);
        font-size: 9px;
      }
      .${CSS}-handler-off {
        padding: 0 4px;
        border-radius: 2px;
        background: var(--color-error-bg);
        color: var(--color-error);
        font-size: 9px;
      }

      /* JSON tab */
      .${CSS}-json-wrap { display: flex; flex-direction: column; height: 100%; }
      .${CSS}-json-viewer {
        flex: 1;
        margin: 0;
        padding: 10px;
        overflow: auto;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        font-size: 11px;
        line-height: 1.5;
        background: var(--color-bg-base, #1e1e1e);
        color: var(--color-text-primary, #ccc);
        white-space: pre-wrap;
        word-break: break-all;
      }
      .ft-json-key { color: var(--color-accent-secondary, #569cd6); }
      .ft-json-str { color: var(--color-success, #4ec9b0); }
      .ft-json-num { color: var(--color-warning, #dcdcaa); }
      .ft-json-bool { color: var(--color-accent-secondary, #569cd6); }
      .ft-json-null { color: var(--color-text-disabled, #5a5a5a); }

      /* Tools tab */
      .${CSS}-tools-wrap { padding: 0; }
      .${CSS}-section { border-bottom: 1px solid var(--color-border, #404040); }
      .${CSS}-section-title {
        padding: 8px 10px;
        font-weight: 600;
        font-size: 12px;
        color: var(--color-text-bright, #fff);
        background: var(--color-bg-active, #37373d);
      }
      .${CSS}-section-body { padding: 8px 10px; }

      /* Env badge */
      .${CSS}-env-info { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .${CSS}-env-chip {
        padding: 2px 8px;
        border-radius: 3px;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.5px;
      }
      .${CSS}-env-url { font-size: 11px; color: var(--color-text-muted); font-family: monospace; }

      /* Bookmarks */
      .${CSS}-bookmark-list { margin-top: 8px; }
      .${CSS}-bookmark {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 0;
        border-bottom: 1px solid var(--color-border-subtle, #333);
        font-size: 11px;
      }
      .${CSS}-bm-entity {
        font-weight: 600;
        color: var(--color-accent-secondary, #569cd6);
        min-width: 60px;
      }
      .${CSS}-bm-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .${CSS}-bm-actions { display: flex; gap: 4px; flex-shrink: 0; }
      .${CSS}-bm-open {
        padding: 1px 6px;
        border: 1px solid var(--color-border, #404040);
        border-radius: 2px;
        background: var(--color-bg-input, #3c3c3c);
        color: var(--color-text-link, #4fc1ff);
        font-size: 10px;
        cursor: pointer;
      }
      .${CSS}-bm-open:hover { background: var(--color-bg-hover, #333); }
      .${CSS}-bm-del {
        padding: 1px 5px;
        border: none;
        background: none;
        color: var(--color-text-muted, #808080);
        font-size: 14px;
        cursor: pointer;
      }
      .${CSS}-bm-del:hover { color: var(--color-error, #f44747); }

      /* Quick clone */
      .${CSS}-clone-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
      }
      .${CSS}-clone-count { font-size: 10px; color: var(--color-text-muted); margin-left: auto; }
      .${CSS}-clone-fields {
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid var(--color-border-subtle, #333);
        border-radius: 3px;
        padding: 4px;
        margin-bottom: 8px;
      }
      .${CSS}-clone-field {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 4px;
        font-size: 11px;
        cursor: pointer;
      }
      .${CSS}-clone-field:hover { background: var(--color-bg-hover, #333); }
      .${CSS}-clone-val {
        margin-left: auto;
        color: var(--color-text-muted);
        font-size: 10px;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${CSS}-clone-link { color: var(--color-text-link, #4fc1ff); font-size: 11px; margin-left: 6px; }
      .${CSS}-btn-clone {
        padding: 5px 14px;
        background: var(--color-accent-primary, #0078d4);
        border: none;
        border-radius: 3px;
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .${CSS}-btn-clone:hover { background: var(--color-accent-primary-hover, #1a8ae8); }
      .${CSS}-btn-clone:disabled { opacity: 0.5; cursor: default; }

      /* Shared */
      .${CSS}-loading { padding: 20px; text-align: center; color: var(--color-text-muted, #808080); }
      .${CSS}-empty { padding: 20px; text-align: center; color: var(--color-text-muted, #808080); font-style: italic; }
      .${CSS}-empty-sm { padding: 6px 0; color: var(--color-text-disabled); font-style: italic; font-size: 11px; }
      .${CSS}-error { padding: 6px; color: var(--color-error, #f44747); font-size: 11px; }
    `;
    document.head.appendChild(style);
  }
}

export default FormTools;
