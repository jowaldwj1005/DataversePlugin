/**
 * Shared wizard infrastructure for Bulk Operations module.
 *
 * Exports:
 *  - WizardBase          — modal wizard shell (steps, navigation, overlay)
 *  - EntityPickerStep    — autocomplete entity selection step
 *  - FilterStep          — OData $filter with preview/count/fetch
 *  - FieldSelectorStep   — attribute checkbox list with type-aware value inputs
 *  - fetchAllRecords     — paginated record fetcher utility
 */

// ---------------------------------------------------------------------------
// CSS — injected once into the document
// ---------------------------------------------------------------------------

const STYLE_ID = 'bulk-wiz-styles';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = /* css */`
/* Overlay */
.bulk-wiz-overlay {
  position: fixed; inset: 0;
  background: var(--color-bg-overlay);
  z-index: var(--z-modal, 400);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: var(--backdrop-blur, blur(8px));
}
/* Dialog */
.bulk-wiz-dialog {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  width: 92%; max-width: 560px; max-height: 85vh;
  display: flex; flex-direction: column;
  overflow: hidden;
}
/* Header */
.bulk-wiz-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border);
}
.bulk-wiz-title {
  margin: 0 0 12px; font-size: 1rem; font-weight: 600;
  color: var(--color-text-bright);
}
/* Step indicator */
.bulk-wiz-steps {
  display: flex; align-items: center; gap: 0;
}
.bulk-wiz-step-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.72rem; color: var(--color-text-muted);
  white-space: nowrap;
}
.bulk-wiz-step-item.active { color: var(--color-accent-primary); }
.bulk-wiz-step-item.done   { color: var(--color-success); }
.bulk-wiz-step-num {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.68rem; font-weight: 600;
  border: 2px solid var(--color-border);
  color: var(--color-text-muted);
  background: transparent; flex-shrink: 0;
}
.bulk-wiz-step-item.active .bulk-wiz-step-num {
  border-color: var(--color-accent-primary);
  background: var(--color-accent-primary);
  color: var(--color-text-bright);
}
.bulk-wiz-step-item.done .bulk-wiz-step-num {
  border-color: var(--color-success);
  background: var(--color-success);
  color: var(--color-bg-panel);
}
.bulk-wiz-step-line {
  flex: 1; height: 2px; min-width: 12px;
  background: var(--color-border); margin: 0 6px;
}
.bulk-wiz-step-item.done + .bulk-wiz-step-line,
.bulk-wiz-step-line.done {
  background: var(--color-success);
}
/* Body */
.bulk-wiz-body {
  flex: 1 1 auto; overflow-y: auto;
  padding: 16px 20px;
}
.bulk-wiz-body::-webkit-scrollbar { width: 6px; }
.bulk-wiz-body::-webkit-scrollbar-track { background: transparent; }
.bulk-wiz-body::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb); border-radius: 3px;
}
/* Error banner */
.bulk-wiz-error {
  background: var(--color-error-bg); border: 1px solid var(--color-error-border);
  color: var(--color-error); border-radius: var(--radius-sm);
  padding: 6px 10px; font-size: 0.78rem; margin-bottom: 10px;
}
/* Footer */
.bulk-wiz-footer {
  padding: 12px 20px; border-top: 1px solid var(--color-border);
  display: flex; justify-content: flex-end; gap: 8px;
}
.bulk-wiz-btn {
  padding: 6px 16px; border-radius: var(--radius-md);
  font-size: 0.78rem; font-weight: 500; cursor: pointer;
  border: 1px solid transparent; transition: background var(--transition-fast);
}
.bulk-wiz-btn:focus-visible { box-shadow: var(--focus-ring); outline: none; }
.bulk-wiz-btn-primary {
  background: var(--color-accent-primary); color: #fff; border-color: var(--color-accent-primary);
}
.bulk-wiz-btn-primary:hover { background: var(--color-accent-primary-hover); }
.bulk-wiz-btn-secondary {
  background: var(--color-bg-input); color: var(--color-text-primary); border-color: var(--color-border);
}
.bulk-wiz-btn-secondary:hover { background: var(--color-bg-hover); }

/* ---- Shared form elements for steps ---- */
.bulk-wiz-label {
  display: block; font-size: 0.75rem; font-weight: 500;
  color: var(--color-text-muted); margin-bottom: 4px;
}
.bulk-wiz-input, .bulk-wiz-select, .bulk-wiz-textarea {
  width: 100%; box-sizing: border-box;
  background: var(--color-bg-input); color: var(--color-text-primary);
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  padding: 6px 8px; font-size: 0.8rem;
  font-family: inherit;
}
.bulk-wiz-input:focus, .bulk-wiz-select:focus, .bulk-wiz-textarea:focus {
  outline: none; border-color: var(--color-border-focus);
  box-shadow: var(--focus-ring);
}
.bulk-wiz-textarea {
  font-family: Consolas, monospace; font-size: 0.78rem;
  resize: vertical; min-height: 60px;
}
/* Autocomplete */
.bulk-wiz-ac-wrap { position: relative; }
.bulk-wiz-ac-list {
  position: absolute; top: 100%; left: 0; right: 0;
  max-height: 200px; overflow-y: auto;
  background: var(--color-bg-dropdown); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); z-index: 10;
  display: none;
}
.bulk-wiz-ac-item {
  padding: 5px 8px; font-size: 0.78rem; cursor: pointer;
  color: var(--color-text-primary);
}
.bulk-wiz-ac-item:hover { background: var(--color-bg-hover); }
.bulk-wiz-ac-item .bulk-wiz-ac-sub {
  color: var(--color-text-muted); font-size: 0.7rem; margin-left: 4px;
}
/* Entity info card */
.bulk-wiz-entity-card {
  margin-top: 10px; padding: 10px 12px;
  background: var(--color-bg-card); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); font-size: 0.78rem;
}
.bulk-wiz-entity-card dt { color: var(--color-text-muted); font-size: 0.7rem; }
.bulk-wiz-entity-card dd { margin: 0 0 6px; color: var(--color-text-primary); }
/* Badge */
.bulk-wiz-badge {
  display: inline-block; padding: 2px 8px;
  background: var(--color-accent-primary); color: #fff;
  border-radius: 10px; font-size: 0.7rem; font-weight: 600;
}
.bulk-wiz-badge-muted {
  background: var(--color-bg-badge, var(--color-bg-input));
  color: var(--color-text-primary);
}
/* Filter step */
.bulk-wiz-filter-actions { display: flex; gap: 8px; margin-top: 8px; }
.bulk-wiz-hint {
  font-size: 0.7rem; color: var(--color-text-muted); margin-top: 6px; line-height: 1.45;
}
.bulk-wiz-hint code {
  font-family: Consolas, monospace; background: var(--color-bg-input);
  padding: 0 3px; border-radius: 3px; font-size: 0.7rem;
}
.bulk-wiz-record-list {
  max-height: 140px; overflow-y: auto; margin-top: 8px;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  font-family: Consolas, monospace; font-size: 0.72rem;
  color: var(--color-text-muted);
}
.bulk-wiz-record-list div { padding: 2px 8px; }
.bulk-wiz-record-list div:nth-child(even) { background: var(--color-bg-hover); }
/* Field selector */
.bulk-wiz-field-search {
  margin-bottom: 8px;
}
.bulk-wiz-field-list {
  max-height: 260px; overflow-y: auto;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
}
.bulk-wiz-field-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px; font-size: 0.78rem;
  border-bottom: 1px solid var(--color-border);
}
.bulk-wiz-field-row:last-child { border-bottom: none; }
.bulk-wiz-field-row:hover { background: var(--color-bg-hover); }
.bulk-wiz-field-name { flex: 1; min-width: 0; }
.bulk-wiz-field-name small { color: var(--color-text-muted); margin-left: 4px; }
.bulk-wiz-field-type {
  font-size: 0.68rem; color: var(--color-text-muted);
  flex-shrink: 0;
}
.bulk-wiz-field-value {
  margin-top: 6px; padding: 8px 10px;
  background: var(--color-bg-card); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.bulk-wiz-field-value label {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.75rem; color: var(--color-text-primary); margin-bottom: 6px;
}
.bulk-wiz-field-value label:last-child { margin-bottom: 0; }
.bulk-wiz-field-value input[type="text"],
.bulk-wiz-field-value input[type="number"],
.bulk-wiz-field-value input[type="datetime-local"],
.bulk-wiz-field-value textarea,
.bulk-wiz-field-value select {
  flex: 1; min-width: 0;
  background: var(--color-bg-input); color: var(--color-text-primary);
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  padding: 4px 6px; font-size: 0.78rem; font-family: inherit;
}
.bulk-wiz-field-value input:focus,
.bulk-wiz-field-value textarea:focus,
.bulk-wiz-field-value select:focus {
  outline: none; border-color: var(--color-border-focus);
}
`;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// WizardBase
// ---------------------------------------------------------------------------

