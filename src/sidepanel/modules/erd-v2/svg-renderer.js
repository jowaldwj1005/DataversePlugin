/**
 * ERD v2 — SVG renderer (full entity cards, field visibility toggle)
 *
 * Always renders entities as full cards with fields.
 * Field visibility toggled via CSS class based on zoom threshold.
 * No pill/compact/full switching — one rendering path.
 *
 * @module erd-v2/svg-renderer
 */

import {
  SVG_NS, ENTITY_W, HEADER_H, FIELD_H, FIELD_PAD, CORNER_R, MAX_KEY_FIELDS,
  ARROW_COLORS,
} from './constants.js';
import { svgEl, attrTypeShort, entityHeight } from './helpers.js';

const TYPE_COLORS = {
  String: 'string', Memo: 'string',
  Integer: 'number', BigInt: 'number', Decimal: 'number', Double: 'number', Money: 'number',
  DateTime: 'datetime',
  Picklist: 'optionset', Status: 'optionset', State: 'optionset',
  Boolean: 'boolean',
  Lookup: 'lookup', Owner: 'lookup', Customer: 'lookup',
  Uniqueidentifier: 'uniqueid',
  Image: 'image', File: 'image',
};

export class SvgRenderer {
  #state;
  #entityEls = new Map();
  #edgeEls = new Map();
  #entityColorMap = new Map();  // entityName → color (for edges)
  #parentEntities = new Set();  // entities that have children (1:N source)
  #edgeLayer;
  #entityLayer;
  #defs;
  #svgRoot;

  constructor(svgRoot, state) {
    this.#svgRoot = svgRoot;
    this.#state = state;
  }

  // =========================================================================
  // Full render
  // =========================================================================

  renderAll() {
    this.#svgRoot.innerHTML = '';
    this.#entityEls.clear();
    this.#edgeEls.clear();

    // Build entity → color map: each parent entity gets a consistent color
    this.#buildEntityColorMap();

    this.#defs = this.#createDefs();
    this.#svgRoot.appendChild(this.#defs);

    this.#edgeLayer = svgEl('g', { class: 'erdv2-edges' });
    this.#svgRoot.appendChild(this.#edgeLayer);

    this.#entityLayer = svgEl('g', { class: 'erdv2-entities' });
    this.#svgRoot.appendChild(this.#entityLayer);

    for (const [schema, pathD] of this.#state.edgePaths) {
      this.#renderEdge(schema, pathD);
    }

    for (const ent of this.#state.entities) {
      this.#renderEntity(ent);
    }
  }

  // =========================================================================
  // Field visibility (no-op — fields always visible, zoom handles readability)
  // =========================================================================

  /** No-op: fields are always rendered. At low zoom they're too small to read
   *  but the card shape stays correct. This matches dbdiagram.io / draw.io behavior. */
  setFieldsVisible(_visible) { /* intentional no-op */ }

  // =========================================================================
  // Incremental updates
  // =========================================================================

  updateEntityPosition(name, x, y) {
    const g = this.#entityEls.get(name);
    if (g) g.setAttribute('transform', `translate(${x}, ${y})`);
  }

  rebuildEntity(name) {
    const ent = this.#state.entities.find(e => e.LogicalName === name);
    if (!ent) return;
    const old = this.#entityEls.get(name);
    if (old) old.remove();
    this.#renderEntity(ent);
  }

  updateEdgePath(schema, d) {
    const g = this.#edgeEls.get(schema);
    if (!g) {
      this.#renderEdge(schema, d);
      return;
    }
    const path = g.querySelector('path');
    if (path) path.setAttribute('d', d);
  }

  updateAllEdges() {
    for (const [schema, pathD] of this.#state.edgePaths) {
      this.updateEdgePath(schema, pathD);
    }
  }

  setVisibility(name, visible) {
    const g = this.#entityEls.get(name);
    if (g) g.style.display = visible ? '' : 'none';
  }

