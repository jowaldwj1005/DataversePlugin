/**
 * ERD Pro — Documentation-grade Entity Relationship Diagram
 *
 * Orchestrator module: wires together state, data loading, layout,
 * channel routing, SVG rendering, viewport, and interactions.
 *
 * @module ErdPro
 */

import { ErdState } from './erd-pro/state.js';
import { DataLoader } from './erd-pro/data-loader.js';
import { LayoutEngine } from './erd-pro/layout-engine.js';
import { ChannelRouter } from './erd-pro/channel-router.js';
import { SvgRenderer } from './erd-pro/svg-renderer.js';
import { Viewport } from './erd-pro/viewport.js';
import { Minimap } from './erd-pro/minimap.js';
import { InteractionManager } from './erd-pro/interaction.js';
import { Toolbar } from './erd-pro/toolbar.js';
import { ExportEngine } from './erd-pro/export-engine.js';
import { DetailPanel } from './erd-pro/detail-panel.js';
import { FocusMode } from './erd-pro/focus-mode.js';
import { SVG_NS } from './erd-pro/constants.js';
import { svgEl, entityHeight } from './erd-pro/helpers.js';

export default class ErdPro {
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
  #focusMode;
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
    this.#container.classList.add('erdp-container');

    // Toolbar
    this.#toolbar = new Toolbar(this.#container, this.#state, {
      onLoad: (sol) => this.#loadSolution(sol),
      onExport: () => this.#exporter?.showExportMenu(this.#container),
    });
    this.#toolbar.build();

    // Content area
    const content = document.createElement('div');
    content.className = 'erdp-content';
    this.#container.appendChild(content);

    // SVG canvas wrapper
    this.#canvasWrap = document.createElement('div');
    this.#canvasWrap.className = 'erdp-canvas-wrap';
    content.appendChild(this.#canvasWrap);

    // SVG element
    this.#svg = document.createElementNS(SVG_NS, 'svg');
    this.#svg.setAttribute('class', 'erdp-svg');
    this.#svg.setAttribute('width', '100%');
    this.#svg.setAttribute('height', '100%');
    this.#canvasWrap.appendChild(this.#svg);

    // SVG root group (pan/zoom target)
    this.#svgRoot = svgEl('g', { id: 'erdp-root' });
    this.#svg.appendChild(this.#svgRoot);

    // Renderer
    this.#renderer = new SvgRenderer(this.#svgRoot, this.#state);

    // Viewport (pan/zoom)
    this.#viewport = new Viewport(this.#svg, this.#svgRoot, this.#state, this.#renderer, () => {
      this.#minimap?.requestRender();
      this.#toolbar?.updateZoom(this.#state.zoom);
    });
    this.#viewport.setup();

    // Minimap
    this.#minimap = new Minimap(this.#canvasWrap, this.#state, this.#viewport);

    // Export engine
    this.#exporter = new ExportEngine(this.#svg, this.#state);

    // Detail panel
    this.#detailPanel = new DetailPanel(content, this.#state, this.#cache);

    // Loading overlay
    this.#loadingEl = document.createElement('div');
    this.#loadingEl.className = 'erdp-loading';
    this.#loadingEl.style.display = 'none';
    this.#canvasWrap.appendChild(this.#loadingEl);

    // Notification
    this.#notificationEl = document.createElement('div');
    this.#notificationEl.className = 'erdp-notification';
    this.#notificationEl.style.display = 'none';
    this.#container.appendChild(this.#notificationEl);

    // Wire state subscriptions
    this.#wireSubscriptions();

    // Load solutions
    try {
      const solutions = await this.#loader.loadSolutions();
      this.#toolbar.setSolutions(solutions);

      // Auto-load last solution
      const stored = await chrome.storage?.local?.get('erdpro_lastSolution');
      const lastSol = stored?.erdpro_lastSolution;
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

  onHide() {
    this.#savePersistence();
  }

  // =========================================================================
  // Solution loading
  // =========================================================================

  async #loadSolution(uniqueName) {
    this.#showLoading(true, 'Loading…');

    try {
      await this.#loader.loadSolution(uniqueName, (msg) => {
        this.#showLoading(true, msg);
      });

      // Compute layout
      this.#layout.compute();

      // Route edges
      this.#router.computeAll();

      // Render
      this.#renderer.renderAll();

      // Bind interactions
      this.#interaction?.destroy();
      this.#interaction = new InteractionManager(
        this.#state, this.#renderer, this.#router, this.#viewport, this.#minimap,
        {
          onSelect: (name) => this.#onEntitySelect(name),
          onExpand: (name, expanded) => this.#onEntityExpand(name, expanded),
        }
      );
      this.#interaction.bindAll();

      // Focus mode
      this.#focusMode = new FocusMode(this.#state, this.#renderer, this.#layout, this.#router);

      // Fit to view
      this.#viewport.fitToContent();
      this.#minimap.requestRender();

      // Save last solution
      chrome.storage?.local?.set({ erdpro_lastSolution: uniqueName });

      // Restore saved layout if available
      await this.#restorePersistence(uniqueName);

    } catch (err) {
      this.#showNotification(`Failed to load: ${err.message}`, 'error');
    } finally {
      this.#showLoading(false);
    }
  }

  // =========================================================================
  // Event handlers
  // =========================================================================

  #wireSubscriptions() {
    // Zoom changes from toolbar buttons
    this.#state.on('zoom', (z) => {
      if (z === 'fit') {
        this.#viewport.fitToContent();
      } else {
        this.#viewport.updateTransform();
      }
      this.#toolbar.updateZoom(this.#state.zoom);
    });

    // Preset changes
    this.#state.on('preset', () => {
      if (this.#state.entities.length === 0) return;
      this.#recomputeAndRender();
    });

    // Filter changes
    this.#state.on('filterText', () => this.#applyFilter());
    this.#state.on('filterCustomOnly', () => this.#applyFilter());
    this.#state.on('filterHideSystem', () => this.#applyFilter());
  }

  #onEntitySelect(name) {
    this.#detailPanel?.show(name);
  }

  #onEntityExpand(name, expanded) {
    // Recompute size for this entity
    const fields = this.#getVisibleFields(name);
    this.#state.entitySizes.set(name, { w: 220, h: entityHeight(fields.length) });

    // Rebuild entity and re-route connected edges
    this.#renderer.rebuildEntity(name);
    this.#router.computeForEntity(name);
    for (const [schema, pathD] of this.#state.edgePaths) {
      const rel = this.#state.relationships.find(r => r.schemaName === schema);
      if (rel && (rel.sourceEntity === name || rel.targetEntity === name)) {
        this.#renderer.updateEdgePath(schema, pathD);
      }
    }

    // Re-bind interaction for rebuilt entity
    const g = this.#renderer.getEntityEl(name);
    if (g) {
      const ent = this.#state.entities.find(e => e.LogicalName === name);
      if (ent) this.#interaction?.bindAll(); // rebind all (simpler than single-entity bind)
    }

    this.#minimap?.requestRender();
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

  #recomputeAndRender() {
    this.#layout.compute();
    this.#router.computeAll();
    this.#renderer.renderAll();
    this.#interaction?.destroy();
    this.#interaction = new InteractionManager(
      this.#state, this.#renderer, this.#router, this.#viewport, this.#minimap,
      {
        onSelect: (name) => this.#onEntitySelect(name),
        onExpand: (name, expanded) => this.#onEntityExpand(name, expanded),
      }
    );
    this.#interaction.bindAll();
    this.#viewport.fitToContent();
    this.#minimap?.requestRender();
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  #getVisibleFields(entityName) {
    const preset = this.#state.preset;
    if (preset === 'overview') return [];
    const isExpanded = this.#state.expanded.get(entityName) === true;
    const allFields = isExpanded
      ? (this.#state.entityAllFields.get(entityName) || [])
      : (this.#state.entityKeyFields.get(entityName) || []);
    if (isExpanded) return allFields;
    const filtered = allFields.filter(f => f.isPk || !this.#state.hiddenSystemFields.has(f.name));
    return filtered.length > 15 ? filtered.slice(0, 15) : filtered;
  }

  #showLoading(show, message = '') {
    if (!this.#loadingEl) return;
    this.#loadingEl.style.display = show ? 'flex' : 'none';
    this.#loadingEl.textContent = message;
  }

  #showNotification(message, type = 'info') {
    if (!this.#notificationEl) return;
    this.#notificationEl.textContent = message;
    this.#notificationEl.className = `erdp-notification erdp-notification-${type}`;
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

    const expanded = {};
    for (const [ent, exp] of this.#state.expanded) {
      if (exp) expanded[ent] = true;
    }

    try {
      await chrome.storage?.local?.set({
        [`erdpro_layout_${name}`]: {
          positions,
          expanded,
          preset: this.#state.preset,
          pan: this.#state.pan,
          zoom: this.#state.zoom,
        },
      });
    } catch { /* ok */ }
  }

  async #restorePersistence(uniqueName) {
    try {
      const stored = await chrome.storage?.local?.get(`erdpro_layout_${uniqueName}`);
      const data = stored?.[`erdpro_layout_${uniqueName}`];
      if (!data?.positions) return;

      let restored = false;
      for (const [ent, pos] of Object.entries(data.positions)) {
        if (this.#state.positions.has(ent) && pos?.x != null && pos?.y != null) {
          this.#state.positions.set(ent, { x: pos.x, y: pos.y });
          restored = true;
        }
      }

      if (data.expanded) {
        for (const [ent, exp] of Object.entries(data.expanded)) {
          if (exp) this.#state.expanded.set(ent, true);
        }
      }

      if (data.preset) this.#toolbar.setPreset(data.preset);
      if (data.pan) this.#state.pan = data.pan;
      if (data.zoom && data.zoom !== 'fit') this.#state.zoom = data.zoom;

      if (restored) {
        this.#router.computeAll();
        this.#renderer.renderAll();
        this.#interaction?.bindAll();
        this.#viewport.updateTransform();
        this.#minimap?.requestRender();
      }
    } catch { /* ok */ }
  }
}
