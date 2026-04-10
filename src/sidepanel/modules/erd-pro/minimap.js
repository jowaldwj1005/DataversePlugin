/**
 * ERD Pro — Throttled canvas minimap
 * @module erd-pro/minimap
 */

export class Minimap {
  #canvas;
  #ctx;
  #state;
  #viewport;
  #width = 140;
  #height = 100;
  #lastRender = 0;
  #throttleMs = 50;
  #pending = null;

  constructor(container, state, viewport) {
    this.#state = state;
    this.#viewport = viewport;

    this.#canvas = document.createElement('canvas');
    this.#canvas.className = 'erdp-minimap';
    this.#canvas.width = this.#width;
    this.#canvas.height = this.#height;
    this.#ctx = this.#canvas.getContext('2d');
    container.appendChild(this.#canvas);

    // Click to navigate
    this.#canvas.addEventListener('pointerdown', (e) => this.#onClick(e));
  }

  requestRender() {
    const now = performance.now();
    if (now - this.#lastRender < this.#throttleMs) {
      if (!this.#pending) {
        this.#pending = setTimeout(() => {
          this.#pending = null;
          this.render();
        }, this.#throttleMs);
      }
      return;
    }
    this.render();
  }

  render() {
    this.#lastRender = performance.now();
    const ctx = this.#ctx;
    const { positions, entitySizes } = this.#state;
    const w = this.#width;
    const h = this.#height;

    ctx.clearRect(0, 0, w, h);

    if (positions.size === 0) return;

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [name, pos] of positions) {
      const size = entitySizes.get(name);
      if (!size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.w);
      maxY = Math.max(maxY, pos.y + size.h);
    }

    const pad = 20;
    const contentW = maxX - minX + pad * 2;
    const contentH = maxY - minY + pad * 2;
    const scale = Math.min(w / contentW, h / contentH);

    // Background
    ctx.fillStyle = 'rgba(30, 30, 30, 0.8)';
    ctx.fillRect(0, 0, w, h);

    // Entity dots
    ctx.fillStyle = 'rgba(107, 197, 232, 0.7)';
    for (const [name, pos] of positions) {
      const size = entitySizes.get(name);
      if (!size) continue;
      const x = (pos.x - minX + pad) * scale;
      const y = (pos.y - minY + pad) * scale;
      const ew = size.w * scale;
      const eh = size.h * scale;
      ctx.fillRect(x, y, Math.max(2, ew), Math.max(1, eh));
    }

    // Viewport rectangle
    if (this.#viewport) {
      const bounds = this.#viewport.getVisibleBounds();
      const vx = (bounds.x - minX + pad) * scale;
      const vy = (bounds.y - minY + pad) * scale;
      const vw = bounds.width * scale;
      const vh = bounds.height * scale;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(vx, vy, vw, vh);
    }
  }

  #onClick(e) {
    if (!this.#viewport) return;
    const rect = this.#canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Convert minimap coords to diagram coords and center viewport there
    const { positions, entitySizes } = this.#state;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [name, pos] of positions) {
      const size = entitySizes.get(name);
      if (!size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.w);
      maxY = Math.max(maxY, pos.y + size.h);
    }

    const pad = 20;
    const contentW = maxX - minX + pad * 2;
    const contentH = maxY - minY + pad * 2;
    const scale = Math.min(this.#width / contentW, this.#height / contentH);

    const diagX = mx / scale + minX - pad;
    const diagY = my / scale + minY - pad;

    // Center viewport on clicked point
    const svgRect = this.#canvas.parentElement?.querySelector('svg')?.getBoundingClientRect();
    if (svgRect) {
      this.#state.pan.x = svgRect.width / 2 - diagX * this.#state.zoom;
      this.#state.pan.y = svgRect.height / 2 - diagY * this.#state.zoom;
      this.#viewport.updateTransform();
    }
  }

  destroy() {
    if (this.#pending) clearTimeout(this.#pending);
    this.#canvas.remove();
  }
}
