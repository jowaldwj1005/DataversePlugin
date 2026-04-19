/**
 * ERD v2 — Dagre-powered Entity Relationship Diagram
 *
 * Uses @dagrejs/dagre for proper hierarchical layout with actual entity sizes.
 * Always renders full entity cards; field visibility toggled by zoom.
 * Single-click select + detail panel. No focus mode.
 *
 * @module ErdV2
 */

import { ErdState } from './erd-v2/state.js';
import { DataLoader } from './erd-v2/data-loader.js';
import { LayoutEngine } from './erd-v2/layout-engine.js';
import { ChannelRouter } from './erd-v2/channel-router.js';
import { SvgRenderer } from './erd-v2/svg-renderer.js';
import { Viewport } from './erd-v2/viewport.js';
import { Minimap } from './erd-v2/minimap.js';
import { InteractionManager } from './erd-v2/interaction.js';
import { Toolbar } from './erd-v2/toolbar.js';
import { ExportEngine } from './erd-v2/export-engine.js';
import { DetailPanel } from './erd-v2/detail-panel.js';
import { SVG_NS, ZOOM_THRESHOLD_FIELDS } from './erd-v2/constants.js';
import { svgEl } from './erd-v2/helpers.js';

export default class ErdV2 {
  #container;
  #api;
  #cache;
  #state;
  #loader;
  #layout;
  #router;
  #renderer;
  #viewport;
  #minimap;
  #interaction;
  #toolbar;
  #exporter;
  #detailPanel;
  #svg;
  #svgRoot;
  #canvasWrap;
  #loadingEl;
  #notificationEl;

