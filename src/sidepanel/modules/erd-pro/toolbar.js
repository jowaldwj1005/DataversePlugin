/**
 * ERD Pro — Toolbar & filter bar
 * @module erd-pro/toolbar
 */

export class Toolbar {
  #container;
  #state;
  #onLoad;
  #onExport;
  #solSelect;
  #searchInput;
  #presetBtns = new Map();
  #zoomLabel;

  /**
   * @param {HTMLElement} container - parent element
   * @param {import('./state.js').ErdState} state
   * @param {{ onLoad: Function, onExport: Function }} callbacks
   */
  constructor(container, state, callbacks) {
    this.#container = container;
    this.#state = state;
    this.#onLoad = callbacks.onLoad;
    this.#onExport = callbacks.onExport;
  }

  build() {
    const bar = document.createElement('div');
    bar.className = 'erdp-toolbar';

    // Solution select
    this.#solSelect = document.createElement('select');
    this.#solSelect.className = 'erdp-toolbar-select';
    this.#solSelect.innerHTML = '<option value="">Select solution…</option>';
    bar.appendChild(this.#solSelect);

    // Load button
    const loadBtn = this.#iconBtn('↻', 'Load ERD', () => {
      const val = this.#solSelect.value;
      if (val) this.#onLoad(val);
    });
    bar.appendChild(loadBtn);

    bar.appendChild(this.#divider());

    // Preset buttons
    const presets = [
      { id: 'overview', label: 'Overview', tip: 'Entity names only' },
      { id: 'standard', label: 'Standard', tip: 'PK + FK + Name fields' },
      { id: 'detailed', label: 'Detailed', tip: 'All non-system fields' },
    ];
    const presetGroup = document.createElement('div');
    presetGroup.className = 'erdp-preset-group';
    for (const p of presets) {
      const btn = document.createElement('button');
      btn.className = 'erdp-preset-btn' + (p.id === this.#state.preset ? ' erdp-active' : '');
      btn.textContent = p.label;
      btn.title = p.tip;
      btn.addEventListener('click', () => this.setPreset(p.id));
      presetGroup.appendChild(btn);
      this.#presetBtns.set(p.id, btn);
    }
    bar.appendChild(presetGroup);

    bar.appendChild(this.#divider());

    // Search
    this.#searchInput = document.createElement('input');
    this.#searchInput.type = 'text';
    this.#searchInput.placeholder = 'Filter…';
    this.#searchInput.className = 'erdp-toolbar-search';
    this.#searchInput.addEventListener('input', () => {
      this.#state.set('filterText', this.#searchInput.value.toLowerCase());
    });
    bar.appendChild(this.#searchInput);

    // Custom-only toggle
    const customBtn = this.#toggleBtn('C', 'Custom entities only', () => {
      this.#state.set('filterCustomOnly', !this.#state.filterCustomOnly);
      customBtn.classList.toggle('erdp-active', this.#state.filterCustomOnly);
    });
    bar.appendChild(customBtn);

    // Hide system fields toggle
    const sysBtn = this.#toggleBtn('S', 'Hide system fields', () => {
      this.#state.set('filterHideSystem', !this.#state.filterHideSystem);
      sysBtn.classList.toggle('erdp-active', this.#state.filterHideSystem);
    });
    bar.appendChild(sysBtn);

    bar.appendChild(this.#divider());

    // Zoom controls
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'erdp-zoom-controls';
    zoomGroup.appendChild(this.#iconBtn('−', 'Zoom out', () => this.#state.set('zoom', Math.max(0.1, this.#state.zoom - 0.1))));
    this.#zoomLabel = document.createElement('span');
    this.#zoomLabel.className = 'erdp-zoom-label';
    this.#zoomLabel.textContent = '100%';
    zoomGroup.appendChild(this.#zoomLabel);
    zoomGroup.appendChild(this.#iconBtn('+', 'Zoom in', () => this.#state.set('zoom', Math.min(3, this.#state.zoom + 0.1))));
    zoomGroup.appendChild(this.#iconBtn('⊡', 'Fit to view', () => this.#state.set('zoom', 'fit')));
    bar.appendChild(zoomGroup);

    bar.appendChild(this.#divider());

    // Export button
    const exportBtn = this.#iconBtn('↓', 'Export', () => this.#onExport());
    exportBtn.classList.add('erdp-export-btn');
    bar.appendChild(exportBtn);

    this.#container.appendChild(bar);
  }

  /** Populate solution dropdown. */
  setSolutions(solutions) {
    this.#solSelect.innerHTML = '<option value="">Select solution…</option>';
    for (const sol of solutions) {
      const opt = document.createElement('option');
      opt.value = sol.uniquename;
      opt.textContent = `${sol.friendlyname} (${sol.uniquename})`;
      this.#solSelect.appendChild(opt);
    }
  }

  /** Select a solution in the dropdown. */
  selectSolution(uniqueName) {
    this.#solSelect.value = uniqueName;
  }

  /** Update preset button states. */
  setPreset(id) {
    this.#state.set('preset', id);
    for (const [pid, btn] of this.#presetBtns) {
      btn.classList.toggle('erdp-active', pid === id);
    }
  }

  /** Update zoom label. */
  updateZoom(z) {
    if (this.#zoomLabel) this.#zoomLabel.textContent = `${Math.round(z * 100)}%`;
  }

  // --- Private helpers ---

  #iconBtn(icon, tip, handler) {
    const btn = document.createElement('button');
    btn.className = 'erdp-toolbar-btn';
    btn.textContent = icon;
    btn.title = tip;
    btn.addEventListener('click', handler);
    return btn;
  }

  #toggleBtn(label, tip, handler) {
    const btn = document.createElement('button');
    btn.className = 'erdp-toolbar-btn erdp-toggle';
    btn.textContent = label;
    btn.title = tip;
    btn.addEventListener('click', handler);
    return btn;
  }

  #divider() {
    const d = document.createElement('span');
    d.className = 'erdp-toolbar-divider';
    return d;
  }
}