  applyHighlight(entityName) {
    const adj = this.#state.adjacency.get(entityName) || new Set();
    // Use the entity's edge color for the selection border
    const selColor = this.#entityColorMap.get(entityName) || '#0078d4';

    for (const [name, g] of this.#entityEls) {
      g.classList.remove('erdv2-selected', 'erdv2-highlighted', 'erdv2-faded');
      if (name === entityName) {
        g.classList.add('erdv2-selected');
        const bg = g.querySelector('.erdv2-card-bg');
        if (bg) { bg.setAttribute('stroke', selColor); bg.setAttribute('stroke-width', '4'); }
        g.style.filter = `drop-shadow(0 0 8px ${selColor})`;
      } else if (adj.has(name)) {
        g.classList.add('erdv2-highlighted');
      } else {
        g.classList.add('erdv2-faded');
      }
    }

    for (const [schema, g] of this.#edgeEls) {
      const rel = this.#state.relationships.find(r => r.schemaName === schema);
      if (rel && (rel.sourceEntity === entityName || rel.targetEntity === entityName)) {
        g.classList.add('erdv2-highlighted');
        g.classList.remove('erdv2-faded');
      } else {
        g.classList.add('erdv2-faded');
        g.classList.remove('erdv2-highlighted');
      }
    }
  }

