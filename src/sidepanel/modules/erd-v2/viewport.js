/**
 * ERD v2 — Pan/zoom with trackpad support and field visibility
 *
 * Wheel = zoom (centered on cursor).
 * Ctrl+wheel = zoom (trackpad pinch gesture).
 * Plain two-finger scroll (no ctrl) = pan (trackpad scroll gesture).
 * Field visibility toggles at zoom threshold.
 *
 * @module erd-v2/viewport
 */

import { ZOOM_THRESHOLD_FIELDS } from './constants.js';

export class Viewport {
  #svg;
  #root;
  #state;
  #renderer;
  #onTransform;
  #onFieldsToggle;
  #isPanning = false;
  #panStart = { x: 0, y: 0 };
  #panOrigin = { x: 0, y: 0 };
  #cullingScheduled = false;
  #fieldsVisible = true;
  #listeners = [];

  /**
   * @param {SVGSVGElement} svg
   * @param {SVGGElement} root
   * @param {object} state
   * @param {object} renderer
   * @param {Function} onTransform - called on every pan/zoom
   * @param {Function} onFieldsToggle - called when field visibility changes
   */
  constructor(svg, root, state, renderer, onTransform, onFieldsToggle) {
    this.#svg = svg;
    this.#root = root;
    this.#state = state;
    this.#renderer = renderer;
    this.#onTransform = onTransform;
    this.#onFieldsToggle = onFieldsToggle;
  }

  setup() {
    const svg = this.#svg;

    // Wheel handler — zoom or pan depending on context
    const onWheel = (e) => {
      e.preventDefault();

      // Trackpad pinch sends ctrlKey=true + small deltaY
      // Mouse wheel sends ctrlKey=false + larger deltaY
      // Strategy: ctrlKey OR non-trackpad wheel → zoom; else → pan
      const isZoom = e.ctrlKey || Math.abs(e.deltaY) >= 50;

      if (isZoom) {
        // Zoom toward cursor
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        const newZoom = Math.max(0.1, Math.min(3, this.#state.zoom + delta));

        const rect = svg.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const oldZoom = this.#state.zoom;
        const scale = newZoom / oldZoom;

        this.#state.pan.x = mx - (mx - this.#state.pan.x) * scale;
        this.#state.pan.y = my - (my - this.#state.pan.y) * scale;
        this.#state.zoom = newZoom;

        this.updateTransform();
        this.#state.set('zoom', newZoom);
        this.#checkFieldVisibility(newZoom);
      } else {
        // Pan (trackpad two-finger scroll)
        this.#state.pan.x -= e.deltaX;
        this.#state.pan.y -= e.deltaY;
        this.updateTransform();
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    this.#listeners.push(['wheel', onWheel]);

    // Pan via pointer drag on background
    const onPointerDown = (e) => {
      if (e.target !== svg && !e.target.closest('.erdv2-edges')) return;
      this.#isPanning = true;
      this.#panStart = { x: e.clientX, y: e.clientY };
      this.#panOrigin = { ...this.#state.pan };
      svg.setPointerCapture(e.pointerId);
      svg.style.cursor = 'grabbing';
    };
    svg.addEventListener('pointerdown', onPointerDown);
    this.#listeners.push(['pointerdown', onPointerDown]);

    const onPointerMove = (e) => {
      if (!this.#isPanning) return;
      this.#state.pan.x = this.#panOrigin.x + (e.clientX - this.#panStart.x);
      this.#state.pan.y = this.#panOrigin.y + (e.clientY - this.#panStart.y);
      this.updateTransform();
    };
    svg.addEventListener('pointermove', onPointerMove);
    this.#listeners.push(['pointermove', onPointerMove]);

    const onPointerUp = (e) => {
      if (!this.#isPanning) return;
      this.#isPanning = false;
      svg.releasePointerCapture(e.pointerId);
      svg.style.cursor = '';
    };
    svg.addEventListener('pointerup', onPointerUp);
    this.#listeners.push(['pointerup', onPointerUp]);
  }

  updateTransform() {
    const { pan, zoom } = this.#state;
    this.#root.setAttribute('transform', `translate(${pan.x}, ${pan.y}) scale(${zoom})`);
    this.#scheduleCulling();
    if (this.#onTransform) this.#onTransform();
  }

  getVisibleBounds() {
    const rect = this.#svg.getBoundingClientRect();
    const { pan, zoom } = this.#state;
    return {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
  }

  fitToContent() {
    const { positions, entitySizes } = this.#state;
    if (positions.size === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [name, pos] of positions) {
      const size = entitySizes.get(name);
      if (!size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.w);
      maxY = Math.max(maxY, pos.y + size.h);
    }

    const rect = this.#svg.getBoundingClientRect();
    const padding = 40;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;

    const zoom = Math.min(1.2, rect.width / contentW, rect.height / contentH);
    const panX = (rect.width - contentW * zoom) / 2 - (minX - padding) * zoom;
    const panY = (rect.height - contentH * zoom) / 2 - (minY - padding) * zoom;

    this.#state.zoom = zoom;
    this.#state.pan = { x: panX, y: panY };
    this.updateTransform();
    this.#state.set('zoom', zoom);
    this.#checkFieldVisibility(zoom);
  }

  smoothPanTo(x, y, duration = 300) {
    const rect = this.#svg.getBoundingClientRect();
    const zoom = this.#state.zoom;
    const targetPanX = rect.width / 2 - x * zoom;
    const targetPanY = rect.height / 2 - y * zoom;

    const startPan = { ...this.#state.pan };
    const startTime = performance.now();

    const animate = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.#state.pan.x = startPan.x + (targetPanX - startPan.x) * ease;
      this.#state.pan.y = startPan.y + (targetPanY - startPan.y) * ease;
      this.updateTransform();
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  destroy() {
    for (const [event, handler] of this.#listeners) {
      this.#svg.removeEventListener(event, handler);
    }
    this.#listeners = [];
  }

  // --- Field visibility ---

  #checkFieldVisibility(zoom) {
    const shouldShow = zoom >= ZOOM_THRESHOLD_FIELDS;
    if (shouldShow !== this.#fieldsVisible) {
      this.#fieldsVisible = shouldShow;
      if (this.#onFieldsToggle) this.#onFieldsToggle(shouldShow);
    }
  }

  // --- Culling ---

  #scheduleCulling() {
    if (this.#cullingScheduled) return;
    this.#cullingScheduled = true;
    requestAnimationFrame(() => {
      this.#cullingScheduled = false;
      if (this.#state.positions.size < 100) return;
      const bounds = this.getVisibleBounds();
      const margin = 200;
      for (const [name, pos] of this.#state.positions) {
        const size = this.#state.entitySizes.get(name);
        if (!size) continue;
        const visible = pos.x + size.w > bounds.x - margin &&
                        pos.x < bounds.x + bounds.width + margin &&
                        pos.y + size.h > bounds.y - margin &&
                        pos.y < bounds.y + bounds.height + margin;
        this.#renderer.setVisibility(name, visible);
      }
    });
  }
}