export class WizardBase {
  #cache;
  #api;
  #resolve;
  #overlay;
  #currentStep;

  /**
   * @param {import('../../shared/api-client.js').DataverseClient} apiClient
   * @param {object} metadataCache
   */
  constructor(metadataCache, apiClient) {
    this.#cache = metadataCache;
    this.#api = apiClient;
  }

  /** @returns {string} Wizard title shown in header. Subclasses override. */
  get title() { return 'Wizard'; }

  /**
   * Array of step descriptors. Subclasses override.
   * @returns {Array<{ id: string, label: string, render(el: HTMLElement): void, validate(): string|null }>}
   */
  get steps() { return []; }

  /**
   * Subclasses override to produce the final operations array.
   * @returns {Array<{ method: string, url: string, body: object|null, description: string }>}
   */
  _generateOperations() {
    throw new Error('_generateOperations() must be overridden by subclass');
  }

  // -- Accessors for subclass convenience --
  get cache() { return this.#cache; }
  get api() { return this.#api; }

  /**
   * Show the wizard modal and wait for completion.
   * @param {HTMLElement} container  Parent to append overlay into.
   * @returns {Promise<Array<{ method: string, url: string, body: object|null, description: string }>|null>}
   */
  show(container) {
    injectStyles();
    return new Promise(resolve => {
      this.#resolve = resolve;
      this.#currentStep = 0;
      this.#buildUI(container);
      this.#renderStep();
    });
  }

  // -- Internal UI construction ------------------------------------------------

  #buildUI(container) {
    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'bulk-wiz-overlay';
    overlay.addEventListener('mousedown', e => {
      if (e.target === overlay) this.#cancel();
    });

    // Dialog
    const dialog = document.createElement('div');
    dialog.className = 'bulk-wiz-dialog';
    overlay.appendChild(dialog);

    // Header
    const header = document.createElement('div');
    header.className = 'bulk-wiz-header';
    const title = document.createElement('h3');
    title.className = 'bulk-wiz-title';
    title.textContent = this.title;
    header.appendChild(title);
    this._stepIndicator = this.#buildStepIndicator();
    header.appendChild(this._stepIndicator);
    dialog.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'bulk-wiz-body';
    this._bodyEl = body;
    dialog.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'bulk-wiz-footer';

    this._btnCancel = this.#btn('Cancel', 'secondary', () => this.#cancel());
    this._btnBack = this.#btn('Back', 'secondary', () => this.#back());
    this._btnNext = this.#btn('Next', 'primary', () => this.#next());
    this._btnFinish = this.#btn('Finish', 'primary', () => this.#finish());

    footer.append(this._btnCancel, this._btnBack, this._btnNext, this._btnFinish);
    dialog.appendChild(footer);

    this.#overlay = overlay;
    container.appendChild(overlay);
  }

  #btn(label, variant, handler) {
    const b = document.createElement('button');
    b.className = `bulk-wiz-btn bulk-wiz-btn-${variant}`;
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }

