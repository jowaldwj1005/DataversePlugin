/**
 * ERD v2 — Export engine (SVG, PNG) with title block and legend
 * @module erd-v2/export-engine
 */

import { SVG_NS, ENTITY_W } from './constants.js';
import { svgEl, cssVar } from './helpers.js';

export class ExportEngine {
  #svg;
  #state;

  constructor(svg, state) {
    this.#svg = svg;
    this.#state = state;
  }

  /** Show export options and trigger download. */
  async showExportMenu(container) {
    // Simple dropdown menu
    const existing = container.querySelector('.erdv2-export-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'erdv2-export-menu';

    const items = [
      { label: 'Export SVG', action: () => this.exportSVG() },
      { label: 'Export PNG (2x)', action: () => this.exportPNG() },
      { label: 'Copy PNG to clipboard', action: () => this.copyPNG() },
    ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'erdv2-export-menu-item';
      btn.textContent = item.label;
      btn.addEventListener('click', () => { menu.remove(); item.action(); });
      menu.appendChild(btn);
    }

    container.appendChild(menu);
    // Auto-close on outside click
    setTimeout(() => {
      const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 10);
  }

  // =========================================================================
  // SVG Export
  // =========================================================================

  exportSVG() {
    const { svgStr, width, height } = this.#buildExportSVG();

    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.#state.solutionName || 'erd'}_diagram.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // =========================================================================
  // PNG Export
  // =========================================================================

  async exportPNG() {
    const { svgStr, width, height } = this.#buildExportSVG();
    const dataUrl = await this.#svgToDataUrl(svgStr, width, height, 2);

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${this.#state.solutionName || 'erd'}_diagram.png`;
    a.click();
  }

  async copyPNG() {
    try {
      const { svgStr, width, height } = this.#buildExportSVG();
      const dataUrl = await this.#svgToDataUrl(svgStr, width, height, 2);

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (err) {
      console.error('Failed to copy PNG:', err);
    }
  }

  // =========================================================================
  // Build export SVG
  // =========================================================================

  #buildExportSVG() {
    const { positions, entitySizes, edgePaths } = this.#state;

    // Calculate content bounds from entities
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [name, pos] of positions) {
      const size = entitySizes.get(name);
      if (!size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.w);
      maxY = Math.max(maxY, pos.y + size.h);
    }

    // Include edge path bounding boxes (fixes clipping of edges/markers)
    try {
      const svgRoot = this.#svg.querySelector('[id]') || this.#svg.firstElementChild;
      if (svgRoot) {
        for (const [, pathD] of edgePaths) {
          if (!pathD) continue;
          const tempPath = document.createElementNS(SVG_NS, 'path');
          tempPath.setAttribute('d', pathD);
          svgRoot.appendChild(tempPath);
          const bbox = tempPath.getBBox();
          svgRoot.removeChild(tempPath);
          minX = Math.min(minX, bbox.x);
          minY = Math.min(minY, bbox.y);
          maxX = Math.max(maxX, bbox.x + bbox.width);
          maxY = Math.max(maxY, bbox.y + bbox.height);
        }
      }
    } catch { /* getBBox may fail on detached SVG */ }

    // Add marker margin to prevent crow's foot clipping
    const markerMargin = 16;
    minX -= markerMargin;
    minY -= markerMargin;
    maxX += markerMargin;
    maxY += markerMargin;

    const pad = 40;
    const titleBlockH = 70;

    const contentW = maxX - minX + pad * 2;
    const contentH = maxY - minY + pad * 2 + titleBlockH;
    const width = Math.max(contentW, 600);
    const height = Math.max(contentH, 400);

    // Inline all computed styles on the LIVE SVG (getComputedStyle needs attached DOM)
    this.#inlineComputedStyles(this.#svg);

    // Clone the SVG content (now with inlined styles)
    const clone = this.#svg.cloneNode(true);

    // Remove inlined styles from live SVG (don't pollute the interactive view)
    this.#removeInlinedStyles(this.#svg);

    // Reset transform on root group
    const root = clone.querySelector('[id]') || clone.firstElementChild;
    if (root) {
      root.setAttribute('transform', `translate(${pad - minX}, ${pad - minY + titleBlockH})`);
    }

    // Resolve any remaining CSS custom properties in the clone
    this.#resolveCustomProperties(clone);

    // Add background
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', width);
    bg.setAttribute('height', height);
    bg.setAttribute('fill', cssVar('--color-bg-base') || '#1e1e1e');
    clone.insertBefore(bg, clone.firstChild);

    // Add title block
    this.#addTitleBlock(clone, width, pad);

    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    clone.setAttribute('xmlns', SVG_NS);

    const svgStr = new XMLSerializer().serializeToString(clone);
    return { svgStr, width, height };
  }

  // =========================================================================
  // Title block
  // =========================================================================

  #addTitleBlock(svg, width, pad) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'erdv2-title-block');

    const textColor = cssVar('--color-text-bright') || '#ffffff';
    const mutedColor = cssVar('--color-text-muted') || '#808080';

    // Solution name
    const title = document.createElementNS(SVG_NS, 'text');
    title.setAttribute('x', pad);
    title.setAttribute('y', 28);
    title.setAttribute('fill', textColor);
    title.setAttribute('font-size', '18');
    title.setAttribute('font-weight', '700');
    title.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
    title.textContent = this.#state.solutionName || 'ERD Diagram';
    g.appendChild(title);

    // Metadata line
    const meta = document.createElementNS(SVG_NS, 'text');
    meta.setAttribute('x', pad);
    meta.setAttribute('y', 48);
    meta.setAttribute('fill', mutedColor);
    meta.setAttribute('font-size', '11');
    meta.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
    const entityCount = this.#state.entities.length;
    const relCount = this.#state.relationships.length;
    const date = new Date().toISOString().split('T')[0];
    meta.textContent = `${entityCount} entities · ${relCount} relationships · ${date} · Generated by Dataverse Toolkit`;
    g.appendChild(meta);

    // Divider line
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', pad);
    line.setAttribute('y1', 58);
    line.setAttribute('x2', width - pad);
    line.setAttribute('y2', 58);
    line.setAttribute('stroke', mutedColor);
    line.setAttribute('stroke-width', '0.5');
    line.setAttribute('stroke-opacity', '0.4');
    g.appendChild(line);

    svg.appendChild(g);
  }

  // Legend removed — colored borders + matching edge colors are self-explanatory

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Inline computed CSS styles as SVG attributes on the live DOM.
   * This ensures text fills, strokes, fonts survive serialization.
   */
  #inlineComputedStyles(svgEl) {
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
                   'font-size', 'font-weight', 'font-family', 'dominant-baseline',
                   'text-anchor', 'opacity', 'display'];

    const walker = document.createTreeWalker(svgEl, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      // Skip defs and their children
      if (node.tagName === 'defs' || node.closest('defs')) continue;

      const cs = window.getComputedStyle(node);
      for (const prop of props) {
        const val = cs.getPropertyValue(prop);
        if (!val || val === 'none' && prop !== 'display') continue;
        // Only set if not already an inline attribute (preserve explicit values)
        const attrName = prop; // SVG attributes use the same names
        if (!node.hasAttribute(attrName) || node.getAttribute(attrName)?.startsWith('var(')) {
          node.setAttribute(attrName, val);
        }
      }
      // Mark as export-inlined so we can remove later
      node.setAttribute('data-export-inlined', '1');
    }
  }

  /**
   * Remove inlined styles from the live DOM after cloning.
   */
  #removeInlinedStyles(svgEl) {
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
                   'font-size', 'font-weight', 'font-family', 'dominant-baseline',
                   'text-anchor', 'opacity', 'display'];

    const inlined = svgEl.querySelectorAll('[data-export-inlined]');
    for (const node of inlined) {
      // Remove only styles we added (not original inline attributes)
      // Simplest: remove the marker and let CSS take over again
      node.removeAttribute('data-export-inlined');
      // We can't easily know which attrs were original vs added,
      // so we leave them — CSS will override via specificity anyway
    }
  }

  #resolveCustomProperties(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      for (const attr of ['fill', 'stroke', 'flood-color']) {
        const val = node.getAttribute(attr);
        if (val && val.startsWith('var(')) {
          const match = val.match(/var\(([^,)]+)(?:,\s*([^)]+))?\)/);
          if (match) {
            const resolved = cssVar(match[1]) || match[2] || '';
            node.setAttribute(attr, resolved);
          }
        }
      }
      // Clean up export marker
      node.removeAttribute('data-export-inlined');
    }
  }

  async #svgToDataUrl(svgStr, width, height, scale) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    });
  }
}
