/**
 * ERD Pro — Pan/zoom with viewport culling
 * @module erd-pro/viewport
 */

export class Viewport {
  #svg;
  #root;
  #state;
  #renderer;
  #onTransform;
  #isPanning = false;
  #panStart = { x: 0, y: 0 };
  #panOrigin = { x: 0, y: 0 };
  #cullingScheduled = false;
  #listeners = [];

  constructor(svg, root, state, renderer, onTransform) {
    this.#svg = svg;
    this.#root = root;
    this.#state = state;
    this.#renderer = renderer;
    this.#onTransform = onTransform;
  }

  setup() {
    const svg = this.#svg;

    // Wheel zoom (toward cursor)
    const onWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      const newZoom = Math.max(0.1, Math.min(3, this.#state.zoom + delta));

      // Zoom toward cursor position
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
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    this.#listeners.push(['wheel', onWheel]);

    // Pan via pointer drag on background
    const onPointerDown = (e) => {
      if (e.target !== svg && !e.target.closest('.erdp-edges')) return;
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

  /** Get visible bounds in diagram coordinates. */
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

  /** Auto-zoom to fit all content. */
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
  }

  destroy() {
    for (const [event, handler] of this.#listeners) {
      this.#svg.removeEventListener(event, handler);
    }
    this.#listeners = [];
  }

  // --- Culling ---

  #scheduleCulling() {
    if (this.#cullingScheduled) return;
    this.#cullingScheduled = true;
    requestAnimationFrame(() => {
      this.#cullingScheduled = false;
      // Only cull if we have 100+ entities
      if (this.#state.positions.size < 100) return;
      const bounds = this.getVisibleBounds();
      const margin = 200; // render slightly beyond viewport
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
