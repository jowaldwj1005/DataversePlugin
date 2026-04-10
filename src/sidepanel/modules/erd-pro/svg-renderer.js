/**
 * ERD Pro — Incremental SVG renderer
 *
 * Renders entity boxes and relationship edges as SVG elements.
 * Supports incremental updates: only changed elements are rebuilt.
 *
 * @module erd-pro/svg-renderer
 */

import { SVG_NS, ENTITY_W, HEADER_H, FIELD_H, FIELD_PAD, CORNER_R, MAX_KEY_FIELDS, ARROW_COLORS } from './constants.js';
import { svgEl, attrTypeShort } from './helpers.js';

/** Map of attribute types to CSS custom property suffixes. */
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

    // Defs (markers, shadow)
    this.#defs = this.#createDefs();
    this.#svgRoot.appendChild(this.#defs);

    // Edge layer (below entities)
    this.#edgeLayer = svgEl('g', { class: 'erdp-edges' });
    this.#svgRoot.appendChild(this.#edgeLayer);

    // Entity layer
    this.#entityLayer = svgEl('g', { class: 'erdp-entities' });
    this.#svgRoot.appendChild(this.#entityLayer);

    // Draw edges
    for (const [schema, pathD] of this.#state.edgePaths) {
      this.#renderEdge(schema, pathD);
    }

    // Draw entities
    for (const ent of this.#state.entities) {
      this.#renderEntity(ent);
    }
  }

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

    for (const [name, g] of this.#entityEls) {
      if (name === entityName) {
        g.classList.add('erdp-highlighted');
        g.classList.remove('erdp-faded');
      } else if (adj.has(name)) {
        g.classList.add('erdp-highlighted');
        g.classList.remove('erdp-faded');
      } else {
        g.classList.add('erdp-faded');
        g.classList.remove('erdp-highlighted');
      }
    }

    for (const [schema, g] of this.#edgeEls) {
      const rel = this.#state.relationships.find(r => r.schemaName === schema);
      if (rel && (rel.sourceEntity === entityName || rel.targetEntity === entityName)) {
        g.classList.add('erdp-highlighted');
        g.classList.remove('erdp-faded');
      } else {
        g.classList.add('erdp-faded');
        g.classList.remove('erdp-highlighted');
      }
    }
  }

  clearHighlight() {
    for (const g of this.#entityEls.values()) {
      g.classList.remove('erdp-highlighted', 'erdp-faded');
    }
    for (const g of this.#edgeEls.values()) {
      g.classList.remove('erdp-highlighted', 'erdp-faded');
    }
  }

  /** Get the SVG <g> element for an entity (for interaction binding). */
  getEntityEl(name) {
    return this.#entityEls.get(name);
  }

  /** Get the root SVG group. */
  get root() { return this.#svgRoot; }

  // =========================================================================
  // Entity rendering
  // =========================================================================

  #renderEntity(ent) {
    const name = ent.LogicalName;
    const pos = this.#state.positions.get(name);
    if (!pos) return;

    const fields = this.#getVisibleFields(name);
    const size = this.#state.entitySizes.get(name);
    const w = size?.w || ENTITY_W;
    const h = size?.h || 60;
    const isCustom = ent.IsCustomEntity;

    const g = svgEl('g', {
      class: 'erdp-entity',
      transform: `translate(${pos.x}, ${pos.y})`,
      'data-entity': name,
    });

    // Background rect with shadow
    g.appendChild(svgEl('rect', {
      class: 'erdp-card-bg',
      width: w, height: h, rx: CORNER_R,
      filter: 'url(#erdp-shadow)',
    }));

    // Header background
    g.appendChild(svgEl('rect', {
      class: isCustom ? 'erdp-header-custom' : 'erdp-header-system',
      width: w, height: HEADER_H, rx: CORNER_R,
    }));
    // Cover bottom corners of header
    g.appendChild(svgEl('rect', {
      class: isCustom ? 'erdp-header-custom' : 'erdp-header-system',
      y: HEADER_H - CORNER_R, width: w, height: CORNER_R,
    }));

    // Entity display name
    const displayName = ent.DisplayName?.UserLocalizedLabel?.Label || name;
    const nameText = svgEl('text', {
      class: 'erdp-entity-name',
      x: 10, y: 13,
    });
    nameText.textContent = displayName;
    g.appendChild(nameText);

    // Logical name (smaller, monospace)
    const logicalText = svgEl('text', {
      class: 'erdp-entity-logical',
      x: 10, y: 26,
    });
    logicalText.textContent = name;
    g.appendChild(logicalText);

    // Header divider line
    g.appendChild(svgEl('line', {
      x1: 0, y1: HEADER_H, x2: w, y2: HEADER_H,
      class: 'erdp-header-divider',
    }));

    // Fields
    let fieldY = HEADER_H + FIELD_PAD;
    for (const field of fields) {
      this.#renderField(g, field, fieldY, w);
      fieldY += FIELD_H;
    }

    // Field count badge if capped
    const preset = this.#state.preset;
    if (preset !== 'overview' && preset !== 'detailed') {
      const total = this.#getUncappedFieldCount(name);
      if (total > fields.length) {
        const badge = svgEl('text', {
          class: 'erdp-field-count',
          x: w - 8, y: h - 6,
          'text-anchor': 'end',
        });
        badge.textContent = `+${total - fields.length} more`;
        g.appendChild(badge);
      }
    }

    this.#entityLayer.appendChild(g);
    this.#entityEls.set(name, g);
  }

  #renderField(g, field, y, w) {
    // Type indicator dot
    const typeKey = TYPE_COLORS[field.type] || 'string';
    g.appendChild(svgEl('circle', {
      class: 'erdp-type-dot',
      'data-type': typeKey,
      cx: 14, cy: y + FIELD_H / 2, r: 3,
    }));

    // PK/FK icon
    if (field.isPk) {
      const icon = svgEl('text', { class: 'erdp-key-icon erdp-key-pk', x: 23, y: y + FIELD_H / 2 + 1 });
      icon.textContent = '🔑';
      g.appendChild(icon);
    } else if (field.isLookup) {
      const icon = svgEl('text', { class: 'erdp-key-icon erdp-key-fk', x: 23, y: y + FIELD_H / 2 + 1 });
      icon.textContent = '🔗';
      g.appendChild(icon);
    }

    // Field name
    const textX = field.isPk || field.isLookup ? 36 : 24;
    const nameEl = svgEl('text', {
      class: field.isLookup ? 'erdp-field-name erdp-field-lookup' : 'erdp-field-name',
      x: textX, y: y + FIELD_H / 2 + 1,
    });
    nameEl.textContent = field.displayName;
    g.appendChild(nameEl);

    // Type badge
    const badge = svgEl('text', {
      class: 'erdp-type-badge',
      x: w - 8, y: y + FIELD_H / 2 + 1,
      'text-anchor': 'end',
    });
    badge.textContent = attrTypeShort(field.type);
    g.appendChild(badge);

    // Required indicator
    if (field.required) {
      const req = svgEl('text', {
        class: 'erdp-required',
        x: w - 28, y: y + FIELD_H / 2 + 1,
        'text-anchor': 'end',
      });
      req.textContent = '*';
      g.appendChild(req);
    }
  }

  // =========================================================================
  // Edge rendering
  // =========================================================================

  #renderEdge(schema, pathD) {
    if (!pathD) return;
    const rel = this.#state.relationships.find(r => r.schemaName === schema);
    if (!rel) return;

    const colorIdx = this.#state.relationships.indexOf(rel) % ARROW_COLORS.length;
    const color = ARROW_COLORS[colorIdx];

    const g = svgEl('g', {
      class: `erdp-edge${rel.type === 'N:N' ? ' erdp-edge-nn' : ' erdp-edge-1n'}`,
      'data-schema': schema,
    });

    const path = svgEl('path', {
      d: pathD,
      class: 'erdp-edge-path',
      stroke: color,
      fill: 'none',
      'stroke-width': '1.8',
    });

    // Crow's foot markers
    if (rel.type === '1:N') {
      path.setAttribute('marker-start', 'url(#erdp-cf-one-one)');
      path.setAttribute('marker-end', 'url(#erdp-cf-many)');
    } else if (rel.type === 'N:N') {
      path.setAttribute('marker-start', 'url(#erdp-cf-many)');
      path.setAttribute('marker-end', 'url(#erdp-cf-many)');
      path.setAttribute('stroke-dasharray', '6 3');
    }

    g.appendChild(path);

    // Tooltip on hover
    const title = svgEl('title');
    title.textContent = `${rel.type}: ${rel.sourceEntity} → ${rel.targetEntity}\n${rel.schemaName}`;
    g.appendChild(title);

    this.#edgeLayer.appendChild(g);
    this.#edgeEls.set(schema, g);
  }

  // =========================================================================
  // SVG defs (markers, filters)
  // =========================================================================

  #createDefs() {
    const defs = svgEl('defs');
    const strokeColor = 'var(--color-border-strong,#555)';

    // "One-one" marker ||
    const oneOne = svgEl('marker', {
      id: 'erdp-cf-one-one', markerWidth: '16', markerHeight: '12',
      refX: '14', refY: '6', orient: 'auto', markerUnits: 'strokeWidth',
    });
    oneOne.appendChild(svgEl('line', { x1: '12', y1: '2', x2: '12', y2: '10', stroke: strokeColor, 'stroke-width': '1.5' }));
    oneOne.appendChild(svgEl('line', { x1: '8', y1: '2', x2: '8', y2: '10', stroke: strokeColor, 'stroke-width': '1.5' }));
    defs.appendChild(oneOne);

    // "Many" marker ><
    const many = svgEl('marker', {
      id: 'erdp-cf-many', markerWidth: '14', markerHeight: '14',
      refX: '12', refY: '7', orient: 'auto', markerUnits: 'strokeWidth',
    });
    many.appendChild(svgEl('line', { x1: '12', y1: '7', x2: '2', y2: '2', stroke: strokeColor, 'stroke-width': '1.5' }));
    many.appendChild(svgEl('line', { x1: '12', y1: '7', x2: '2', y2: '7', stroke: strokeColor, 'stroke-width': '1.5' }));
    many.appendChild(svgEl('line', { x1: '12', y1: '7', x2: '2', y2: '12', stroke: strokeColor, 'stroke-width': '1.5' }));
    defs.appendChild(many);

    // "One" marker |
    const one = svgEl('marker', {
      id: 'erdp-cf-one', markerWidth: '12', markerHeight: '12',
      refX: '10', refY: '6', orient: 'auto', markerUnits: 'strokeWidth',
    });
    one.appendChild(svgEl('line', { x1: '8', y1: '2', x2: '8', y2: '10', stroke: strokeColor, 'stroke-width': '1.5' }));
    defs.appendChild(one);

    // Drop shadow
    const shadow = svgEl('filter', { id: 'erdp-shadow', x: '-5%', y: '-5%', width: '115%', height: '120%' });
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
    const preset = this.#state.preset;
    if (preset === 'overview') return [];

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
}