  constructor(container, apiClient, metadataCache) {
    this.#container = container;
    this.#api = apiClient;
    this.#cache = metadataCache;

    this.#state = new ErdState();
    this.#loader = new DataLoader(apiClient, metadataCache, this.#state);
    this.#layout = new LayoutEngine(this.#state);
    this.#router = new ChannelRouter(this.#state);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async render() {
    this.#container.innerHTML = '';
    this.#container.classList.add('erdv2-container');

    // Toolbar
    this.#toolbar = new Toolbar(this.#container, this.#state, {
      onLoad: (sol) => this.#loadSolution(sol),
      onExport: () => this.#exporter?.showExportMenu(this.#container),
    });
    this.#toolbar.build();

    // Content area
    const content = document.createElement('div');
    content.className = 'erdv2-content';
    this.#container.appendChild(content);

    // SVG canvas
    this.#canvasWrap = document.createElement('div');
    this.#canvasWrap.className = 'erdv2-canvas-wrap';
    content.appendChild(this.#canvasWrap);

    this.#svg = document.createElementNS(SVG_NS, 'svg');
    this.#svg.setAttribute('class', 'erdv2-svg');
    this.#svg.setAttribute('width', '100%');
    this.#svg.setAttribute('height', '100%');
    this.#canvasWrap.appendChild(this.#svg);

    this.#svgRoot = svgEl('g', { id: 'erdv2-root' });
    this.#svg.appendChild(this.#svgRoot);

    // Renderer
    this.#renderer = new SvgRenderer(this.#svgRoot, this.#state);

    // Viewport
    this.#viewport = new Viewport(
      this.#svg, this.#svgRoot, this.#state, this.#renderer,
      () => {
        this.#minimap?.requestRender();
        this.#toolbar?.updateZoom(this.#state.zoom);
      },
      (fieldsVisible) => this.#onFieldsToggle(fieldsVisible),
    );
    this.#viewport.setup();

    // Minimap
    this.#minimap = new Minimap(this.#canvasWrap, this.#state, this.#viewport);

    // Export engine
    this.#exporter = new ExportEngine(this.#svg, this.#state);

    // Detail panel
    this.#detailPanel = new DetailPanel(content, this.#state, this.#cache);

    // Loading overlay
    this.#loadingEl = document.createElement('div');
    this.#loadingEl.className = 'erdv2-loading';
    this.#loadingEl.style.display = 'none';
    this.#canvasWrap.appendChild(this.#loadingEl);

    // Notification
    this.#notificationEl = document.createElement('div');
    this.#notificationEl.className = 'erdv2-notification';
    this.#notificationEl.style.display = 'none';
    this.#container.appendChild(this.#notificationEl);

    // Wire subscriptions
    this.#wireSubscriptions();

    // Load solutions
    try {
      const solutions = await this.#loader.loadSolutions();
      this.#toolbar.setSolutions(solutions);

      // Check URL param first (pop-out window), then storage
      const urlParams = new URLSearchParams(window.location.search);
      const urlSol = urlParams.get('solution');
      const stored = await chrome.storage?.local?.get('erdv2_lastSolution');
      const lastSol = urlSol || stored?.erdv2_lastSolution;

      if (lastSol && solutions.some(s => s.uniquename === lastSol)) {
        this.#toolbar.selectSolution(lastSol);
        await this.#loadSolution(lastSol);
      }
    } catch (err) {
      this.#showNotification(err.message, 'error');
    }
  }

  destroy() {
    this.#interaction?.destroy();
    this.#viewport?.destroy();
    this.#minimap?.destroy();
    this.#detailPanel?.destroy();
    this.#savePersistence();
    this.#container.innerHTML = '';
  }

  onHide() { this.#savePersistence(); }

  // Module Bridge
  setContext(ctx) { if (ctx.solution) this.#loadSolution(ctx.solution); }
  getContext() {
    return {
      solution: this.#state?.solutionName || null,
      entityCount: this.#state?.entities?.length || 0,
      selectedEntity: this.#state?.selectedEntity || null,
    };
  }

  // =========================================================================
  // Solution loading
  // =========================================================================

  async #loadSolution(uniqueName) {
    this.#showLoading(true, 'Loading\u2026');

    try {
      await this.#loader.loadSolution(uniqueName, (msg) => {
        this.#showLoading(true, msg);
      });

      // Compute layout with dagre (actual entity sizes)
      this.#layout.compute();

      // Simple edge routing for initial view (fit-to-content will zoom out)
      this.#router.computeSimple();

      // Render all entities as full cards
      this.#renderer.renderAll();

      // Bind interactions
      this.#bindInteractions();

      // Fit to view (determines initial zoom → may hide fields)
      this.#viewport.fitToContent();

      // Set initial field visibility based on zoom
      const fieldsVisible = this.#state.zoom >= ZOOM_THRESHOLD_FIELDS;
      this.#renderer.setFieldsVisible(fieldsVisible);
      this.#renderer.setEdgeStyle(fieldsVisible);

      this.#minimap.requestRender();

      chrome.storage?.local?.set({ erdv2_lastSolution: uniqueName });

      // Restore saved layout if available
      await this.#restorePersistence(uniqueName);

    } catch (err) {
      this.#showNotification(`Failed to load: ${err.message}`, 'error');
    } finally {
      this.#showLoading(false);
    }
  }

  // =========================================================================
  // Field visibility toggle
  // =========================================================================

  #onFieldsToggle(fieldsVisible) {
    this.#renderer.setFieldsVisible(fieldsVisible);
    this.#renderer.setEdgeStyle(fieldsVisible);
    // Always use straight-line routing — dagre's layout already minimizes crossings,
    // and the channel router needs layer data that dagre doesn't expose.
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  #wireSubscriptions() {
    this.#state.on('zoom', (z) => {
      if (z === 'fit') {
        this.#viewport.fitToContent();
      } else {
        this.#viewport.updateTransform();
      }
      this.#toolbar.updateZoom(this.#state.zoom);
    });

    this.#state.on('filterText', () => this.#applyFilter());
    this.#state.on('filterCustomOnly', () => this.#applyFilter());
  }

  #bindInteractions() {
    this.#interaction?.destroy();
    this.#interaction = new InteractionManager(
      this.#state, this.#renderer, this.#router, this.#viewport, this.#minimap,
      { onSelect: (name) => this.#detailPanel?.show(name) }
    );
    this.#interaction.bindAll();
  }

  #applyFilter() {
    const filter = this.#state.filterText;
    const customOnly = this.#state.filterCustomOnly;

    for (const ent of this.#state.entities) {
      const name = ent.LogicalName;
      const displayName = (ent.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase();
      const matchesText = !filter || name.includes(filter) || displayName.includes(filter);
      const matchesCustom = !customOnly || ent.IsCustomEntity;
      this.#renderer.setVisibility(name, matchesText && matchesCustom);
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  #showLoading(show, message = '') {
    if (!this.#loadingEl) return;
    this.#loadingEl.style.display = show ? 'flex' : 'none';
    this.#loadingEl.textContent = message;
  }

  #showNotification(message, type = 'info') {
    if (!this.#notificationEl) return;
    this.#notificationEl.textContent = message;
    this.#notificationEl.className = `erdv2-notification erdv2-notification-${type}`;
    this.#notificationEl.style.display = 'block';
    setTimeout(() => { this.#notificationEl.style.display = 'none'; }, 4000);
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  async #savePersistence() {
    const name = this.#state.solutionName;
    if (!name || this.#state.positions.size === 0) return;

    const positions = {};
    for (const [ent, pos] of this.#state.positions) {
      positions[ent] = { x: pos.x, y: pos.y };
    }

    try {
      await chrome.storage?.local?.set({
        [`erdv2_layout_${name}`]: { positions, pan: this.#state.pan, zoom: this.#state.zoom },
      });
    } catch { /* ok */ }
  }

  async #restorePersistence(uniqueName) {
    try {
      const stored = await chrome.storage?.local?.get(`erdv2_layout_${uniqueName}`);
      const data = stored?.[`erdv2_layout_${uniqueName}`];
      if (!data?.positions) return;

      let restored = false;
      for (const [ent, pos] of Object.entries(data.positions)) {
        if (this.#state.positions.has(ent) && pos?.x != null && pos?.y != null) {
          this.#state.positions.set(ent, { x: pos.x, y: pos.y });
          restored = true;
        }
      }

      if (data.pan) this.#state.pan = data.pan;
      if (data.zoom && data.zoom !== 'fit') this.#state.zoom = data.zoom;

      if (restored) {
        this.#router.computeSimple();
        this.#renderer.renderAll();
        this.#bindInteractions();
        this.#viewport.updateTransform();
        this.#minimap?.requestRender();
      }
    } catch { /* ok */ }
  }
}