  #buildStepIndicator() {
    const wrap = document.createElement('div');
    wrap.className = 'bulk-wiz-steps';
    const steps = this.steps;
    for (let i = 0; i < steps.length; i++) {
      if (i > 0) {
        const line = document.createElement('div');
        line.className = 'bulk-wiz-step-line';
        line.dataset.after = i - 1;
        wrap.appendChild(line);
      }
      const item = document.createElement('div');
      item.className = 'bulk-wiz-step-item';
      item.dataset.index = i;

      const num = document.createElement('span');
      num.className = 'bulk-wiz-step-num';
      num.textContent = i + 1;

      const lbl = document.createElement('span');
      lbl.textContent = steps[i].label;

      item.append(num, lbl);
      wrap.appendChild(item);
    }
    return wrap;
  }

  #updateStepIndicator() {
    const items = this._stepIndicator.querySelectorAll('.bulk-wiz-step-item');
    const lines = this._stepIndicator.querySelectorAll('.bulk-wiz-step-line');
    items.forEach((el, i) => {
      el.classList.toggle('active', i === this.#currentStep);
      el.classList.toggle('done', i < this.#currentStep);
    });
    lines.forEach(el => {
      const afterIdx = Number(el.dataset.after);
      el.classList.toggle('done', afterIdx < this.#currentStep);
    });
  }

  #updateButtons() {
    const steps = this.steps;
    const isFirst = this.#currentStep === 0;
    const isLast = this.#currentStep === steps.length - 1;

    this._btnBack.style.display = isFirst ? 'none' : '';
    this._btnNext.style.display = isLast ? 'none' : '';
    this._btnFinish.style.display = isLast ? '' : 'none';
  }

  #renderStep() {
    this._bodyEl.innerHTML = '';
    this.#clearError();
    const step = this.steps[this.#currentStep];
    if (step) step.render(this._bodyEl);
    this.#updateStepIndicator();
    this.#updateButtons();
  }

  // -- Navigation --------------------------------------------------------------

  #next() {
    const step = this.steps[this.#currentStep];
    const err = step?.validate();
    if (err) { this.#showError(err); return; }
    this.#currentStep++;
    this.#renderStep();
  }

  #back() {
    if (this.#currentStep > 0) {
      this.#currentStep--;
      this.#renderStep();
    }
  }

  #finish() {
    const step = this.steps[this.#currentStep];
    const err = step?.validate();
    if (err) { this.#showError(err); return; }
    try {
      const ops = this._generateOperations();
      this.#close(ops);
    } catch (e) {
      this.#showError(e.message || String(e));
    }
  }

  #cancel() { this.#close(null); }

  #close(result) {
    this.#overlay?.remove();
    this.#overlay = null;
    this.#resolve?.(result);
  }

  // -- Error display -----------------------------------------------------------

  #showError(msg) {
    this.#clearError();
    const el = document.createElement('div');
    el.className = 'bulk-wiz-error';
    el.textContent = msg;
    this._bodyEl.prepend(el);
  }

  #clearError() {
    this._bodyEl?.querySelector('.bulk-wiz-error')?.remove();
  }
}

