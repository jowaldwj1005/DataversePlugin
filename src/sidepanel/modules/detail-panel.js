/**
 * Dataverse Toolkit - Detail Panel Module
 *
 * A reusable property-grid panel for displaying metadata details about
 * entities, attributes, relationships, and other Dataverse schema objects.
 * Supports collapsible sections, multiple value types, search/filter,
 * copy-to-clipboard, and toggling between pretty and raw JSON views.
 *
 * @module detail-panel
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @enum {string} Value display types */
const VALUE_TYPES = Object.freeze({
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  JSON: 'json',
  ARRAY: 'array',
  LINK: 'link',
  DATE: 'date',
  BADGE: 'badge',
});

const CSS_PREFIX = 'dvt-detail';

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Escape HTML entities to prevent XSS when inserting user-provided values.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Truncate a string to maxLen, appending ellipsis if truncated.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen = 120) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\u2026';
}

/**
 * Copy text to the clipboard, returning true on success.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts where navigator.clipboard is unavailable
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* noop */ }
    document.body.removeChild(ta);
    return ok;
  }
}

/**
 * Detect the appropriate VALUE_TYPE for a given value.
 * @param {*} value
 * @returns {string}
 */
function inferType(value) {
  if (value === null || value === undefined) return VALUE_TYPES.STRING;
  if (typeof value === 'boolean') return VALUE_TYPES.BOOLEAN;
  if (typeof value === 'number') return VALUE_TYPES.NUMBER;
  if (Array.isArray(value)) return VALUE_TYPES.ARRAY;
  if (typeof value === 'object') return VALUE_TYPES.JSON;
  if (typeof value === 'string' && /^https?:\/\//.test(value)) return VALUE_TYPES.LINK;
  return VALUE_TYPES.STRING;
}

// ---------------------------------------------------------------------------
// DetailPanel class
// ---------------------------------------------------------------------------

/**
 * A reusable detail/property panel that displays key-value metadata
 * in a clean, searchable, copy-friendly grid layout.
 */
class DetailPanel {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} [options]
   * @param {string} [options.title] - Panel header title
   * @param {boolean} [options.collapsible=true] - Whether sections are collapsible
   * @param {boolean} [options.showSearch=true] - Show the search/filter input
   * @param {'pretty'|'raw'} [options.defaultView='pretty'] - Initial view mode
   */
  constructor(container, options = {}) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {Object} */
    this.options = {
      title: '',
      collapsible: true,
      showSearch: true,
      defaultView: 'pretty',
      ...options,
    };

    /** @type {'pretty'|'raw'} */
    this._viewMode = this.options.defaultView;

    /**
     * Sections to render. Each section has a title and an array of property
     * entries: { key, value, type?, label?, isCustom?, copyValue? }
     * @type {Array<{ title: string, collapsed?: boolean, entries: Array<DetailEntry> }>}
     */
    this._sections = [];

    /** Raw data object for the "Raw JSON" view */
    this._rawData = null;

    /** Current search filter text */
    this._filterText = '';

    /** @type {HTMLElement|null} */
    this._root = null;

    this._injectStyles();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Set the data to display. Accepts either pre-structured sections or a
   * flat object (which will be auto-grouped into a single section).
   *
   * @param {Object} data
   * @param {Array<{ title: string, collapsed?: boolean, entries: Array<{key: string, value: *, type?: string, label?: string, isCustom?: boolean, copyValue?: string}> }>} [data.sections]
   *   Pre-structured section array.
   * @param {Object} [data.properties] - Flat key-value map (auto-grouped).
   * @param {Object} [data.raw] - Raw data object for the JSON view.
   * @param {string} [data.title] - Override the panel title.
   */
  setData(data) {
    if (!data) {
      this._sections = [];
      this._rawData = null;
      this._render();
      return;
    }

    if (data.title) this.options.title = data.title;
    this._rawData = data.raw ?? data.properties ?? null;

    if (data.sections) {
      this._sections = data.sections.map((s) => ({
        title: s.title,
        collapsed: s.collapsed ?? false,
        entries: s.entries.map((e) => ({
          ...e,
          type: e.type || inferType(e.value),
        })),
      }));
    } else if (data.properties) {
      this._sections = [
        {
          title: data.title || 'Properties',
          collapsed: false,
          entries: Object.entries(data.properties).map(([key, value]) => ({
            key,
            value,
            type: inferType(value),
            label: key,
            isCustom: false,
          })),
        },
      ];
    }

    this._render();
  }

  /**
   * Render (or re-render) the panel into its container.
   */
  render() {
    this._render();
  }

  /**
   * Remove the panel from the DOM and clean up listeners.
   */
  destroy() {
    if (this._root) {
      this._root.remove();
      this._root = null;
    }
  }

  /**
   * Clear all displayed data and show an empty state.
   */
  clear() {
    this._sections = [];
    this._rawData = null;
    this._filterText = '';
    this._render();
  }

  /**
   * Switch between 'pretty' and 'raw' view modes.
   * @param {'pretty'|'raw'} mode
   */
  setViewMode(mode) {
    if (mode !== 'pretty' && mode !== 'raw') return;
    this._viewMode = mode;
    this._render();
  }

  // -------------------------------------------------------------------------
  // Internal rendering
  // -------------------------------------------------------------------------

  /** Main render entry point */
  _render() {
    if (this._root) {
      this._root.remove();
    }

    const root = document.createElement('div');
    root.className = `${CSS_PREFIX}-panel`;
    this._root = root;

    // Header
    root.appendChild(this._buildHeader());

    // Body
    const body = document.createElement('div');
    body.className = `${CSS_PREFIX}-body`;

    if (this._sections.length === 0 && !this._rawData) {
      body.appendChild(this._buildEmptyState());
    } else if (this._viewMode === 'raw') {
      body.appendChild(this._buildRawView());
    } else {
      this._buildPrettyView(body);
    }

    root.appendChild(body);
    this.container.appendChild(root);
  }

  /** Build the panel header with title, search, and view toggle. */
  _buildHeader() {
    const header = document.createElement('div');
    header.className = `${CSS_PREFIX}-header`;

    // Title
    if (this.options.title) {
      const title = document.createElement('h3');
      title.className = `${CSS_PREFIX}-title`;
      title.textContent = this.options.title;
      header.appendChild(title);
    }

    const controls = document.createElement('div');
    controls.className = `${CSS_PREFIX}-controls`;

    // Search input
    if (this.options.showSearch && this._sections.length > 0) {
      const search = document.createElement('input');
      search.type = 'text';
      search.placeholder = 'Filter properties\u2026';
      search.className = `${CSS_PREFIX}-search`;
      search.value = this._filterText;
      search.addEventListener('input', (e) => {
        this._filterText = e.target.value.toLowerCase();
        this._updateVisibility();
      });
      controls.appendChild(search);
    }

    // View mode toggle
    if (this._rawData) {
      const toggle = document.createElement('div');
      toggle.className = `${CSS_PREFIX}-view-toggle`;

      const prettyBtn = document.createElement('button');
      prettyBtn.textContent = 'Pretty';
      prettyBtn.className = this._viewMode === 'pretty' ? 'active' : '';
      prettyBtn.addEventListener('click', () => this.setViewMode('pretty'));

      const rawBtn = document.createElement('button');
      rawBtn.textContent = 'Raw JSON';
      rawBtn.className = this._viewMode === 'raw' ? 'active' : '';
      rawBtn.addEventListener('click', () => this.setViewMode('raw'));

      toggle.appendChild(prettyBtn);
      toggle.appendChild(rawBtn);
      controls.appendChild(toggle);
    }

    header.appendChild(controls);
    return header;
  }

  /** Build the pretty (property grid) view. */
  _buildPrettyView(container) {
    for (const section of this._sections) {
      container.appendChild(this._buildSection(section));
    }
  }

  /**
   * Build a single collapsible section.
   * @param {{ title: string, collapsed: boolean, entries: Array }} section
   * @returns {HTMLElement}
   */
  _buildSection(section) {
    const sectionEl = document.createElement('div');
    sectionEl.className = `${CSS_PREFIX}-section`;
    if (section.collapsed) sectionEl.classList.add('collapsed');

    // Section header
    if (this.options.collapsible) {
      const header = document.createElement('div');
      header.className = `${CSS_PREFIX}-section-header`;
      header.innerHTML = `<span class="${CSS_PREFIX}-chevron">\u25B6</span> ${escapeHtml(section.title)}`;
      header.addEventListener('click', () => {
        section.collapsed = !section.collapsed;
        sectionEl.classList.toggle('collapsed', section.collapsed);
      });
      sectionEl.appendChild(header);
    } else {
      const header = document.createElement('div');
      header.className = `${CSS_PREFIX}-section-header no-collapse`;
      header.textContent = section.title;
      sectionEl.appendChild(header);
    }

    // Entries table
    const table = document.createElement('div');
    table.className = `${CSS_PREFIX}-table`;

    for (const entry of section.entries) {
      table.appendChild(this._buildRow(entry));
    }

    sectionEl.appendChild(table);
    return sectionEl;
  }

  /**
   * Build a single property row.
   * @param {Object} entry
   * @returns {HTMLElement}
   */
  _buildRow(entry) {
    const row = document.createElement('div');
    row.className = `${CSS_PREFIX}-row`;
    row.dataset.key = (entry.key || '').toLowerCase();
    row.dataset.label = (entry.label || entry.key || '').toLowerCase();

    if (entry.isCustom) {
      row.classList.add('custom-prop');
    }

    // Key cell
    const keyCell = document.createElement('div');
    keyCell.className = `${CSS_PREFIX}-key`;
    keyCell.textContent = entry.label || entry.key;
    if (entry.isCustom) {
      const badge = document.createElement('span');
      badge.className = `${CSS_PREFIX}-badge custom`;
      badge.textContent = 'Custom';
      keyCell.appendChild(badge);
    }
    row.appendChild(keyCell);

    // Value cell
    const valueCell = document.createElement('div');
    valueCell.className = `${CSS_PREFIX}-value`;
    valueCell.appendChild(this._renderValue(entry));

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = `${CSS_PREFIX}-copy-btn`;
    copyBtn.title = 'Copy value';
    copyBtn.textContent = '\uD83D\uDCCB';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = entry.copyValue ?? this._getPlainValue(entry);
      const ok = await copyToClipboard(text);
      if (ok) {
        copyBtn.textContent = '\u2705';
        setTimeout(() => { copyBtn.textContent = '\uD83D\uDCCB'; }, 1200);
      }
    });
    valueCell.appendChild(copyBtn);

    row.appendChild(valueCell);
    return row;
  }

  /**
   * Render the value portion of a property row based on its type.
   * @param {Object} entry
   * @returns {HTMLElement}
   */
  _renderValue(entry) {
    const { type, value } = entry;
    const span = document.createElement('span');
    span.className = `${CSS_PREFIX}-val ${CSS_PREFIX}-val-${type}`;

    switch (type) {
      case VALUE_TYPES.BOOLEAN: {
        const toggle = document.createElement('span');
        toggle.className = `${CSS_PREFIX}-bool ${value ? 'true' : 'false'}`;
        toggle.textContent = value ? 'true' : 'false';
        span.appendChild(toggle);
        break;
      }

      case VALUE_TYPES.NUMBER:
        span.textContent = value == null ? '\u2014' : String(value);
        break;

      case VALUE_TYPES.LINK: {
        const a = document.createElement('a');
        a.href = value;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = truncate(value, 80);
        a.title = value;
        span.appendChild(a);
        break;
      }

      case VALUE_TYPES.DATE:
        try {
          const d = new Date(value);
          span.textContent = isNaN(d.getTime()) ? String(value) : d.toLocaleString();
        } catch {
          span.textContent = String(value);
        }
        break;

      case VALUE_TYPES.ARRAY: {
        if (!Array.isArray(value) || value.length === 0) {
          span.textContent = '(empty)';
          break;
        }
        const list = document.createElement('ul');
        list.className = `${CSS_PREFIX}-list`;
        for (const item of value) {
          const li = document.createElement('li');
          li.textContent = typeof item === 'object' ? JSON.stringify(item) : String(item);
          list.appendChild(li);
        }
        span.appendChild(list);
        break;
      }

      case VALUE_TYPES.JSON: {
        const wrapper = document.createElement('div');
        wrapper.className = `${CSS_PREFIX}-json-wrapper collapsed`;

        const preview = document.createElement('span');
        preview.className = `${CSS_PREFIX}-json-preview`;
        preview.textContent = truncate(JSON.stringify(value), 60);
        wrapper.appendChild(preview);

        const full = document.createElement('pre');
        full.className = `${CSS_PREFIX}-json-full`;
        full.textContent = JSON.stringify(value, null, 2);
        wrapper.appendChild(full);

        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          wrapper.classList.toggle('collapsed');
        });

        span.appendChild(wrapper);
        break;
      }

      case VALUE_TYPES.BADGE: {
        const badge = document.createElement('span');
        badge.className = `${CSS_PREFIX}-badge ${entry.badgeClass || ''}`;
        badge.textContent = value == null ? '\u2014' : String(value);
        span.appendChild(badge);
        break;
      }

      default:
        span.textContent = value == null ? '\u2014' : String(value);
        break;
    }

    return span;
  }

  /** Build the raw JSON view. */
  _buildRawView() {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS_PREFIX}-raw`;

    const copyAll = document.createElement('button');
    copyAll.className = `${CSS_PREFIX}-copy-all`;
    copyAll.textContent = 'Copy JSON';
    copyAll.addEventListener('click', async () => {
      const text = JSON.stringify(this._rawData, null, 2);
      const ok = await copyToClipboard(text);
      if (ok) {
        copyAll.textContent = 'Copied!';
        setTimeout(() => { copyAll.textContent = 'Copy JSON'; }, 1500);
      }
    });
    wrapper.appendChild(copyAll);

    const pre = document.createElement('pre');
    pre.className = `${CSS_PREFIX}-raw-json`;
    pre.textContent = JSON.stringify(this._rawData, null, 2);
    wrapper.appendChild(pre);

    return wrapper;
  }

  /** Build the empty-state placeholder. */
  _buildEmptyState() {
    const el = document.createElement('div');
    el.className = `${CSS_PREFIX}-empty`;
    el.innerHTML = `<p>Select an item in the tree to view its details.</p>`;
    return el;
  }

  /**
   * Update row visibility based on the current filter text.
   * Called on search input changes instead of full re-render.
   */
  _updateVisibility() {
    if (!this._root) return;
    const rows = this._root.querySelectorAll(`.${CSS_PREFIX}-row`);
    const filter = this._filterText;

    for (const row of rows) {
      if (!filter) {
        row.style.display = '';
        continue;
      }
      const key = row.dataset.key || '';
      const label = row.dataset.label || '';
      const valueText = (row.querySelector(`.${CSS_PREFIX}-value`)?.textContent || '').toLowerCase();
      const matches = key.includes(filter) || label.includes(filter) || valueText.includes(filter);
      row.style.display = matches ? '' : 'none';
    }
  }

  /**
   * Get a plain-text representation of a value for clipboard copy.
   * @param {Object} entry
   * @returns {string}
   */
  _getPlainValue(entry) {
    const { value, type } = entry;
    if (value == null) return '';
    if (type === VALUE_TYPES.JSON || type === VALUE_TYPES.ARRAY) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  // -------------------------------------------------------------------------
  // Styles (injected once)
  // -------------------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById(`${CSS_PREFIX}-styles`)) return;

    const style = document.createElement('style');
    style.id = `${CSS_PREFIX}-styles`;
    style.textContent = `
      .${CSS_PREFIX}-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: var(--dvt-text, #1e1e1e);
        background: var(--dvt-bg, #ffffff);
        overflow: hidden;
      }
      .${CSS_PREFIX}-header {
        padding: 8px 12px;
        border-bottom: 1px solid var(--dvt-border, #e0e0e0);
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-title {
        margin: 0 0 6px 0;
        font-size: 13px;
        font-weight: 600;
      }
      .${CSS_PREFIX}-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .${CSS_PREFIX}-search {
        flex: 1;
        padding: 4px 8px;
        border: 1px solid var(--dvt-border, #d0d0d0);
        border-radius: 4px;
        font-size: 11px;
        outline: none;
        background: var(--dvt-input-bg, #f9f9f9);
        color: inherit;
      }
      .${CSS_PREFIX}-search:focus {
        border-color: var(--dvt-accent, #0078d4);
        box-shadow: 0 0 0 1px var(--dvt-accent, #0078d4);
      }
      .${CSS_PREFIX}-view-toggle {
        display: flex;
        border: 1px solid var(--dvt-border, #d0d0d0);
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-view-toggle button {
        padding: 3px 10px;
        border: none;
        background: var(--dvt-input-bg, #f5f5f5);
        font-size: 11px;
        cursor: pointer;
        color: inherit;
      }
      .${CSS_PREFIX}-view-toggle button.active {
        background: var(--dvt-accent, #0078d4);
        color: #fff;
      }
      .${CSS_PREFIX}-view-toggle button:not(:last-child) {
        border-right: 1px solid var(--dvt-border, #d0d0d0);
      }
      .${CSS_PREFIX}-body {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .${CSS_PREFIX}-section {
        border-bottom: 1px solid var(--dvt-border, #e8e8e8);
      }
      .${CSS_PREFIX}-section-header {
        padding: 6px 12px;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        background: var(--dvt-section-bg, #f5f5f5);
        cursor: pointer;
        user-select: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .${CSS_PREFIX}-section-header.no-collapse {
        cursor: default;
      }
      .${CSS_PREFIX}-chevron {
        display: inline-block;
        font-size: 8px;
        transition: transform 0.15s ease;
      }
      .${CSS_PREFIX}-section:not(.collapsed) .${CSS_PREFIX}-chevron {
        transform: rotate(90deg);
      }
      .${CSS_PREFIX}-section.collapsed .${CSS_PREFIX}-table {
        display: none;
      }
      .${CSS_PREFIX}-table {
        display: table;
        width: 100%;
      }
      .${CSS_PREFIX}-row {
        display: flex;
        border-bottom: 1px solid var(--dvt-row-border, #f0f0f0);
        transition: background 0.1s;
      }
      .${CSS_PREFIX}-row:hover {
        background: var(--dvt-hover, #f0f6ff);
      }
      .${CSS_PREFIX}-row.custom-prop .${CSS_PREFIX}-key {
        color: var(--dvt-custom-color, #6a1b9a);
      }
      .${CSS_PREFIX}-key {
        width: 40%;
        min-width: 120px;
        padding: 5px 8px 5px 16px;
        font-weight: 500;
        color: var(--dvt-key-color, #444);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        word-break: break-word;
      }
      .${CSS_PREFIX}-value {
        flex: 1;
        padding: 5px 8px;
        display: flex;
        align-items: flex-start;
        gap: 4px;
        word-break: break-word;
        position: relative;
      }
      .${CSS_PREFIX}-copy-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 11px;
        padding: 0 2px;
        opacity: 0;
        transition: opacity 0.15s;
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-row:hover .${CSS_PREFIX}-copy-btn {
        opacity: 0.6;
      }
      .${CSS_PREFIX}-copy-btn:hover {
        opacity: 1 !important;
      }
      .${CSS_PREFIX}-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 600;
        background: var(--dvt-badge-bg, #e8e8e8);
        color: var(--dvt-badge-color, #555);
      }
      .${CSS_PREFIX}-badge.custom {
        background: #f3e5f5;
        color: #6a1b9a;
      }
      .${CSS_PREFIX}-val-boolean .${CSS_PREFIX}-bool {
        padding: 1px 8px;
        border-radius: 3px;
        font-size: 11px;
        font-weight: 600;
      }
      .${CSS_PREFIX}-bool.true {
        background: #e8f5e9;
        color: #2e7d32;
      }
      .${CSS_PREFIX}-bool.false {
        background: #fce4ec;
        color: #c62828;
      }
      .${CSS_PREFIX}-list {
        margin: 0;
        padding-left: 16px;
        list-style: disc;
      }
      .${CSS_PREFIX}-list li {
        padding: 1px 0;
      }
      .${CSS_PREFIX}-json-wrapper {
        cursor: pointer;
      }
      .${CSS_PREFIX}-json-wrapper.collapsed .${CSS_PREFIX}-json-full {
        display: none;
      }
      .${CSS_PREFIX}-json-wrapper:not(.collapsed) .${CSS_PREFIX}-json-preview {
        display: none;
      }
      .${CSS_PREFIX}-json-preview {
        color: var(--dvt-muted, #888);
        font-style: italic;
      }
      .${CSS_PREFIX}-json-full {
        margin: 4px 0;
        padding: 6px 8px;
        background: var(--dvt-code-bg, #f5f5f5);
        border-radius: 4px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 200px;
        overflow-y: auto;
      }
      .${CSS_PREFIX}-raw {
        padding: 8px 12px;
      }
      .${CSS_PREFIX}-copy-all {
        display: block;
        margin-bottom: 8px;
        padding: 4px 12px;
        border: 1px solid var(--dvt-border, #d0d0d0);
        border-radius: 4px;
        background: var(--dvt-input-bg, #f9f9f9);
        cursor: pointer;
        font-size: 11px;
        color: inherit;
      }
      .${CSS_PREFIX}-copy-all:hover {
        background: var(--dvt-hover, #e8e8e8);
      }
      .${CSS_PREFIX}-raw-json {
        margin: 0;
        padding: 8px;
        background: var(--dvt-code-bg, #f5f5f5);
        border-radius: 4px;
        font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
        font-size: 11px;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-y: auto;
        max-height: calc(100vh - 120px);
      }
      .${CSS_PREFIX}-empty {
        padding: 32px 16px;
        text-align: center;
        color: var(--dvt-muted, #999);
      }
      .${CSS_PREFIX}-empty p {
        margin: 0;
      }
      .${CSS_PREFIX}-val a {
        color: var(--dvt-accent, #0078d4);
        text-decoration: none;
      }
      .${CSS_PREFIX}-val a:hover {
        text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  }
}

export { DetailPanel, VALUE_TYPES };
export default DetailPanel;