  clearHighlight() {
    for (const [name, g] of this.#entityEls) {
      g.classList.remove('erdv2-selected', 'erdv2-highlighted', 'erdv2-faded');
      g.style.filter = '';
      // Restore original border: thick colored for parents, thin gray for leaves
      const bg = g.querySelector('.erdv2-card-bg');
      if (bg) {
        const isParent = this.#parentEntities.has(name);
        bg.setAttribute('stroke', isParent ? this.#entityColorMap.get(name) : 'var(--erdv2-card-border)');
        bg.setAttribute('stroke-width', isParent ? '2.5' : '1');
      }
    }
    for (const g of this.#edgeEls.values()) {
      g.classList.remove('erdv2-highlighted', 'erdv2-faded');
    }
  }

  getEntityEl(name) { return this.#entityEls.get(name); }
  get root() { return this.#svgRoot; }

  // =========================================================================
  // Entity rendering (always full card)
  // =========================================================================

  #renderEntity(ent) {
    const name = ent.LogicalName;
    const pos = this.#state.positions.get(name);
    if (!pos) return;

    const fields = this.#getVisibleFields(name);
    const size = this.#state.entitySizes.get(name);
    const w = size?.w || ENTITY_W;
    const h = size?.h || entityHeight(fields.length);
    const isCustom = ent.IsCustomEntity;

    const g = svgEl('g', {
      class: 'erdv2-entity',
      transform: `translate(${pos.x}, ${pos.y})`,
      'data-entity': name,
    });

    // Parent entities get thick colored border, leaf entities get thin gray
    const entityColor = this.#entityColorMap.get(name);
    const isParent = entityColor && this.#parentEntities.has(name);
    const borderColor = isParent ? entityColor : 'var(--erdv2-card-border)';
    const borderWidth = isParent ? '2.5' : '1';

    // Background rect
    g.appendChild(svgEl('rect', {
      class: 'erdv2-card-bg',
      width: w, height: h, rx: CORNER_R,
      stroke: borderColor, 'stroke-width': borderWidth,
      filter: 'url(#erdv2-shadow)',
    }));

    // Header background
    g.appendChild(svgEl('rect', {
      class: isCustom ? 'erdv2-header-custom' : 'erdv2-header-system',
      width: w, height: HEADER_H, rx: CORNER_R,
    }));
    g.appendChild(svgEl('rect', {
      class: isCustom ? 'erdv2-header-custom' : 'erdv2-header-system',
      y: HEADER_H - CORNER_R, width: w, height: CORNER_R,
    }));

    // Entity display name
    const displayName = ent.DisplayName?.UserLocalizedLabel?.Label || name;
    const nameText = svgEl('text', {
      class: 'erdv2-entity-name',
      x: 10, y: 6,
      'font-size': '16',
      'font-weight': '700',
      'dominant-baseline': 'hanging',
    });
    nameText.textContent = displayName;
    g.appendChild(nameText);

    // Logical name
    const logicalText = svgEl('text', {
      class: 'erdv2-entity-logical',
      x: 10, y: 25,
      'font-size': '11',
      'dominant-baseline': 'hanging',
    });
    logicalText.textContent = name;
    g.appendChild(logicalText);

    // Header divider
    g.appendChild(svgEl('line', {
      x1: 0, y1: HEADER_H, x2: w, y2: HEADER_H,
      class: 'erdv2-header-divider',
    }));

    // Fields
    let fieldY = HEADER_H + FIELD_PAD;
    for (const field of fields) {
      this.#renderField(g, field, fieldY, w);
      fieldY += FIELD_H;
    }

    // Field count badge if capped
    const total = this.#getUncappedFieldCount(name);
    if (total > fields.length) {
      const badge = svgEl('text', {
        class: 'erdv2-field-count',
        x: w - 8, y: h - 6,
        'text-anchor': 'end',
      });
      badge.textContent = `+${total - fields.length} more`;
      g.appendChild(badge);
    }

    this.#entityLayer.appendChild(g);
    this.#entityEls.set(name, g);
  }

  #renderField(g, field, y, w) {
    const typeKey = TYPE_COLORS[field.type] || 'string';
    g.appendChild(svgEl('circle', {
      class: 'erdv2-type-dot',
      'data-type': typeKey,
      cx: 14, cy: y + FIELD_H / 2, r: 3,
    }));

    if (field.isPk) {
      const icon = svgEl('text', { class: 'erdv2-key-icon erdv2-key-pk', x: 23, y: y + FIELD_H / 2 + 1 });
      icon.textContent = '\u{1F511}';
      g.appendChild(icon);
    } else if (field.isLookup) {
      const icon = svgEl('text', { class: 'erdv2-key-icon erdv2-key-fk', x: 23, y: y + FIELD_H / 2 + 1 });
      icon.textContent = '\u{1F517}';
      g.appendChild(icon);
    }

    const textX = field.isPk || field.isLookup ? 36 : 24;
    const nameEl = svgEl('text', {
      class: field.isLookup ? 'erdv2-field-name erdv2-field-lookup' : 'erdv2-field-name',
      x: textX, y: y + FIELD_H / 2 + 1,
    });
    nameEl.textContent = field.displayName;
    g.appendChild(nameEl);

    // Type badge with optional required indicator inline
    const typeLabel = field.required ? `* ${attrTypeShort(field.type)}` : attrTypeShort(field.type);
    const badge = svgEl('text', {
      class: 'erdv2-type-badge',
      x: w - 8, y: y + FIELD_H / 2 + 1,
      'text-anchor': 'end',
    });
    if (field.required) {
      // Red asterisk as a tspan, type in normal color
      const star = svgEl('tspan');
      star.setAttribute('class', 'erdv2-required-star');
      star.textContent = '* ';
      badge.appendChild(star);
      badge.appendChild(document.createTextNode(attrTypeShort(field.type)));
    } else {
      badge.textContent = attrTypeShort(field.type);
    }
    g.appendChild(badge);
  }

  // =========================================================================
  // Edge rendering
  // =========================================================================

  #renderEdge(schema, pathD) {
    if (!pathD) return;
    const rel = this.#state.relationships.find(r => r.schemaName === schema);
    if (!rel) return;

    // Color by source (parent) entity — all children of the same parent share one color
    const color = this.#entityColorMap.get(rel.sourceEntity) || ARROW_COLORS[0];

    const g = svgEl('g', {
      class: `erdv2-edge${rel.type === 'N:N' ? ' erdv2-edge-nn' : ' erdv2-edge-1n'}`,
      'data-schema': schema,
    });

    const path = svgEl('path', {
      d: pathD,
      class: 'erdv2-edge-path',
      stroke: color,
      fill: 'none',
      'stroke-width': '1.8',
    });

    // N:N edges dashed, 1:N solid — no markers for now (needs edge-clipping math)
    if (rel.type === 'N:N') {
      path.setAttribute('stroke-dasharray', '6 3');
    }

    g.appendChild(path);

    const title = svgEl('title');
    title.textContent = `${rel.type}: ${rel.sourceEntity} \u2192 ${rel.targetEntity}\n${rel.schemaName}`;
    g.appendChild(title);

    this.#edgeLayer.appendChild(g);
    this.#edgeEls.set(schema, g);
  }

  /** No-op — crows foot markers are always visible. */
  setEdgeStyle(_showMarkers) { /* intentional no-op */ }

  // =========================================================================
  // SVG defs
  // =========================================================================

  #createDefs() {
    const defs = svgEl('defs');
    const strokeColor = 'var(--color-border-strong,#555)';