// ---------------------------------------------------------------------------
// EntityPickerStep
// ---------------------------------------------------------------------------

export class EntityPickerStep {
  #cache;
  #entities = [];
  #selected = null;
  #container = null;

  constructor(metadataCache) {
    this.#cache = metadataCache;
  }

  /** Render step content into the provided container. */
  render(container) {
    this.#container = container;
    container.innerHTML = '';

    const label = document.createElement('label');
    label.className = 'bulk-wiz-label';
    label.textContent = 'Entity';

    const wrap = document.createElement('div');
    wrap.className = 'bulk-wiz-ac-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'bulk-wiz-input';
    input.placeholder = 'Search entity by name\u2026';
    input.autocomplete = 'off';

    const list = document.createElement('div');
    list.className = 'bulk-wiz-ac-list';

    input.addEventListener('input', () => this.#showDropdown(input, list));
    input.addEventListener('focus', () => this.#showDropdown(input, list));
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { list.style.display = 'none'; }
      if (e.key === 'Enter') {
        const first = list.querySelector('.bulk-wiz-ac-item');
        if (first) first.click();
      }
    });
    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) list.style.display = 'none';
    }, { capture: true });

    wrap.append(input, list);
    container.append(label, wrap);

    // Info card placeholder
    const card = document.createElement('div');
    card.className = 'bulk-wiz-entity-card';
    card.style.display = 'none';
    container.appendChild(card);
    this._cardEl = card;
    this._input = input;

    // Load entities
    this.#loadEntities(input, list);

    // Restore previous selection
    if (this.#selected) {
      input.value = this.#selected.logicalName;
      this.#renderCard();
    }
  }

  /** @returns {string|null} Error message or null if valid. */
  validate() {
    return this.#selected ? null : 'Please select an entity';
  }

  /** @returns {{ logicalName: string, entitySetName: string, displayName: string, primaryIdAttribute: string }|null} */
  getSelectedEntity() {
    return this.#selected;
  }

  // -- Internal ----------------------------------------------------------------

  async #loadEntities(input, list) {
    try {
      const entities = await this.#cache.getEntities();
      this.#entities = entities
        .filter(e => !e.IsPrivate)
        .sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));
    } catch {
      this.#entities = [];
    }
  }

  #showDropdown(input, list) {
    const q = (input.value || '').toLowerCase();
    const filtered = this.#entities.filter(e => {
      const ln = e.LogicalName.toLowerCase();
      const dn = (e.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase();
      const es = (e.EntitySetName || '').toLowerCase();
      return !q || ln.includes(q) || dn.includes(q) || es.includes(q);
    }).slice(0, 60);

    list.innerHTML = '';
    for (const ent of filtered) {
      const item = document.createElement('div');
      item.className = 'bulk-wiz-ac-item';
      const disp = ent.DisplayName?.UserLocalizedLabel?.Label || '';
      item.innerHTML = disp && disp !== ent.LogicalName
        ? `${ent.LogicalName} <span class="bulk-wiz-ac-sub">${disp}</span>`
        : ent.LogicalName;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        this.#selectEntity(ent, input, list);
      });
      list.appendChild(item);
    }
    list.style.display = filtered.length ? 'block' : 'none';
  }

  #selectEntity(entity, input, list) {
    list.style.display = 'none';
    this.#selected = {
      logicalName: entity.LogicalName,
      entitySetName: entity.EntitySetName,
      displayName: entity.DisplayName?.UserLocalizedLabel?.Label || entity.LogicalName,
      primaryIdAttribute: entity.PrimaryIdAttribute,
    };
    input.value = entity.LogicalName;
    this.#renderCard();
  }

  #renderCard() {
    const card = this._cardEl;
    if (!card || !this.#selected) return;
    const s = this.#selected;
    card.style.display = '';
    card.innerHTML = '';
    const dl = document.createElement('dl');
    dl.style.margin = '0';
    for (const [label, value] of [
      ['Display Name', s.displayName],
      ['Logical Name', s.logicalName],
      ['Entity Set Name', s.entitySetName],
    ]) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    }
    card.appendChild(dl);
  }
}

