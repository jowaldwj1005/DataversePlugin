/**
 * ERD v2 — Toolbar with hint bar and pop-out button
 * @module erd-v2/toolbar
 */

export class Toolbar {
  #container;
  #state;
  #onLoad;
  #onExport;
  #solSelect;
  #searchInput;
  #zoomLabel;

  constructor(container, state, callbacks) {
    this.#container = container;
    this.#state = state;
    this.#onLoad = callbacks.onLoad;
    this.#onExport = callbacks.onExport;
  }

  build() {
    // Hint bar (shown on first use)
    this.#buildHintBar();

    const bar = document.createElement('div');
    bar.className = 'erdv2-toolbar';

    // Solution select
    this.#solSelect = document.createElement('select');
    this.#solSelect.className = 'erdv2-toolbar-select';
    this.#solSelect.innerHTML = '<option value="">Select solution\u2026</option>';
    bar.appendChild(this.#solSelect);

    // Load button
    bar.appendChild(this.#iconBtn('\u21BB', 'Load ERD', () => {
      const val = this.#solSelect.value;
      if (val) this.#onLoad(val);
    }));

    bar.appendChild(this.#divider());

    // Search
    this.#searchInput = document.createElement('input');
    this.#searchInput.type = 'text';
    this.#searchInput.placeholder = 'Filter\u2026';
    this.#searchInput.className = 'erdv2-toolbar-search';
    this.#searchInput.addEventListener('input', () => {
      this.#state.set('filterText', this.#searchInput.value.toLowerCase());
    });
    bar.appendChild(this.#searchInput);

    // Custom-only toggle
    const customBtn = this.#toggleBtn('C', 'Custom entities only', () => {
      this.#state.set('filterCustomOnly', !this.#state.filterCustomOnly);
      customBtn.classList.toggle('erdv2-active', this.#state.filterCustomOnly);
    });
    bar.appendChild(customBtn);

    bar.appendChild(this.#divider());

    // Zoom controls
    const zoomGroup = document.createElement('div');
    zoomGroup.className = 'erdv2-zoom-controls';
    zoomGroup.appendChild(this.#iconBtn('\u2212', 'Zoom out', () => this.#state.set('zoom', Math.max(0.1, this.#state.zoom - 0.1))));
    this.#zoomLabel = document.createElement('span');
    this.#zoomLabel.className = 'erdv2-zoom-label';
    this.#zoomLabel.textContent = '100%';
    zoomGroup.appendChild(this.#zoomLabel);
    zoomGroup.appendChild(this.#iconBtn('+', 'Zoom in', () => this.#state.set('zoom', Math.min(3, this.#state.zoom + 0.1))));
    zoomGroup.appendChild(this.#iconBtn('\u229E', 'Fit to view', () => this.#state.set('zoom', 'fit')));
    bar.appendChild(zoomGroup);

    bar.appendChild(this.#divider());

    // Pop-out button (text label, not icon)
    const popBtn = this.#iconBtn('Full Window', 'Open ERD in a full-size window', () => this.#popOut());
    popBtn.style.fontSize = '0.72rem';
    bar.appendChild(popBtn);

    // Export button (text label)
    const exportBtn = this.#iconBtn('Export', 'Export as SVG or PNG', () => this.#onExport());
    exportBtn.classList.add('erdv2-export-btn');
    exportBtn.style.fontSize = '0.72rem';
    bar.appendChild(exportBtn);

    this.#container.appendChild(bar);
  }

  setSolutions(solutions) {
    this.#solSelect.innerHTML = '<option value="">Select solution\u2026</option>';
    for (const sol of solutions) {
      const opt = document.createElement('option');
      opt.value = sol.uniquename;
      opt.textContent = `${sol.friendlyname} (${sol.uniquename})`;
      this.#solSelect.appendChild(opt);
    }
  }

  selectSolution(uniqueName) {
    this.#solSelect.value = uniqueName;
  }

  updateZoom(z) {
    if (this.#zoomLabel) this.#zoomLabel.textContent = `${Math.round(z * 100)}%`;
  }

  // --- Hint bar ---

  async #buildHintBar() {
    try {
      const stored = await chrome.storage?.local?.get('erdv2_hintDismissed');
      if (stored?.erdv2_hintDismissed) return;
    } catch { /* ok */ }

    const hint = document.createElement('div');
    hint.className = 'erdv2-hint';
    hint.innerHTML = 'Scroll to zoom \u00B7 Drag to pan \u00B7 Click entity for details <span class="erdv2-hint-close" title="Dismiss">\u2715</span>';

    hint.querySelector('.erdv2-hint-close').addEventListener('click', () => {
      hint.remove();
      chrome.storage?.local?.set({ erdv2_hintDismissed: true });
    });

    this.#container.appendChild(hint);
  }

  // --- Pop-out ---

  #popOut() {
    try {
      const sol = this.#state.solutionName;
      const params = new URLSearchParams({ tab: 'erdv2' });
      if (sol) params.set('solution', sol);
      chrome.windows?.create({
        url: chrome.runtime.getURL(`src/sidepanel/index.html?${params}`),
        type: 'popup',
        width: 1200,
        height: 800,
      });
    } catch (err) {
      console.warn('Pop-out not available:', err);
    }
  }

  // --- Private helpers ---

  #iconBtn(icon, tip, handler) {
    const btn = document.createElement('button');
    btn.className = 'erdv2-toolbar-btn';
    btn.textContent = icon;
    btn.title = tip;
    btn.addEventListener('click', handler);
    return btn;
  }

  #toggleBtn(label, tip, handler) {
    const btn = document.createElement('button');
    btn.className = 'erdv2-toolbar-btn erdv2-toggle';
    btn.textContent = label;
    btn.title = tip;
    btn.addEventListener('click', handler);
    return btn;
  }

  #divider() {
    const d = document.createElement('span');
    d.className = 'erdv2-toolbar-divider';
    return d;
  }
}