    const oneOne = svgEl('marker', {
      id: 'erdv2-cf-one-one', markerWidth: '16', markerHeight: '12',
      refX: '14', refY: '6', orient: 'auto', markerUnits: 'strokeWidth',
    });
    oneOne.appendChild(svgEl('line', { x1: '12', y1: '2', x2: '12', y2: '10', stroke: strokeColor, 'stroke-width': '1.5' }));
    oneOne.appendChild(svgEl('line', { x1: '8', y1: '2', x2: '8', y2: '10', stroke: strokeColor, 'stroke-width': '1.5' }));
    defs.appendChild(oneOne);

    const many = svgEl('marker', {
      id: 'erdv2-cf-many', markerWidth: '14', markerHeight: '14',
      refX: '12', refY: '7', orient: 'auto', markerUnits: 'strokeWidth',
    });
    many.appendChild(svgEl('line', { x1: '12', y1: '7', x2: '2', y2: '2', stroke: strokeColor, 'stroke-width': '1.5' }));
    many.appendChild(svgEl('line', { x1: '12', y1: '7', x2: '2', y2: '7', stroke: strokeColor, 'stroke-width': '1.5' }));
    many.appendChild(svgEl('line', { x1: '12', y1: '7', x2: '2', y2: '12', stroke: strokeColor, 'stroke-width': '1.5' }));
    defs.appendChild(many);

    const one = svgEl('marker', {
      id: 'erdv2-cf-one', markerWidth: '12', markerHeight: '12',
      refX: '10', refY: '6', orient: 'auto', markerUnits: 'strokeWidth',
    });
    one.appendChild(svgEl('line', { x1: '8', y1: '2', x2: '8', y2: '10', stroke: strokeColor, 'stroke-width': '1.5' }));
    defs.appendChild(one);

    const shadow = svgEl('filter', { id: 'erdv2-shadow', x: '-5%', y: '-5%', width: '115%', height: '120%' });
    shadow.appendChild(svgEl('feDropShadow', {
      dx: '0', dy: '2', stdDeviation: '3',
      'flood-color': '#000', 'flood-opacity': '0.15',
    }));
    defs.appendChild(shadow);

    return defs;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  #getVisibleFields(entityName) {
    const isExpanded = this.#state.expanded.get(entityName) === true;
    const allFields = isExpanded
      ? (this.#state.entityAllFields.get(entityName) || [])
      : (this.#state.entityKeyFields.get(entityName) || []);

    const overrides = this.#state.entityFieldOverrides.get(entityName);
    if (overrides) return allFields.filter(f => f.isPk || overrides.has(f.name));
    if (isExpanded) return allFields;

    const filtered = allFields.filter(f => f.isPk || !this.#state.hiddenSystemFields.has(f.name));
    return filtered.length > MAX_KEY_FIELDS ? filtered.slice(0, MAX_KEY_FIELDS) : filtered;
  }

  #getUncappedFieldCount(entityName) {
    const allFields = this.#state.entityKeyFields.get(entityName) || [];
    return allFields.filter(f => f.isPk || !this.#state.hiddenSystemFields.has(f.name)).length;
  }

  /**
   * Build a color map: every entity gets a unique color.
   * Parents (1:N sources) are assigned first, then remaining entities.
   * Edges use the source entity's color.
   */
  #buildEntityColorMap() {
    this.#entityColorMap.clear();
    this.#parentEntities.clear();
    // Parents first (so their edges and border match)
    const parents = [];
    for (const rel of this.#state.relationships) {
      if (rel.type === '1:N' && !this.#entityColorMap.has(rel.sourceEntity)) {
        this.#entityColorMap.set(rel.sourceEntity, null);
        this.#parentEntities.add(rel.sourceEntity);
        parents.push(rel.sourceEntity);
      }
    }
    let idx = 0;
    for (const p of parents) {
      this.#entityColorMap.set(p, ARROW_COLORS[idx % ARROW_COLORS.length]);
      idx++;
    }
    // Then all remaining entities (leaf nodes — no colored border)
    for (const ent of this.#state.entities) {
      if (!this.#entityColorMap.has(ent.LogicalName)) {
        this.#entityColorMap.set(ent.LogicalName, ARROW_COLORS[idx % ARROW_COLORS.length]);
        idx++;
      }
    }
  }
}