// ---------------------------------------------------------------------------
// FilterStep
// ---------------------------------------------------------------------------

export class FilterStep {
  #api;
  #cache;
  #entity = null;
  #filter = '';
  #recordIds = [];
  #recordCount = 0;

  constructor(apiClient, metadataCache) {
    this.#api = apiClient;
    this.#cache = metadataCache;
  }

  /** Configure the target entity. Call before render. */
  setEntity(entityInfo) {
    this.#entity = entityInfo;
    this.#recordIds = [];
    this.#recordCount = 0;
  }

  render(container) {
    container.innerHTML = '';
    if (!this.#entity) {
      container.textContent = 'No entity selected.';
      return;
    }

    const label = document.createElement('label');
    label.className = 'bulk-wiz-label';
    label.textContent = `OData $filter for ${this.#entity.logicalName}`;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'bulk-wiz-input';
    input.placeholder = "e.g. statecode eq 0 and contains(name,'test')";
    input.value = this.#filter;
    input.addEventListener('input', () => {
      this.#filter = input.value.trim();
      this.#recordIds = [];
      this.#recordCount = 0;
      this.#updateStatus();
    });

    const hint = document.createElement('div');
    hint.className = 'bulk-wiz-hint';
    hint.innerHTML =
      'Examples: <code>statecode eq 0</code> &middot; ' +
      '<code>createdon gt 2024-01-01</code> &middot; ' +
      "<code>contains(name,'test')</code>";

    const actions = document.createElement('div');
    actions.className = 'bulk-wiz-filter-actions';

    const btnCount = document.createElement('button');
    btnCount.className = 'bulk-wiz-btn bulk-wiz-btn-secondary';
    btnCount.textContent = 'Preview count';
    btnCount.addEventListener('click', () => this.#previewCount());

    const btnFetch = document.createElement('button');
    btnFetch.className = 'bulk-wiz-btn bulk-wiz-btn-secondary';
    btnFetch.textContent = 'Fetch records';
    btnFetch.addEventListener('click', () => this.#fetchRecords());

    actions.append(btnCount, btnFetch);

    // Status area
    const status = document.createElement('div');
    status.style.marginTop = '10px';
    this._statusEl = status;

    container.append(label, input, hint, actions, status);
    this.#updateStatus();
  }

  validate() {
    if (!this.#filter) return 'Please enter a $filter expression';
    if (this.#recordIds.length === 0 && this.#recordCount === 0) {
      return 'Use "Preview count" or "Fetch records" to verify your filter';
    }
    return null;
  }

  /** @returns {string} The raw $filter value. */
  getFilter() { return this.#filter; }

  /** @returns {string[]} Fetched record GUIDs. */
  getRecordIds() { return this.#recordIds; }

  /** @returns {number} Known matching record count. */
  getRecordCount() { return this.#recordCount; }

  // -- Internal ----------------------------------------------------------------

  async #previewCount() {
    if (!this.#filter || !this.#entity) return;
    this._statusEl.innerHTML = '<span style="color:var(--color-text-muted)">Counting\u2026</span>';
    try {
      const url = `${this.#entity.entitySetName}?$filter=${encodeURIComponent(this.#filter)}&$count=true&$top=0`;
      const data = await this.#api.request('GET', url);
      this.#recordCount = data['@odata.count'] ?? (data.value?.length || 0);
      this.#updateStatus();
    } catch (err) {
      this._statusEl.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'bulk-wiz-error';
      errEl.textContent = `Filter error: ${err.message || err}`;
      this._statusEl.appendChild(errEl);
    }
  }

  async #fetchRecords() {
    if (!this.#filter || !this.#entity) return;
    this._statusEl.innerHTML = '<span style="color:var(--color-text-muted)">Fetching records\u2026</span>';
    try {
      const idAttr = this.#entity.primaryIdAttribute;
      const records = await fetchAllRecords(
        this.#api,
        this.#entity.entitySetName,
        this.#filter,
        idAttr,
        10000
      );
      this.#recordIds = records.map(r => r[idAttr]);
      this.#recordCount = this.#recordIds.length;
      this.#updateStatus();
    } catch (err) {
      this._statusEl.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'bulk-wiz-error';
      errEl.textContent = `Fetch error: ${err.message || err}`;
      this._statusEl.appendChild(errEl);
    }
  }

  #updateStatus() {
    if (!this._statusEl) return;
    this._statusEl.innerHTML = '';

    if (this.#recordCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'bulk-wiz-badge';
      badge.textContent = `${this.#recordCount} record${this.#recordCount !== 1 ? 's' : ''} match`;
      this._statusEl.appendChild(badge);
    }

    if (this.#recordIds.length > 0) {
      const preview = this.#recordIds.slice(0, 20);
      const listEl = document.createElement('div');
      listEl.className = 'bulk-wiz-record-list';
      for (const id of preview) {
        const row = document.createElement('div');
        row.textContent = id;
        listEl.appendChild(row);
      }
      if (this.#recordIds.length > 20) {
        const more = document.createElement('div');
        more.style.color = 'var(--color-text-muted)';
        more.textContent = `\u2026 and ${this.#recordIds.length - 20} more`;
        listEl.appendChild(more);
      }
      this._statusEl.appendChild(listEl);
    }
  }
}

// ---------------------------------------------------------------------------
// FieldSelectorStep
// ---------------------------------------------------------------------------

export class FieldSelectorStep {
  #cache;
  #entityLogicalName = null;
  #attributes = [];
  #selected = new Map();   // logicalName -> { logicalName, attributeType, displayName }
  #values = {};            // logicalName -> current value
  #container = null;

  constructor(metadataCache) {
    this.#cache = metadataCache;
  }

  /** Set the target entity logical name. Call before render. */
  setEntity(entityLogicalName) {
    if (this.#entityLogicalName !== entityLogicalName) {
      this.#entityLogicalName = entityLogicalName;
      this.#attributes = [];
      this.#selected.clear();
      this.#values = {};
    }
  }

  async render(container) {
    this.#container = container;
    container.innerHTML = '';

    if (!this.#entityLogicalName) {
      container.textContent = 'No entity selected.';
      return;
    }

    // Load attributes once
    if (this.#attributes.length === 0) {
      try {
        this.#attributes = await this.#cache.getAttributes(this.#entityLogicalName);
      } catch {
        container.textContent = 'Failed to load attributes.';
        return;
      }
    }

    // Search input
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'bulk-wiz-input bulk-wiz-field-search';
    search.placeholder = 'Filter attributes\u2026';
    search.addEventListener('input', () => this.#renderList(listEl, search.value));
    container.appendChild(search);

    // Field list
    const listEl = document.createElement('div');
    listEl.className = 'bulk-wiz-field-list';
    container.appendChild(listEl);

    // Value editor area
    const valueArea = document.createElement('div');
    valueArea.className = 'bulk-wiz-field-value';
    valueArea.style.display = this.#selected.size ? '' : 'none';
    container.appendChild(valueArea);
    this._valueArea = valueArea;

    this.#renderList(listEl, '');
    this.#renderValueEditors();
  }

  validate() {
    return this.#selected.size > 0 ? null : 'Please select at least one field';
  }

  /** @returns {Array<{ logicalName: string, attributeType: string, displayName: string }>} */
  getSelectedFields() {
    return [...this.#selected.values()];
  }

  /** @returns {Object} Field name -> value mapping with type-aware coercion. */
  getFieldValues() {
    const out = {};
    for (const [name, info] of this.#selected) {
      out[name] = this.#values[name] ?? null;
    }
    return out;
  }

  // -- Internal ----------------------------------------------------------------

  #sortedAttributes() {
    return [...this.#attributes].sort((a, b) => {
      const score = attr => {
        if (attr.RequiredLevel?.Value === 'ApplicationRequired' || attr.RequiredLevel?.Value === 'SystemRequired') return 0;
        if (attr.IsPrimaryName) return 1;
        if (attr.IsCustomAttribute) return 2;
        return 3;
      };
      const diff = score(a) - score(b);
      if (diff !== 0) return diff;
      return (a.LogicalName || '').localeCompare(b.LogicalName || '');
    });
  }

  #renderList(listEl, filter) {
    const q = (filter || '').toLowerCase();
    listEl.innerHTML = '';
    const sorted = this.#sortedAttributes();

    for (const attr of sorted) {
      const ln = attr.LogicalName || '';
      const dn = attr.DisplayName?.UserLocalizedLabel?.Label || ln;
      const type = attr.AttributeType || 'String';

      if (q && !ln.toLowerCase().includes(q) && !dn.toLowerCase().includes(q)) continue;

      const row = document.createElement('div');
      row.className = 'bulk-wiz-field-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.#selected.has(ln);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          this.#selected.set(ln, { logicalName: ln, attributeType: type, displayName: dn });
        } else {
          this.#selected.delete(ln);
          delete this.#values[ln];
        }
        this._valueArea.style.display = this.#selected.size ? '' : 'none';
        this.#renderValueEditors();
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'bulk-wiz-field-name';
      nameSpan.innerHTML = dn !== ln
        ? `${dn} <small>${ln}</small>`
        : ln;

      const typeSpan = document.createElement('span');
      typeSpan.className = 'bulk-wiz-field-type';
      typeSpan.textContent = type;

      row.append(cb, nameSpan, typeSpan);
      listEl.appendChild(row);
    }
  }

  #renderValueEditors() {
    const area = this._valueArea;
    if (!area) return;
    area.innerHTML = '';
    if (this.#selected.size === 0) return;

    for (const [name, info] of this.#selected) {
      const label = document.createElement('label');
      const labelText = document.createElement('span');
      labelText.textContent = info.displayName;
      labelText.style.minWidth = '120px';
      label.appendChild(labelText);

      const input = this.#createInput(name, info.attributeType);
      label.appendChild(input);
      area.appendChild(label);
    }
  }

  #createInput(fieldName, type) {
    const stored = this.#values[fieldName];
    const onChange = val => { this.#values[fieldName] = val; };

    switch (type) {
      case 'Memo': {
        const ta = document.createElement('textarea');
        ta.rows = 2;
        ta.value = stored ?? '';
        ta.addEventListener('input', () => onChange(ta.value));
        return ta;
      }
      case 'Integer':
      case 'BigInt': {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '1';
        inp.value = stored ?? '';
        inp.addEventListener('input', () => onChange(inp.value ? Number(inp.value) : null));
        return inp;
      }
      case 'Double':
      case 'Decimal':
      case 'Money': {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = 'any';
        inp.value = stored ?? '';
        inp.addEventListener('input', () => onChange(inp.value ? Number(inp.value) : null));
        return inp;
      }
      case 'Boolean': {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = stored ?? false;
        cb.addEventListener('change', () => onChange(cb.checked));
        return cb;
      }
      case 'DateTime': {
        const inp = document.createElement('input');
        inp.type = 'datetime-local';
        inp.value = stored ?? '';
        inp.addEventListener('input', () => onChange(inp.value || null));
        return inp;
      }
      case 'Picklist':
      case 'Status':
      case 'State': {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">-- select --</option>';
        if (stored !== undefined && stored !== null) sel.value = stored;
        sel.addEventListener('change', () => onChange(sel.value ? Number(sel.value) : null));
        // Lazy-load options
        this.#loadOptionSet(fieldName, sel, stored);
        return sel;
      }
      case 'Lookup':
      case 'Customer':
      case 'Owner': {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'GUID';
        inp.value = stored ?? '';
        inp.addEventListener('input', () => onChange(inp.value.trim() || null));
        return inp;
      }
      default: {
        // String and anything else
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = stored ?? '';
        inp.addEventListener('input', () => onChange(inp.value));
        return inp;
      }
    }
  }

  async #loadOptionSet(fieldName, selectEl, storedValue) {
    try {
      const options = await this.#cache.getOptionSet(this.#entityLogicalName, fieldName);
      if (!options || !Array.isArray(options)) return;
      for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.Value;
        o.textContent = `${opt.Label?.UserLocalizedLabel?.Label || opt.Value} (${opt.Value})`;
        selectEl.appendChild(o);
      }
      if (storedValue !== undefined && storedValue !== null) {
        selectEl.value = storedValue;
      }
    } catch {
      // Options unavailable — user can type manually
    }
  }
}

// ---------------------------------------------------------------------------
// fetchAllRecords utility
// ---------------------------------------------------------------------------

/**
 * Fetch all records matching a filter, following @odata.nextLink pagination.
 * @param {import('../../shared/api-client.js').DataverseClient} apiClient
 * @param {string} entitySetName  e.g. "accounts"
 * @param {string} filter         OData $filter expression
 * @param {string} select         Comma-separated $select fields
 * @param {number} [limit=10000]  Safety cap on total records
 * @returns {Promise<Object[]>}   Array of record objects
 */
export async function fetchAllRecords(apiClient, entitySetName, filter, select, limit = 10000) {
  const records = [];
  let url = `${entitySetName}?$filter=${encodeURIComponent(filter)}`;
  if (select) url += `&$select=${encodeURIComponent(select)}`;

  while (url && records.length < limit) {
    const data = await apiClient.request('GET', url);
    const batch = data.value || [];
    records.push(...batch);

    if (records.length >= limit) {
      records.length = limit;
      break;
    }

    const nextLink = data['@odata.nextLink'];
    if (!nextLink) break;

    // nextLink is an absolute URL — extract the relative portion after /api/data/vX.X/
    const match = nextLink.match(/\/api\/data\/v[\d.]+\/(.+)/);
    url = match ? match[1] : null;
  }

  return records;
}
