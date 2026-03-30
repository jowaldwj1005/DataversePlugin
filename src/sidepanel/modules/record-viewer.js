/**
 * Dataverse Toolkit - Record Viewer Module
 *
 * Displays a paginated, sortable data grid for Dataverse entity records.
 * Supports inline editing, record creation/deletion, column filtering,
 * column visibility toggling, formatted value display, and JSON/CSV export.
 *
 * @module record-viewer
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CSS = 'dvt-rv';
const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Format a cell value for display. Prefers OData formatted values when
 * available (money, dates, option set labels).
 * @param {Object} record - Full record object
 * @param {string} column - Logical name of the column
 * @returns {string}
 */
function formatCellValue(record, column) {
  // Check for formatted value (Dataverse returns these with @OData.Community.Display.V1.FormattedValue)
  const formattedKey = `${column}@OData.Community.Display.V1.FormattedValue`;
  if (record[formattedKey] != null) return String(record[formattedKey]);

  // Check for lookup display name
  const lookupFormatted = `_${column}_value@OData.Community.Display.V1.FormattedValue`;
  if (record[lookupFormatted] != null) return String(record[lookupFormatted]);

  // Check for lookup navigation value
  const lookupValue = `_${column}_value`;
  if (record[lookupValue] != null) return String(record[lookupValue]);

  const val = record[column];
  if (val == null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Get the raw (editable) value for a cell.
 * @param {Object} record
 * @param {string} column
 * @returns {*}
 */
function getRawValue(record, column) {
  if (record[column] !== undefined) return record[column];
  const lookupValue = `_${column}_value`;
  if (record[lookupValue] !== undefined) return record[lookupValue];
  return null;
}

/**
 * Download a string as a file.
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Convert records to CSV string.
 * @param {Object[]} records
 * @param {string[]} columns
 * @returns {string}
 */
function toCsv(records, columns) {
  const escCsv = (val) => {
    const str = val == null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map(escCsv).join(',');
  const rows = records.map((rec) =>
    columns.map((col) => escCsv(formatCellValue(rec, col))).join(',')
  );
  return [header, ...rows].join('\n');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// RecordViewer class
// ---------------------------------------------------------------------------

/**
 * Data grid viewer for Dataverse entity records. Renders a sortable,
 * filterable, paginated table with inline editing and CRUD operations.
 */
class RecordViewer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} apiClient - Object with `request(method, url, options)` for API calls
   * @param {Object} [options]
   * @param {Function} [options.onClose] - Callback when the viewer is closed
   */
  constructor(container, apiClient, options = {}) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {Object} */
    this.apiClient = apiClient;

    /** @type {Function|null} */
    this.onClose = options.onClose || null;

    /** @type {Object|null} Entity metadata */
    this._entity = null;

    /** @type {Object[]} Current page records */
    this._records = [];

    /** @type {string[]} Visible column logical names */
    this._visibleColumns = [];

    /** @type {string[]} All available columns from the fetched data */
    this._allColumns = [];

    /** @type {Object[]} Column metadata (if loaded) */
    this._columnMeta = [];

    /** @type {string|null} OData nextLink for pagination */
    this._nextLink = null;

    /** @type {string|null} Previous page link (we maintain a stack) */
    this._pageStack = [];

    /** @type {number} Current page number (1-based) */
    this._currentPage = 1;

    /** @type {number} Total record count (-1 = unknown) */
    this._totalCount = -1;

    /** @type {{ column: string, direction: 'asc'|'desc' }|null} */
    this._sort = null;

    /** @type {Object<string, string>} Per-column quick filters */
    this._columnFilters = {};

    /** @type {boolean} */
    this._loading = false;

    /** @type {string|null} Error message */
    this._error = null;

    /** @type {{ recordId: string, column: string }|null} Currently editing cell */
    this._editingCell = null;

    /** @type {string|null} ID of record shown in detail panel */
    this._selectedRecordId = null;

    /** @type {boolean} Whether the new record form is showing */
    this._showingNewForm = false;

    /** @type {HTMLElement|null} */
    this._root = null;

    this._injectStyles();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Open the record viewer for a specific entity.
   * @param {Object} entity - Entity metadata with at least LogicalName, EntitySetName, PrimaryIdAttribute, PrimaryNameAttribute
   * @param {Object[]} [columnMeta] - Optional column metadata array
   */
  async open(entity, columnMeta) {
    this._entity = entity;
    this._columnMeta = columnMeta || [];
    this._records = [];
    this._nextLink = null;
    this._pageStack = [];
    this._currentPage = 1;
    this._totalCount = -1;
    this._sort = null;
    this._columnFilters = {};
    this._editingCell = null;
    this._selectedRecordId = null;
    this._showingNewForm = false;
    this._error = null;

    this._render();
    await this._loadRecords();
  }

  /**
   * Close and clean up the viewer.
   */
  close() {
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
    if (this.onClose) this.onClose();
  }

  /**
   * Refresh the current page.
   */
  async refresh() {
    await this._loadRecords();
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  /**
   * Build the OData query URL for fetching records.
   * @returns {string}
   */
  _buildQueryUrl() {
    const entitySet = this._entity.EntitySetName;
    const parts = [];

    // Select columns
    if (this._visibleColumns.length > 0) {
      parts.push(`$select=${this._visibleColumns.join(',')}`);
    }

    // Sort
    if (this._sort) {
      parts.push(`$orderby=${this._sort.column} ${this._sort.direction}`);
    }

    // Filters
    const filters = [];
    for (const [col, val] of Object.entries(this._columnFilters)) {
      if (val.trim()) {
        // Use contains for string filters (OData 4.0)
        filters.push(`contains(${col},'${val.replace(/'/g, "''")}')`);
      }
    }
    if (filters.length > 0) {
      parts.push(`$filter=${filters.join(' and ')}`);
    }

    // Count
    parts.push('$count=true');

    // Page size
    parts.push(`$top=${PAGE_SIZE}`);

    const query = parts.length > 0 ? `?${parts.join('&')}` : '';
    return `${entitySet}${query}`;
  }

  /**
   * Load records from the API.
   * @param {string} [url] - Specific URL (for nextLink pagination)
   */
  async _loadRecords(url) {
    this._loading = true;
    this._error = null;
    this._renderBody();

    try {
      const requestUrl = url || this._buildQueryUrl();
      const response = await this.apiClient.request('GET', requestUrl, {
        headers: { Prefer: `odata.maxpagesize=${PAGE_SIZE},odata.include-annotations="*"` },
      });

      const data = response;
      this._records = data.value || [];
      this._nextLink = data['@odata.nextLink'] || null;
      this._totalCount = data['@odata.count'] ?? this._totalCount;

      // Discover columns from the first record if not yet set
      if (this._allColumns.length === 0 && this._records.length > 0) {
        this._discoverColumns(this._records[0]);
      }
    } catch (err) {
      this._error = err.message || 'Failed to load records';
      this._records = [];
    } finally {
      this._loading = false;
      this._render();
    }
  }

  /**
   * Extract column names from a record, filtering out OData annotations.
   * @param {Object} record
   */
  _discoverColumns(record) {
    const skip = new Set(['@odata.etag', '@odata.editLink']);
    const cols = [];

    for (const key of Object.keys(record)) {
      if (key.startsWith('@') || key.includes('@') || skip.has(key)) continue;
      cols.push(key);
    }

    this._allColumns = cols;

    // Default visible: primary ID, primary name, and first few columns
    const pk = this._entity.PrimaryIdAttribute;
    const pn = this._entity.PrimaryNameAttribute;
    const defaults = new Set();
    if (pk) defaults.add(pk);
    if (pn) defaults.add(pn);

    // Add some more columns up to a reasonable default
    for (const col of cols) {
      if (defaults.size >= 8) break;
      defaults.add(col);
    }

    this._visibleColumns = cols.filter((c) => defaults.has(c));
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  _render() {
    if (this._root) this._root.remove();

    const root = document.createElement('div');
    root.className = `${CSS}-panel`;
    this._root = root;

    // Header
    root.appendChild(this._buildHeader());

    // Toolbar
    root.appendChild(this._buildToolbar());

    // Table area
    const tableWrapper = document.createElement('div');
    tableWrapper.className = `${CSS}-table-wrapper`;
    tableWrapper.appendChild(this._buildTable());
    root.appendChild(tableWrapper);

    // Footer / pagination
    root.appendChild(this._buildFooter());

    // Detail panel (shown on record click)
    if (this._selectedRecordId) {
      root.appendChild(this._buildRecordDetail());
    }

    // New record form
    if (this._showingNewForm) {
      root.appendChild(this._buildNewRecordForm());
    }

    this.container.appendChild(root);
  }

  /** Re-render only the table body for performance. */
  _renderBody() {
    if (!this._root) return;
    const existing = this._root.querySelector(`.${CSS}-table-wrapper`);
    if (existing) {
      existing.innerHTML = '';
      existing.appendChild(this._buildTable());
    }
  }

  _buildHeader() {
    const header = document.createElement('div');
    header.className = `${CSS}-header`;

    const title = document.createElement('h3');
    title.className = `${CSS}-title`;
    const dName = this._entity?.DisplayName?.UserLocalizedLabel?.Label || this._entity?.LogicalName || 'Records';
    title.textContent = dName;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = `${CSS}-close-btn`;
    closeBtn.textContent = '\u2715';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    return header;
  }

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = `${CSS}-toolbar`;

    // New record
    const newBtn = document.createElement('button');
    newBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
    newBtn.textContent = '+ New Record';
    newBtn.addEventListener('click', () => {
      this._showingNewForm = true;
      this._render();
    });
    bar.appendChild(newBtn);

    // Refresh
    const refreshBtn = document.createElement('button');
    refreshBtn.className = `${CSS}-btn`;
    refreshBtn.textContent = '\u21BB Refresh';
    refreshBtn.addEventListener('click', () => this.refresh());
    bar.appendChild(refreshBtn);

    // Column picker
    const colBtn = document.createElement('button');
    colBtn.className = `${CSS}-btn`;
    colBtn.textContent = '\u2630 Columns';
    colBtn.addEventListener('click', (e) => this._showColumnPicker(e));
    bar.appendChild(colBtn);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // Export JSON
    const jsonBtn = document.createElement('button');
    jsonBtn.className = `${CSS}-btn`;
    jsonBtn.textContent = '{ } JSON';
    jsonBtn.addEventListener('click', () => this._exportJson());
    bar.appendChild(jsonBtn);

    // Export CSV
    const csvBtn = document.createElement('button');
    csvBtn.className = `${CSS}-btn`;
    csvBtn.textContent = '\uD83D\uDCC4 CSV';
    csvBtn.addEventListener('click', () => this._exportCsv());
    bar.appendChild(csvBtn);

    return bar;
  }

  _buildTable() {
    if (this._loading) {
      return this._buildLoadingSkeleton();
    }
    if (this._error) {
      return this._buildError();
    }
    if (this._records.length === 0) {
      return this._buildEmptyState();
    }

    const table = document.createElement('table');
    table.className = `${CSS}-table`;

    // Thead
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    // Action column
    const actionTh = document.createElement('th');
    actionTh.className = `${CSS}-action-col`;
    actionTh.textContent = '';
    headerRow.appendChild(actionTh);

    for (const col of this._visibleColumns) {
      const th = document.createElement('th');
      th.className = `${CSS}-th`;

      // Sort indicator
      const sortDir = this._sort?.column === col ? this._sort.direction : null;
      const sortIcon = sortDir === 'asc' ? ' \u25B2' : sortDir === 'desc' ? ' \u25BC' : '';

      // Column header with click-to-sort
      const label = document.createElement('span');
      label.className = `${CSS}-th-label`;
      label.textContent = col + sortIcon;
      label.addEventListener('click', () => this._onSort(col));
      th.appendChild(label);

      // Quick filter
      const filterInput = document.createElement('input');
      filterInput.type = 'text';
      filterInput.className = `${CSS}-col-filter`;
      filterInput.placeholder = 'Filter\u2026';
      filterInput.value = this._columnFilters[col] || '';
      filterInput.addEventListener('change', (e) => {
        if (e.target.value.trim()) {
          this._columnFilters[col] = e.target.value;
        } else {
          delete this._columnFilters[col];
        }
        this._currentPage = 1;
        this._pageStack = [];
        this._loadRecords();
      });
      th.appendChild(filterInput);

      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Tbody
    const tbody = document.createElement('tbody');
    for (const record of this._records) {
      tbody.appendChild(this._buildRecordRow(record));
    }
    table.appendChild(tbody);

    return table;
  }

  /**
   * Build a single table row for a record.
   * @param {Object} record
   * @returns {HTMLElement}
   */
  _buildRecordRow(record) {
    const pk = this._entity.PrimaryIdAttribute;
    const recordId = record[pk];
    const tr = document.createElement('tr');
    tr.className = `${CSS}-row`;
    if (recordId === this._selectedRecordId) tr.classList.add('selected');

    // Action cell (delete button)
    const actionTd = document.createElement('td');
    actionTd.className = `${CSS}-action-cell`;
    const delBtn = document.createElement('button');
    delBtn.className = `${CSS}-delete-btn`;
    delBtn.title = 'Delete record';
    delBtn.textContent = '\uD83D\uDDD1';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._deleteRecord(recordId);
    });
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    for (const col of this._visibleColumns) {
      const td = document.createElement('td');
      td.className = `${CSS}-cell`;

      const isEditing = this._editingCell?.recordId === recordId && this._editingCell?.column === col;

      if (isEditing) {
        td.appendChild(this._buildEditCell(record, col));
      } else {
        const displayVal = formatCellValue(record, col);
        td.textContent = displayVal;
        td.title = displayVal;

        // Primary key column is not editable
        if (col !== pk) {
          td.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this._editingCell = { recordId, column: col };
            this._render();
          });
        }
      }

      tr.appendChild(td);
    }

    // Click row to show detail
    tr.addEventListener('click', () => {
      this._selectedRecordId = this._selectedRecordId === recordId ? null : recordId;
      this._render();
    });

    return tr;
  }

  /**
   * Build an inline edit cell.
   * @param {Object} record
   * @param {string} column
   * @returns {HTMLElement}
   */
  _buildEditCell(record, column) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS}-edit-cell`;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = `${CSS}-edit-input`;
    input.value = getRawValue(record, column) ?? '';

    const saveBtn = document.createElement('button');
    saveBtn.className = `${CSS}-btn-sm ${CSS}-btn-save`;
    saveBtn.textContent = '\u2713';
    saveBtn.title = 'Save';
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._saveCell(record, column, input.value);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = `${CSS}-btn-sm ${CSS}-btn-cancel`;
    cancelBtn.textContent = '\u2715';
    cancelBtn.title = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._editingCell = null;
      this._render();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._saveCell(record, column, input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._editingCell = null;
        this._render();
      }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(saveBtn);
    wrapper.appendChild(cancelBtn);

    // Focus the input after DOM insertion
    requestAnimationFrame(() => input.focus());

    return wrapper;
  }

  _buildFooter() {
    const footer = document.createElement('div');
    footer.className = `${CSS}-footer`;

    // Record count
    const countSpan = document.createElement('span');
    const countText = this._totalCount >= 0
      ? `${this._records.length} of ${this._totalCount} records`
      : `${this._records.length} records`;
    countSpan.textContent = `Page ${this._currentPage} \u2022 ${countText}`;
    footer.appendChild(countSpan);

    const nav = document.createElement('div');
    nav.className = `${CSS}-pagination`;

    // Previous
    const prevBtn = document.createElement('button');
    prevBtn.className = `${CSS}-btn`;
    prevBtn.textContent = '\u25C0 Previous';
    prevBtn.disabled = this._pageStack.length === 0;
    prevBtn.addEventListener('click', () => this._goToPrevPage());
    nav.appendChild(prevBtn);

    // Next
    const nextBtn = document.createElement('button');
    nextBtn.className = `${CSS}-btn`;
    nextBtn.textContent = 'Next \u25B6';
    nextBtn.disabled = !this._nextLink;
    nextBtn.addEventListener('click', () => this._goToNextPage());
    nav.appendChild(nextBtn);

    footer.appendChild(nav);
    return footer;
  }

  _buildLoadingSkeleton() {
    const skeleton = document.createElement('div');
    skeleton.className = `${CSS}-skeleton`;
    for (let i = 0; i < 8; i++) {
      const row = document.createElement('div');
      row.className = `${CSS}-skeleton-row`;
      for (let j = 0; j < 4; j++) {
        const cell = document.createElement('div');
        cell.className = `${CSS}-skeleton-cell`;
        row.appendChild(cell);
      }
      skeleton.appendChild(row);
    }
    return skeleton;
  }

  _buildError() {
    const el = document.createElement('div');
    el.className = `${CSS}-error`;

    const msg = document.createElement('p');
    msg.textContent = this._error;
    el.appendChild(msg);

    const retryBtn = document.createElement('button');
    retryBtn.className = `${CSS}-btn`;
    retryBtn.textContent = '\u21BB Retry';
    retryBtn.addEventListener('click', () => this._loadRecords());
    el.appendChild(retryBtn);

    return el;
  }

  _buildEmptyState() {
    const el = document.createElement('div');
    el.className = `${CSS}-empty`;
    el.innerHTML = '<p>No records found.</p>';
    return el;
  }

  /** Build a detail panel showing the full JSON of a selected record. */
  _buildRecordDetail() {
    const record = this._records.find(
      (r) => r[this._entity.PrimaryIdAttribute] === this._selectedRecordId
    );
    if (!record) return document.createElement('div');

    const panel = document.createElement('div');
    panel.className = `${CSS}-record-detail`;

    const header = document.createElement('div');
    header.className = `${CSS}-detail-header`;

    const title = document.createElement('h4');
    title.textContent = 'Record Detail';
    header.appendChild(title);

    const copyBtn = document.createElement('button');
    copyBtn.className = `${CSS}-btn`;
    copyBtn.textContent = 'Copy JSON';
    copyBtn.addEventListener('click', async () => {
      await copyToClipboard(JSON.stringify(record, null, 2));
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 1500);
    });
    header.appendChild(copyBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = `${CSS}-btn`;
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', () => {
      this._selectedRecordId = null;
      this._render();
    });
    header.appendChild(closeBtn);

    panel.appendChild(header);

    const pre = document.createElement('pre');
    pre.className = `${CSS}-json`;
    pre.textContent = JSON.stringify(record, null, 2);
    panel.appendChild(pre);

    return panel;
  }

  /** Build a simple new record creation form. */
  _buildNewRecordForm() {
    const overlay = document.createElement('div');
    overlay.className = `${CSS}-overlay`;

    const form = document.createElement('div');
    form.className = `${CSS}-new-form`;

    const title = document.createElement('h3');
    title.textContent = `New ${this._entity.LogicalName} Record`;
    form.appendChild(title);

    const fieldsContainer = document.createElement('div');
    fieldsContainer.className = `${CSS}-form-fields`;

    // Build fields from visible columns (skip PK)
    const pk = this._entity.PrimaryIdAttribute;
    const editableColumns = this._visibleColumns.filter((c) => c !== pk);
    const inputs = {};

    for (const col of editableColumns) {
      const fieldRow = document.createElement('div');
      fieldRow.className = `${CSS}-form-row`;

      const label = document.createElement('label');
      label.textContent = col;
      label.className = `${CSS}-form-label`;
      fieldRow.appendChild(label);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = `${CSS}-form-input`;
      input.placeholder = col;
      fieldRow.appendChild(input);

      inputs[col] = input;
      fieldsContainer.appendChild(fieldRow);
    }

    form.appendChild(fieldsContainer);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.className = `${CSS}-form-buttons`;

    const saveBtn = document.createElement('button');
    saveBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
    saveBtn.textContent = 'Create';
    saveBtn.addEventListener('click', async () => {
      const data = {};
      for (const [col, input] of Object.entries(inputs)) {
        const val = input.value.trim();
        if (val) data[col] = val;
      }
      await this._createRecord(data);
      this._showingNewForm = false;
      this._render();
    });
    btnRow.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = `${CSS}-btn`;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      this._showingNewForm = false;
      this._render();
    });
    btnRow.appendChild(cancelBtn);

    form.appendChild(btnRow);
    overlay.appendChild(form);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this._showingNewForm = false;
        this._render();
      }
    });

    return overlay;
  }

  // -------------------------------------------------------------------------
  // Column picker
  // -------------------------------------------------------------------------

  /**
   * Show a dropdown column picker near the button.
   * @param {MouseEvent} event
   */
  _showColumnPicker(event) {
    // Remove existing picker
    const existing = this._root?.querySelector(`.${CSS}-col-picker`);
    if (existing) { existing.remove(); return; }

    const picker = document.createElement('div');
    picker.className = `${CSS}-col-picker`;

    for (const col of this._allColumns) {
      const row = document.createElement('label');
      row.className = `${CSS}-col-picker-row`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this._visibleColumns.includes(col);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!this._visibleColumns.includes(col)) this._visibleColumns.push(col);
        } else {
          this._visibleColumns = this._visibleColumns.filter((c) => c !== col);
        }
        this._render();
      });
      row.appendChild(checkbox);

      const text = document.createElement('span');
      text.textContent = col;
      row.appendChild(text);

      picker.appendChild(row);
    }

    // Position relative to button
    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();
    const rootRect = this._root.getBoundingClientRect();
    picker.style.position = 'absolute';
    picker.style.top = `${rect.bottom - rootRect.top}px`;
    picker.style.left = `${rect.left - rootRect.left}px`;

    this._root.style.position = 'relative';
    this._root.appendChild(picker);

    // Close on outside click
    const closeHandler = (e) => {
      if (!picker.contains(e.target) && e.target !== btn) {
        picker.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  // -------------------------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------------------------

  /**
   * Save an inline-edited cell value.
   * @param {Object} record
   * @param {string} column
   * @param {string} newValue
   */
  async _saveCell(record, column, newValue) {
    const pk = this._entity.PrimaryIdAttribute;
    const recordId = record[pk];
    const entitySet = this._entity.EntitySetName;

    try {
      await this.apiClient.request('PATCH', `${entitySet}(${recordId})`, {
        body: { [column]: newValue || null },
      });

      // Look up the live record by ID in case the list was re-fetched since edit started
      const liveRecord = this._records.find((r) => r[pk] === recordId);
      if (liveRecord) liveRecord[column] = newValue || null;
      this._editingCell = null;
      this._render();
    } catch (err) {
      alert(`Failed to save: ${err.message}`);
    }
  }

  /**
   * Create a new record.
   * @param {Object} data - Record data
   */
  async _createRecord(data) {
    const entitySet = this._entity.EntitySetName;

    try {
      const response = await this.apiClient.request('POST', entitySet, { body: data });

      // Reload the current page to show the new record
      await this._loadRecords();
    } catch (err) {
      alert(`Failed to create record: ${err.message}`);
    }
  }

  /**
   * Delete a record with confirmation.
   * @param {string} recordId
   */
  async _deleteRecord(recordId) {
    const confirmed = confirm(`Are you sure you want to delete this record?\n\nID: ${recordId}`);
    if (!confirmed) return;

    const entitySet = this._entity.EntitySetName;

    try {
      const response = await this.apiClient.request('DELETE', `${entitySet}(${recordId})`);

      // Remove from local list and re-render
      const pk = this._entity.PrimaryIdAttribute;
      this._records = this._records.filter((r) => r[pk] !== recordId);
      if (this._selectedRecordId === recordId) this._selectedRecordId = null;
      this._render();
    } catch (err) {
      alert(`Failed to delete record: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Sorting & Pagination
  // -------------------------------------------------------------------------

  /**
   * Handle sort click on a column header.
   * @param {string} column
   */
  _onSort(column) {
    if (this._sort?.column === column) {
      this._sort.direction = this._sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this._sort = { column, direction: 'asc' };
    }
    this._currentPage = 1;
    this._pageStack = [];
    this._loadRecords();
  }

  _goToNextPage() {
    if (!this._nextLink) return;
    this._pageStack.push(this._buildQueryUrl());
    this._currentPage++;
    this._loadRecords(this._nextLink);
  }

  _goToPrevPage() {
    if (this._pageStack.length === 0) return;
    const prevUrl = this._pageStack.pop();
    this._currentPage--;
    this._loadRecords(prevUrl);
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  _exportJson() {
    const json = JSON.stringify(this._records, null, 2);
    const name = this._entity?.LogicalName || 'records';
    downloadFile(json, `${name}.json`, 'application/json');
  }

  _exportCsv() {
    const csv = toCsv(this._records, this._visibleColumns);
    const name = this._entity?.LogicalName || 'records';
    downloadFile(csv, `${name}.csv`, 'text/csv');
  }

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById(`${CSS}-styles`)) return;

    const style = document.createElement('style');
    style.id = `${CSS}-styles`;
    style.textContent = `
      .${CSS}-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: var(--dvt-text, #1e1e1e);
        background: var(--dvt-bg, #ffffff);
        overflow: hidden;
      }
      .${CSS}-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--dvt-border, #e0e0e0);
        flex-shrink: 0;
      }
      .${CSS}-title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .${CSS}-close-btn {
        background: none;
        border: none;
        font-size: 16px;
        cursor: pointer;
        color: var(--dvt-muted, #888);
        padding: 2px 6px;
        border-radius: 4px;
      }
      .${CSS}-close-btn:hover {
        background: var(--dvt-hover, #f0f0f0);
        color: var(--dvt-text, #1e1e1e);
      }
      .${CSS}-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--dvt-border, #e0e0e0);
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .${CSS}-btn {
        padding: 4px 10px;
        border: 1px solid var(--dvt-border, #d0d0d0);
        border-radius: 4px;
        background: var(--dvt-input-bg, #f9f9f9);
        cursor: pointer;
        font-size: 11px;
        color: inherit;
        white-space: nowrap;
      }
      .${CSS}-btn:hover:not(:disabled) {
        background: var(--dvt-hover, #e8e8e8);
      }
      .${CSS}-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .${CSS}-btn-primary {
        background: var(--dvt-accent, #0078d4);
        color: #fff;
        border-color: var(--dvt-accent, #0078d4);
      }
      .${CSS}-btn-primary:hover {
        background: #006abc;
      }
      .${CSS}-table-wrapper {
        flex: 1;
        overflow: auto;
      }
      .${CSS}-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: auto;
      }
      .${CSS}-th {
        position: sticky;
        top: 0;
        background: var(--dvt-section-bg, #f5f5f5);
        border-bottom: 2px solid var(--dvt-border, #d0d0d0);
        padding: 0;
        text-align: left;
        z-index: 1;
      }
      .${CSS}-th-label {
        display: block;
        padding: 6px 8px 2px;
        cursor: pointer;
        font-weight: 600;
        font-size: 11px;
        white-space: nowrap;
        user-select: none;
      }
      .${CSS}-th-label:hover {
        color: var(--dvt-accent, #0078d4);
      }
      .${CSS}-col-filter {
        display: block;
        width: calc(100% - 12px);
        margin: 2px 6px 4px;
        padding: 2px 4px;
        border: 1px solid var(--dvt-border, #e0e0e0);
        border-radius: 3px;
        font-size: 10px;
        outline: none;
        background: var(--dvt-bg, #fff);
        color: inherit;
        box-sizing: border-box;
      }
      .${CSS}-col-filter:focus {
        border-color: var(--dvt-accent, #0078d4);
      }
      .${CSS}-action-col {
        width: 30px;
        position: sticky;
        top: 0;
        background: var(--dvt-section-bg, #f5f5f5);
        border-bottom: 2px solid var(--dvt-border, #d0d0d0);
        z-index: 1;
      }
      .${CSS}-action-cell {
        width: 30px;
        text-align: center;
        padding: 2px;
      }
      .${CSS}-delete-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 12px;
        opacity: 0;
        transition: opacity 0.1s;
        padding: 2px;
      }
      .${CSS}-row:hover .${CSS}-delete-btn {
        opacity: 0.5;
      }
      .${CSS}-delete-btn:hover {
        opacity: 1 !important;
        color: #c62828;
      }
      .${CSS}-row {
        border-bottom: 1px solid var(--dvt-row-border, #f0f0f0);
        cursor: pointer;
        transition: background 0.1s;
      }
      .${CSS}-row:hover {
        background: var(--dvt-hover, #f0f6ff);
      }
      .${CSS}-row.selected {
        background: var(--dvt-selected, #e1efff);
      }
      .${CSS}-cell {
        padding: 5px 8px;
        max-width: 250px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-right: 1px solid var(--dvt-row-border, #f0f0f0);
      }
      .${CSS}-edit-cell {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .${CSS}-edit-input {
        flex: 1;
        padding: 2px 4px;
        border: 1px solid var(--dvt-accent, #0078d4);
        border-radius: 3px;
        font-size: 12px;
        outline: none;
        min-width: 60px;
        color: inherit;
        background: var(--dvt-bg, #fff);
      }
      .${CSS}-btn-sm {
        padding: 2px 6px;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
        background: var(--dvt-input-bg, #f0f0f0);
      }
      .${CSS}-btn-save {
        color: #2e7d32;
      }
      .${CSS}-btn-save:hover {
        background: #e8f5e9;
      }
      .${CSS}-btn-cancel {
        color: #c62828;
      }
      .${CSS}-btn-cancel:hover {
        background: #fce4ec;
      }
      .${CSS}-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        border-top: 1px solid var(--dvt-border, #e0e0e0);
        font-size: 11px;
        color: var(--dvt-muted, #666);
        flex-shrink: 0;
      }
      .${CSS}-pagination {
        display: flex;
        gap: 6px;
      }

      /* Record detail panel */
      .${CSS}-record-detail {
        border-top: 1px solid var(--dvt-border, #e0e0e0);
        max-height: 300px;
        overflow-y: auto;
        flex-shrink: 0;
      }
      .${CSS}-detail-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--dvt-border, #e0e0e0);
        background: var(--dvt-section-bg, #f5f5f5);
      }
      .${CSS}-detail-header h4 {
        margin: 0;
        flex: 1;
        font-size: 12px;
      }
      .${CSS}-json {
        margin: 0;
        padding: 8px 12px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--dvt-code-bg, #f9f9f9);
      }

      /* Column picker */
      .${CSS}-col-picker {
        background: var(--dvt-bg, #fff);
        border: 1px solid var(--dvt-border, #d0d0d0);
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        padding: 8px;
        max-height: 300px;
        overflow-y: auto;
        z-index: 100;
        min-width: 180px;
      }
      .${CSS}-col-picker-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 4px;
        cursor: pointer;
        border-radius: 3px;
        font-size: 11px;
      }
      .${CSS}-col-picker-row:hover {
        background: var(--dvt-hover, #f0f6ff);
      }

      /* Loading skeleton */
      .${CSS}-skeleton {
        padding: 12px;
      }
      .${CSS}-skeleton-row {
        display: flex;
        gap: 12px;
        margin-bottom: 8px;
      }
      .${CSS}-skeleton-cell {
        flex: 1;
        height: 20px;
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: ${CSS}-shimmer 1.5s infinite;
        border-radius: 4px;
      }
      @keyframes ${CSS}-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* Error & empty states */
      .${CSS}-error, .${CSS}-empty {
        padding: 32px 16px;
        text-align: center;
        color: var(--dvt-muted, #888);
      }
      .${CSS}-error p {
        color: #c62828;
        margin: 0 0 12px;
      }

      /* New record form overlay */
      .${CSS}-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 200;
      }
      .${CSS}-new-form {
        background: var(--dvt-bg, #fff);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        padding: 20px;
        min-width: 360px;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
      }
      .${CSS}-new-form h3 {
        margin: 0 0 16px;
        font-size: 14px;
      }
      .${CSS}-form-fields {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
      }
      .${CSS}-form-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .${CSS}-form-label {
        width: 120px;
        font-size: 11px;
        font-weight: 500;
        flex-shrink: 0;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${CSS}-form-input {
        flex: 1;
        padding: 5px 8px;
        border: 1px solid var(--dvt-border, #d0d0d0);
        border-radius: 4px;
        font-size: 12px;
        outline: none;
        color: inherit;
        background: var(--dvt-input-bg, #f9f9f9);
      }
      .${CSS}-form-input:focus {
        border-color: var(--dvt-accent, #0078d4);
      }
      .${CSS}-form-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
    `;
    document.head.appendChild(style);
  }
}

export { RecordViewer };
export default RecordViewer;
