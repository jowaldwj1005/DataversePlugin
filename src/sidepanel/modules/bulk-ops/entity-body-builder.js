/**
 * Entity Body Builder — Enhanced "Add Operation" dialog for Bulk Operations.
 *
 * Provides entity autocomplete, attribute-aware body construction with
 * type-specific value inputs, live JSON preview, and ChangeSet assignment.
 *
 * @module EntityBodyBuilder
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METHODS = Object.freeze(['POST', 'PATCH', 'DELETE']);

/** Attribute types that get a numeric input. */
const INTEGER_TYPES = new Set(['Integer', 'BigInt']);
const DECIMAL_TYPES = new Set(['Decimal', 'Double', 'Money']);
const OPTIONSET_TYPES = new Set(['Picklist', 'Status', 'State']);
const LOOKUP_TYPES = new Set(['Lookup', 'Owner', 'Customer']);

/** Attributes rendered as textarea instead of single-line input. */
const MEMO_TYPES = new Set(['Memo']);

let stylesInjected = false;

// ---------------------------------------------------------------------------
// CSS (injected once)
// ---------------------------------------------------------------------------

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const css = /* css */ `
    .bulk-bb-overlay {
      position: fixed; inset: 0;
      background: var(--color-bg-overlay, rgba(0,0,0,.55));
      display: flex; align-items: center; justify-content: center;
      z-index: 9000;
    }
    .bulk-bb-dialog {
      background: var(--color-bg-panel);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-overlay, var(--shadow-lg));
      width: 460px; max-width: 95vw;
      max-height: 90vh;
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .bulk-bb-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border);
    }
    .bulk-bb-header h3 { margin: 0; font-size: .92rem; color: var(--color-text-primary); }
    .bulk-bb-close {
      background: none; border: none; cursor: pointer;
      font-size: 1.15rem; color: var(--color-text-muted);
      padding: 2px 6px; border-radius: var(--radius-sm);
    }
    .bulk-bb-close:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
    .bulk-bb-body {
      flex: 1 1 auto; overflow-y: auto; padding: 14px 16px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .bulk-bb-row { display: flex; flex-direction: column; gap: 4px; }
    .bulk-bb-label {
      font-size: .76rem; font-weight: 600;
      color: var(--color-text-muted); text-transform: uppercase; letter-spacing: .04em;
    }
    .bulk-bb-input, .bulk-bb-select, .bulk-bb-textarea {
      width: 100%; box-sizing: border-box;
      padding: 6px 8px; font-size: .82rem;
      background: var(--color-bg-input); color: var(--color-text-primary);
      border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      outline: none;
    }
    .bulk-bb-input:focus, .bulk-bb-select:focus, .bulk-bb-textarea:focus {
      border-color: var(--color-border-focus);
    }
    .bulk-bb-textarea { resize: vertical; font-family: inherit; }

    /* Entity autocomplete */
    .bulk-bb-ac-wrap { position: relative; }
    .bulk-bb-ac-list {
      position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
      max-height: 180px; overflow-y: auto;
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border); border-top: none;
      border-radius: 0 0 var(--radius-sm) var(--radius-sm);
      box-shadow: var(--shadow-lg);
    }
    .bulk-bb-ac-item {
      padding: 5px 8px; cursor: pointer; font-size: .8rem;
      color: var(--color-text-primary);
    }
    .bulk-bb-ac-item:hover, .bulk-bb-ac-item.active {
      background: var(--color-bg-hover);
    }
    .bulk-bb-ac-sub { color: var(--color-text-muted); font-size: .72rem; margin-left: 6px; }

    /* Attribute panel */
    .bulk-bb-attr-panel {
      border: 1px solid var(--color-border); border-radius: var(--radius-md);
      max-height: 240px; display: flex; flex-direction: column;
    }
    .bulk-bb-attr-search {
      width: 100%; box-sizing: border-box;
      padding: 5px 8px; font-size: .78rem;
      background: var(--color-bg-input); color: var(--color-text-primary);
      border: none; border-bottom: 1px solid var(--color-border);
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      outline: none;
    }
    .bulk-bb-attr-list {
      flex: 1 1 auto; overflow-y: auto; padding: 4px 0;
    }
    .bulk-bb-attr-row {
      display: flex; flex-direction: column; padding: 3px 8px;
    }
    .bulk-bb-attr-row:hover { background: var(--color-bg-hover); }
    .bulk-bb-attr-check {
      display: flex; align-items: center; gap: 6px; cursor: pointer;
      font-size: .8rem; color: var(--color-text-primary);
    }
    .bulk-bb-attr-check input[type="checkbox"] { margin: 0; }
    .bulk-bb-attr-type {
      font-size: .68rem; color: var(--color-text-muted); margin-left: auto;
      white-space: nowrap;
    }
    .bulk-bb-attr-required { color: var(--color-accent-primary); font-weight: 600; }
    .bulk-bb-attr-value {
      padding: 4px 0 2px 22px;
    }
    .bulk-bb-attr-value input,
    .bulk-bb-attr-value select,
    .bulk-bb-attr-value textarea {
      width: 100%; box-sizing: border-box;
      padding: 4px 6px; font-size: .78rem;
      background: var(--color-bg-input); color: var(--color-text-primary);
      border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      outline: none;
    }
    .bulk-bb-attr-value textarea { resize: vertical; min-height: 48px; font-family: inherit; }
    .bulk-bb-attr-value input:focus,
    .bulk-bb-attr-value select:focus,
    .bulk-bb-attr-value textarea:focus {
      border-color: var(--color-border-focus);
    }
    .bulk-bb-bool-wrap {
      display: flex; align-items: center; gap: 6px;
      font-size: .78rem; color: var(--color-text-primary);
      padding: 2px 0;
    }

    /* JSON preview */
    .bulk-bb-preview {
      background: var(--color-bg-input);
      border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      padding: 8px 10px; font-family: Consolas, monospace; font-size: .74rem;
      max-height: 140px; overflow: auto; white-space: pre-wrap;
      color: var(--color-text-primary); tab-size: 2;
    }

    /* Footer */
    .bulk-bb-footer {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 10px 16px; border-top: 1px solid var(--color-border);
    }
    .bulk-bb-btn {
      padding: 6px 14px; font-size: .8rem; border-radius: var(--radius-sm);
      border: 1px solid var(--color-border); cursor: pointer;
      background: var(--color-bg-input); color: var(--color-text-primary);
    }
    .bulk-bb-btn:hover { background: var(--color-bg-hover); }
    .bulk-bb-btn-primary {
      background: var(--color-accent-primary); color: #fff; border-color: var(--color-accent-primary);
    }
    .bulk-bb-btn-primary:hover { filter: brightness(1.1); }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayName(meta) {
  return meta?.DisplayName?.UserLocalizedLabel?.Label || meta?.LogicalName || '';
}

function requiredLevel(attr) {
  return attr?.RequiredLevel?.Value || 'None';
}

function isRequired(attr) {
  const lvl = requiredLevel(attr);
  return lvl === 'ApplicationRequired' || lvl === 'SystemRequired' || lvl === 'Recommended';
}

/** Sort: required first, then PrimaryName, then custom (cr*/msdyn_ excluded), then system. */
function sortAttributes(attrs, primaryNameAttr) {
  const rank = (a) => {
    if (isRequired(a)) return 0;
    if (a.LogicalName === primaryNameAttr) return 1;
    if (a.LogicalName.startsWith('cr') || a.LogicalName.includes('_')) return 2;
    return 3;
  };
  return [...attrs].sort((a, b) => rank(a) - rank(b) || a.LogicalName.localeCompare(b.LogicalName));
}

// ---------------------------------------------------------------------------
// EntityBodyBuilder
// ---------------------------------------------------------------------------

export class EntityBodyBuilder {
  #cache;

  constructor(metadataCache) {
    this.#cache = metadataCache;
  }

  /**
   * Show the dialog. Resolves when the user confirms or cancels.
   * @param {HTMLElement} containerEl  - Element to append the overlay to
   * @param {{ changeSets: { id: string, label: string }[] }} opts
   * @returns {Promise<{ method: string, url: string, body: object|null, description: string, changeSetId: string|null }|null>}
   */
  show(containerEl, { changeSets = [] } = {}) {
    injectStyles();

    return new Promise((resolve) => {
      // State
      let selectedEntity = null;
      let attributes = [];
      let checkedAttrs = new Map(); // logicalName -> { attr, value }

      const cleanup = (result) => { overlay.remove(); resolve(result); };

      // -- Overlay & Dialog ------------------------------------------------
      const overlay = document.createElement('div');
      overlay.className = 'bulk-bb-overlay';
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cleanup(null); });

      const dialog = document.createElement('div');
      dialog.className = 'bulk-bb-dialog';
      overlay.appendChild(dialog);

      // Header
      const header = document.createElement('div');
      header.className = 'bulk-bb-header';
      const h3 = document.createElement('h3');
      h3.textContent = 'Add Operation';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'bulk-bb-close';
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.onclick = () => cleanup(null);
      header.append(h3, closeBtn);
      dialog.appendChild(header);

      // Scrollable body
      const body = document.createElement('div');
      body.className = 'bulk-bb-body';
      dialog.appendChild(body);

      // -- Method ----------------------------------------------------------
      const methodRow = row('Method');
      const methodSelect = el('select', 'bulk-bb-select');
      METHODS.forEach(m => { methodSelect.innerHTML += `<option value="${m}">${m}</option>`; });
      methodRow.appendChild(methodSelect);
      body.appendChild(methodRow);

      // -- Record ID (PATCH/DELETE) ----------------------------------------
      const idRow = row('Record ID');
      const idInput = el('input', 'bulk-bb-input');
      idInput.type = 'text';
      idInput.placeholder = '00000000-0000-0000-0000-000000000000';
      idRow.appendChild(idInput);
      idRow.style.display = 'none';
      body.appendChild(idRow);

      methodSelect.addEventListener('change', () => {
        const m = methodSelect.value;
        idRow.style.display = (m === 'PATCH' || m === 'DELETE') ? '' : 'none';
        attrPanel.style.display = (m === 'DELETE' || !selectedEntity) ? 'none' : '';
        previewRow.style.display = (m === 'DELETE') ? 'none' : '';
        updatePreview();
      });

      // -- Entity autocomplete ---------------------------------------------
      const entityRow = row('Entity');
      const acWrap = document.createElement('div');
      acWrap.className = 'bulk-bb-ac-wrap';
      const entityInput = el('input', 'bulk-bb-input');
      entityInput.placeholder = 'Search entity...';
      acWrap.appendChild(entityInput);

      const acList = document.createElement('div');
      acList.className = 'bulk-bb-ac-list';
      acList.style.display = 'none';
      acWrap.appendChild(acList);
      entityRow.appendChild(acWrap);
      body.appendChild(entityRow);

      let entities = [];
      let acIndex = -1;

      // Load entities eagerly
      this.#cache.getEntities().then(ents => { entities = ents || []; });

      entityInput.addEventListener('input', () => {
        const q = entityInput.value.trim().toLowerCase();
        if (!q) { acList.style.display = 'none'; return; }
        const matches = entities.filter(e =>
          e.LogicalName.toLowerCase().includes(q) ||
          (displayName(e) || '').toLowerCase().includes(q) ||
          (e.EntitySetName || '').toLowerCase().includes(q)
        ).slice(0, 30);
        renderAcList(matches);
      });

      entityInput.addEventListener('keydown', (e) => {
        const items = acList.querySelectorAll('.bulk-bb-ac-item');
        if (!items.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = Math.min(acIndex + 1, items.length - 1); highlightAc(items); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = Math.max(acIndex - 1, 0); highlightAc(items); }
        else if (e.key === 'Enter' && acIndex >= 0) { e.preventDefault(); items[acIndex]?.click(); }
        else if (e.key === 'Escape') { acList.style.display = 'none'; }
      });

      const renderAcList = (matches) => {
        acList.innerHTML = '';
        acIndex = -1;
        if (!matches.length) { acList.style.display = 'none'; return; }
        matches.forEach(ent => {
          const item = document.createElement('div');
          item.className = 'bulk-bb-ac-item';
          item.innerHTML = `${ent.LogicalName}<span class="bulk-bb-ac-sub">${displayName(ent)}</span>`;
          item.addEventListener('click', () => selectEntity(ent));
          acList.appendChild(item);
        });
        acList.style.display = '';
      };

      const highlightAc = (items) => {
        items.forEach((it, i) => it.classList.toggle('active', i === acIndex));
        items[acIndex]?.scrollIntoView({ block: 'nearest' });
      };

      const selectEntity = async (ent) => {
        selectedEntity = ent;
        entityInput.value = `${ent.LogicalName} (${displayName(ent)})`;
        acList.style.display = 'none';
        checkedAttrs.clear();

        try {
          const raw = await this.#cache.getAttributes(ent.LogicalName);
          attributes = (raw || []).filter(a => !a.IsPrimaryId);
          attributes = sortAttributes(attributes, ent.PrimaryNameAttribute);
        } catch { attributes = []; }

        if (methodSelect.value !== 'DELETE') {
          attrPanel.style.display = '';
          previewRow.style.display = '';
        }
        renderAttrList();
        updatePreview();
      };

      // -- Attribute panel -------------------------------------------------
      const attrPanel = document.createElement('div');
      attrPanel.className = 'bulk-bb-attr-panel';
      attrPanel.style.display = 'none';

      const attrSearch = el('input', 'bulk-bb-attr-search');
      attrSearch.placeholder = 'Filter attributes...';
      attrPanel.appendChild(attrSearch);

      const attrListEl = document.createElement('div');
      attrListEl.className = 'bulk-bb-attr-list';
      attrPanel.appendChild(attrListEl);
      body.appendChild(attrPanel);

      attrSearch.addEventListener('input', () => renderAttrList(attrSearch.value.trim().toLowerCase()));

      const renderAttrList = (filter = '') => {
        attrListEl.innerHTML = '';
        const visible = filter
          ? attributes.filter(a => a.LogicalName.includes(filter) || (displayName(a) || '').toLowerCase().includes(filter))
          : attributes;

        for (const attr of visible) {
          const aRow = document.createElement('div');
          aRow.className = 'bulk-bb-attr-row';

          // Checkbox label line
          const lbl = document.createElement('label');
          lbl.className = 'bulk-bb-attr-check';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = checkedAttrs.has(attr.LogicalName);

          const nameSpan = document.createElement('span');
          const dn = displayName(attr);
          nameSpan.textContent = dn ? `${attr.LogicalName} (${dn})` : attr.LogicalName;
          if (isRequired(attr)) nameSpan.classList.add('bulk-bb-attr-required');

          const typeSpan = document.createElement('span');
          typeSpan.className = 'bulk-bb-attr-type';
          typeSpan.textContent = attr.AttributeType;

          lbl.append(cb, nameSpan, typeSpan);
          aRow.appendChild(lbl);

          // Value editor (shown when checked)
          const valueWrap = document.createElement('div');
          valueWrap.className = 'bulk-bb-attr-value';
          valueWrap.style.display = cb.checked ? '' : 'none';

          if (cb.checked) {
            buildValueEditor(valueWrap, attr);
          }

          cb.addEventListener('change', async () => {
            if (cb.checked) {
              checkedAttrs.set(attr.LogicalName, { attr, value: getDefaultValue(attr) });
              valueWrap.innerHTML = '';
              await buildValueEditor(valueWrap, attr);
              valueWrap.style.display = '';
            } else {
              checkedAttrs.delete(attr.LogicalName);
              valueWrap.style.display = 'none';
              valueWrap.innerHTML = '';
            }
            updatePreview();
          });

          aRow.appendChild(valueWrap);
          attrListEl.appendChild(aRow);
        }
      };

      const getDefaultValue = (attr) => {
        const t = attr.AttributeType;
        if (t === 'Boolean') return false;
        if (INTEGER_TYPES.has(t)) return 0;
        if (DECIMAL_TYPES.has(t)) return 0;
        if (OPTIONSET_TYPES.has(t)) return null;
        return '';
      };

      /** Build a type-aware value editor inside `wrap`. */
      const buildValueEditor = async (wrap, attr) => {
        const t = attr.AttributeType;
        const setValue = (v) => {
          const entry = checkedAttrs.get(attr.LogicalName);
          if (entry) { entry.value = v; updatePreview(); }
        };

        if (t === 'Boolean') {
          const boolWrap = document.createElement('label');
          boolWrap.className = 'bulk-bb-bool-wrap';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = checkedAttrs.get(attr.LogicalName)?.value === true;
          cb.addEventListener('change', () => setValue(cb.checked));
          const span = document.createElement('span');
          span.textContent = 'true';
          cb.addEventListener('change', () => { span.textContent = cb.checked ? 'true' : 'false'; });
          boolWrap.append(cb, span);
          wrap.appendChild(boolWrap);
        } else if (MEMO_TYPES.has(t)) {
          const ta = document.createElement('textarea');
          ta.rows = 3;
          ta.value = checkedAttrs.get(attr.LogicalName)?.value || '';
          ta.addEventListener('input', () => setValue(ta.value));
          wrap.appendChild(ta);
        } else if (INTEGER_TYPES.has(t)) {
          const inp = document.createElement('input');
          inp.type = 'number'; inp.step = '1';
          inp.value = checkedAttrs.get(attr.LogicalName)?.value ?? 0;
          inp.addEventListener('input', () => setValue(parseInt(inp.value, 10) || 0));
          wrap.appendChild(inp);
        } else if (DECIMAL_TYPES.has(t)) {
          const inp = document.createElement('input');
          inp.type = 'number'; inp.step = '0.01';
          inp.value = checkedAttrs.get(attr.LogicalName)?.value ?? 0;
          inp.addEventListener('input', () => setValue(parseFloat(inp.value) || 0));
          wrap.appendChild(inp);
        } else if (t === 'DateTime') {
          const inp = document.createElement('input');
          inp.type = 'datetime-local';
          inp.value = checkedAttrs.get(attr.LogicalName)?.value || '';
          inp.addEventListener('input', () => setValue(inp.value));
          wrap.appendChild(inp);
        } else if (OPTIONSET_TYPES.has(t)) {
          const sel = document.createElement('select');
          sel.innerHTML = '<option value="">-- loading --</option>';
          wrap.appendChild(sel);
          try {
            const opts = await this.#cache.getOptionSet(selectedEntity.LogicalName, attr.LogicalName);
            sel.innerHTML = '<option value="">-- select --</option>';
            (opts || []).forEach(o => {
              const label = o.Label?.UserLocalizedLabel?.Label || `${o.Value}`;
              sel.innerHTML += `<option value="${o.Value}">${label} (${o.Value})</option>`;
            });
            const cur = checkedAttrs.get(attr.LogicalName)?.value;
            if (cur !== null && cur !== undefined) sel.value = String(cur);
          } catch {
            sel.innerHTML = '<option value="">-- failed to load options --</option>';
          }
          sel.addEventListener('change', () => {
            setValue(sel.value === '' ? null : parseInt(sel.value, 10));
          });
        } else if (LOOKUP_TYPES.has(t) || t === 'UniqueIdentifier') {
          const inp = document.createElement('input');
          inp.type = 'text'; inp.placeholder = 'GUID';
          inp.value = checkedAttrs.get(attr.LogicalName)?.value || '';
          inp.addEventListener('input', () => setValue(inp.value));
          wrap.appendChild(inp);
        } else {
          // String and anything else
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = checkedAttrs.get(attr.LogicalName)?.value || '';
          inp.addEventListener('input', () => setValue(inp.value));
          wrap.appendChild(inp);
        }
      };

      // -- JSON Preview ----------------------------------------------------
      const previewRow = row('Body Preview');
      const preview = document.createElement('pre');
      preview.className = 'bulk-bb-preview';
      preview.textContent = '{}';
      previewRow.appendChild(preview);
      previewRow.style.display = 'none';
      body.appendChild(previewRow);

      const updatePreview = () => {
        if (methodSelect.value === 'DELETE') { preview.textContent = ''; return; }
        const obj = buildBody();
        preview.textContent = Object.keys(obj).length ? JSON.stringify(obj, null, 2) : '{}';
      };

      const buildBody = () => {
        const obj = {};
        for (const [logicalName, { attr, value }] of checkedAttrs) {
          if (value === null || value === undefined) continue;
          if (LOOKUP_TYPES.has(attr.AttributeType)) {
            obj[`_${logicalName}_value`] = value;
          } else {
            obj[logicalName] = value;
          }
        }
        return obj;
      };

      // -- ChangeSet selector ----------------------------------------------
      const csRow = row('ChangeSet');
      const csSelect = el('select', 'bulk-bb-select');
      csSelect.innerHTML = '<option value="">(None - standalone)</option>';
      changeSets.forEach(cs => {
        csSelect.innerHTML += `<option value="${cs.id}">${cs.label}</option>`;
      });
      csRow.appendChild(csSelect);
      body.appendChild(csRow);

      // -- Description -----------------------------------------------------
      const descRow = row('Description');
      const descInput = el('input', 'bulk-bb-input');
      descInput.placeholder = 'Optional description';
      descRow.appendChild(descInput);
      body.appendChild(descRow);

      // -- Footer ----------------------------------------------------------
      const footer = document.createElement('div');
      footer.className = 'bulk-bb-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'bulk-bb-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = () => cleanup(null);

      const addBtn = document.createElement('button');
      addBtn.className = 'bulk-bb-btn bulk-bb-btn-primary';
      addBtn.textContent = 'Add Operation';
      addBtn.onclick = () => {
        if (!selectedEntity) return;

        const method = methodSelect.value;
        const guid = idInput.value.trim();

        if ((method === 'PATCH' || method === 'DELETE') && !guid) return;

        const entitySet = selectedEntity.EntitySetName;
        const url = (method === 'PATCH' || method === 'DELETE')
          ? `${entitySet}(${guid})`
          : entitySet;

        const bodyObj = method === 'DELETE' ? null : buildBody();

        cleanup({
          method,
          url,
          body: bodyObj && Object.keys(bodyObj).length ? bodyObj : null,
          description: descInput.value.trim(),
          changeSetId: csSelect.value || null,
        });
      };

      footer.append(cancelBtn, addBtn);
      dialog.appendChild(footer);

      // Mount
      containerEl.appendChild(overlay);
      entityInput.focus();
    });
  }
}

// ---------------------------------------------------------------------------
// Tiny DOM helpers (local to module)
// ---------------------------------------------------------------------------

function row(label) {
  const div = document.createElement('div');
  div.className = 'bulk-bb-row';
  const lbl = document.createElement('span');
  lbl.className = 'bulk-bb-label';
  lbl.textContent = label;
  div.appendChild(lbl);
  return div;
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
