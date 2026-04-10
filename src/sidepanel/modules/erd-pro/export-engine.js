/**
 * ERD Pro — Export engine (SVG, PNG) with title block and legend
 * @module erd-pro/export-engine
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
    const existing = container.querySelector('.erdp-export-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'erdp-export-menu';

    const items = [
      { label: 'Export SVG', action: () => this.exportSVG() },
      { label: 'Export PNG (2x)', action: () => this.exportPNG() },
      { label: 'Copy PNG to clipboard', action: () => this.copyPNG() },
    ];

    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'erdp-export-menu-item';
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
    const { positions, entitySizes } = this.#state;

    // Calculate content bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [name, pos] of positions) {
      const size = entitySizes.get(name);
      if (!size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.w);
      maxY = Math.max(maxY, pos.y + size.h);
    }

    const pad = 40;
    const titleBlockH = 70;
    const legendW = 180;
    const legendH = 160;

    const contentW = maxX - minX + pad * 2;
    const contentH = maxY - minY + pad * 2 + titleBlockH;
    const width = Math.max(contentW, 600);
    const height = Math.max(contentH, 400);

    // Clone the SVG content
    const clone = this.#svg.cloneNode(true);

    // Reset transform on root group
    const root = clone.querySelector('[id]') || clone.firstElementChild;
    if (root) {
      root.setAttribute('transform', `translate(${pad - minX}, ${pad - minY + titleBlockH})`);
    }

    // Resolve CSS custom properties in the clone
    this.#resolveCustomProperties(clone);

    // Add background
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', width);
    bg.setAttribute('height', height);
    bg.setAttribute('fill', cssVar('--color-bg-base') || '#1e1e1e');
    clone.insertBefore(bg, clone.firstChild);

    // Add title block
    this.#addTitleBlock(clone, width, pad);

    // Add legend
    this.#addLegend(clone, width - legendW - pad, height - legendH - pad / 2, legendW, legendH);

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
    g.setAttribute('class', 'erdp-title-block');

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

  // =========================================================================
  // Legend
  // =========================================================================

  #addLegend(svg, x, y, w, h) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${x}, ${y})`);

    const bgColor = cssVar('--color-bg-panel') || '#2d2d2d';
    const borderColor = cssVar('--color-border') || '#404040';
    const textColor = cssVar('--color-text-primary') || '#cccccc';
    const mutedColor = cssVar('--color-text-muted') || '#808080';

    // Background
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('width', w);
    bg.setAttribute('height', h);
    bg.setAttribute('rx', '6');
    bg.setAttribute('fill', bgColor);
    bg.setAttribute('stroke', borderColor);
    bg.setAttribute('stroke-width', '1');
    bg.setAttribute('opacity', '0.9');
    g.appendChild(bg);

    // Title
    const title = document.createElementNS(SVG_NS, 'text');
    title.setAttribute('x', '10');
    title.setAttribute('y', '20');
    title.setAttribute('fill', textColor);
    title.setAttribute('font-size', '11');
    title.setAttribute('font-weight', '700');
    title.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
    title.textContent = 'Legend';
    g.appendChild(title);

    // Relationship types
    let ly = 40;
    const relTypes = [
      { label: '1:N Relationship', dash: '', color: '#6bc5e8' },
      { label: 'N:N Relationship', dash: '6 3', color: '#a78bfa' },
    ];
    for (const rt of relTypes) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', '10');
      line.setAttribute('y1', ly);
      line.setAttribute('x2', '50');
      line.setAttribute('y2', ly);
      line.setAttribute('stroke', rt.color);
      line.setAttribute('stroke-width', '2');
      if (rt.dash) line.setAttribute('stroke-dasharray', rt.dash);
      g.appendChild(line);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', '58');
      label.setAttribute('y', ly + 4);
      label.setAttribute('fill', mutedColor);
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
      label.textContent = rt.label;
      g.appendChild(label);
      ly += 20;
    }

    // Markers
    ly += 5;
    const markers = [
      { label: '||  One (mandatory)', symbol: '||' },
      { label: '><  Many', symbol: '><' },
    ];
    for (const m of markers) {
      const sym = document.createElementNS(SVG_NS, 'text');
      sym.setAttribute('x', '12');
      sym.setAttribute('y', ly + 4);
      sym.setAttribute('fill', textColor);
      sym.setAttribute('font-size', '10');
      sym.setAttribute('font-weight', '700');
      sym.setAttribute('font-family', 'monospace');
      sym.textContent = m.symbol;
      g.appendChild(sym);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', '38');
      label.setAttribute('y', ly + 4);
      label.setAttribute('fill', mutedColor);
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
      label.textContent = m.label;
      g.appendChild(label);
      ly += 18;
    }

    // Field indicators
    ly += 5;
    const indicators = [
      { label: 'Primary Key', icon: '🔑' },
      { label: 'Foreign Key (Lookup)', icon: '🔗' },
      { label: 'Required field', icon: '*' },
    ];
    for (const ind of indicators) {
      const icon = document.createElementNS(SVG_NS, 'text');
      icon.setAttribute('x', '12');
      icon.setAttribute('y', ly + 4);
      icon.setAttribute('fill', textColor);
      icon.setAttribute('font-size', '10');
      icon.textContent = ind.icon;
      g.appendChild(icon);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', '30');
      label.setAttribute('y', ly + 4);
      label.setAttribute('fill', mutedColor);
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
      label.textContent = ind.label;
      g.appendChild(label);
      ly += 18;
    }

    svg.appendChild(g);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  #resolveCustomProperties(el) {
    // Walk all elements and resolve var(--...) in fill/stroke attributes
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
