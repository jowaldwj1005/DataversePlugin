/**
 * Dataverse Toolkit – ERD Viewer Module
 *
 * Renders an interactive SVG entity-relationship diagram for a Dataverse solution.
 * Entities appear as boxes; relationships as arrows.
 * Click an entity to see its full attribute list in the detail panel.
 * Supports pan/zoom, schema export, and example payload generation.
 *
 * @module ErdViewer
 */

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ENTITY_W = 200;
const ENTITY_H = 140;  // approx – expanded later based on field count
const COL_SIZE = 4;    // entities per row in grid layout
const H_GAP = 60;
const V_GAP = 50;

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '';
}

function attrTypeShort(t) {
  const map = {
    String: 'Str', Memo: 'Txt', Integer: 'Int', BigInt: 'BigInt',
    Decimal: 'Dec', Double: 'Dbl', Money: '$', DateTime: 'Date',
    Boolean: 'Bool', Picklist: 'List', Status: 'Status', State: 'State',
    Lookup: 'Lkp', Owner: 'Own', Customer: 'Cust', Uniqueidentifier: 'Guid',
    Image: 'Img', File: 'File',
  };
  return map[t] || t || '?';
}

function exampleValue(attrType) {
  switch (attrType) {
    case 'String': case 'Memo': return '"Sample text"';
    case 'Integer': case 'BigInt': return '0';
    case 'Decimal': case 'Double': case 'Money': return '0.00';
    case 'DateTime': return '"2024-01-01T00:00:00Z"';
    case 'Boolean': return 'false';
    case 'Picklist': case 'Status': case 'State': return '0';
    case 'Lookup': case 'Owner': case 'Customer': return '"00000000-0000-0000-0000-000000000000"';
    default: return 'null';
  }
}

// ---------------------------------------------------------------------------
// ErdViewer Class
// ---------------------------------------------------------------------------

export default class ErdViewer {
  /**
   * @param {HTMLElement} container
   * @param {Object} apiClient
   * @param {Object} metadataCache
   */
  constructor(container, apiClient, metadataCache) {
    this.container = container;
    this.api = apiClient;
    this.cache = metadataCache;

    this._solutions = [];
    this._entities = [];        // EntityDefinition[] currently loaded
    this._relationships = [];   // OneToMany[] across all loaded entities
    this._positions = new Map(); // entityName → { x, y }
    this._selectedEntity = null;

    this._svg = null;
    this._svgRoot = null;       // <g> that gets the transform
    this._detailPanel = null;

    // Pan / zoom state
    this._pan = { x: 0, y: 0 };
    this._zoom = 1;
    this._dragging = false;
    this._dragStart = null;
    this._panAtDragStart = null;
  }

  // -------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------

  async render() {
    this.container.innerHTML = '';
    this.container.classList.add('erd-container');

    this._buildToolbar();
    this._buildContent();
    await this._loadSolutions();
  }

  // -------------------------------------------------------------------------
  // Build UI
  // -------------------------------------------------------------------------

  _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'erd-toolbar';

    const solSelect = document.createElement('select');
    solSelect.className = 'erd-select';
    solSelect.innerHTML = '<option value="">Select solution\u2026</option>';
    this._solSelect = solSelect;

    const loadBtn = document.createElement('button');
    loadBtn.className = 'erd-btn erd-btn-primary';
    loadBtn.textContent = 'Load ERD';
    loadBtn.addEventListener('click', () => {
      const val = solSelect.value;
      if (val) this._loadSolution(val);
      else this._showNotification('Select a solution first', 'warning');
    });

    const exportSchemaBtn = document.createElement('button');
    exportSchemaBtn.className = 'erd-btn erd-btn-outline';
    exportSchemaBtn.textContent = 'Export Schema';
    exportSchemaBtn.addEventListener('click', () => this._exportSchema());

    const exportPayloadBtn = document.createElement('button');
    exportPayloadBtn.className = 'erd-btn erd-btn-outline';
    exportPayloadBtn.textContent = 'Export Payload';
    exportPayloadBtn.addEventListener('click', () => this._exportPayload());

    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'erd-btn erd-btn-secondary';
    zoomInBtn.textContent = '+';
    zoomInBtn.title = 'Zoom in';
    zoomInBtn.addEventListener('click', () => this._applyZoom(this._zoom * 1.2));

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'erd-btn erd-btn-secondary';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.title = 'Zoom out';
    zoomOutBtn.addEventListener('click', () => this._applyZoom(this._zoom / 1.2));

    const resetBtn = document.createElement('button');
    resetBtn.className = 'erd-btn erd-btn-secondary';
    resetBtn.textContent = 'Reset';
    resetBtn.title = 'Reset view';
    resetBtn.addEventListener('click', () => { this._pan = { x: 20, y: 20 }; this._zoom = 1; this._updateTransform(); });

    toolbar.append(solSelect, loadBtn, exportSchemaBtn, exportPayloadBtn, zoomInBtn, zoomOutBtn, resetBtn);
    this.container.appendChild(toolbar);
  }

  _buildContent() {
    const content = document.createElement('div');
    content.className = 'erd-content';
    this.container.appendChild(content);

    // Canvas
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'erd-canvas-wrap';
    content.appendChild(canvasWrap);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'erd-svg');
    svg.setAttribute('xmlns', SVG_NS);
    this._svg = svg;

    // Defs: arrowhead markers
    const defs = svgEl('defs');
    defs.innerHTML = `
      <marker id="arrow-end" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="var(--color-border-strong,#555)" />
      </marker>
      <marker id="arrow-end-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="var(--color-text-muted,#808080)" />
      </marker>
    `;
    svg.appendChild(defs);

    const root = svgEl('g', { id: 'erd-root' });
    this._svgRoot = root;
    svg.appendChild(root);

    canvasWrap.appendChild(svg);
    this._setupPanZoom(svg);

    // Detail panel
    const detail = document.createElement('div');
    detail.className = 'erd-detail';
    detail.style.display = 'none';
    this._detailPanel = detail;
    content.appendChild(detail);
  }

  // -------------------------------------------------------------------------
  // Load data
  // -------------------------------------------------------------------------

  async _loadSolutions() {
    try {
      const response = await this.api.request('GET',
        'solutions?$select=friendlyname,uniquename,version,ismanaged&$filter=ismanaged eq false'
      );
      this._solutions = ((response).value || []).sort((a, b) =>
        (a.friendlyname || '').localeCompare(b.friendlyname || ''));

      for (const sol of this._solutions) {
        const opt = document.createElement('option');
        opt.value = sol.uniquename;
        opt.textContent = `${sol.friendlyname} (${sol.uniquename})`;
        this._solSelect.appendChild(opt);
      }
    } catch (err) {
      this._showNotification(`Failed to load solutions: ${err.message}`, 'error');
    }
  }

  async _loadSolution(uniqueName) {
    this._showLoading(true);
    this._entities = [];
    this._relationships = [];
    this._positions.clear();
    if (this._svgRoot) this._svgRoot.innerHTML = '';
    if (this._detailPanel) this._detailPanel.style.display = 'none';

    try {
      // Fetch solution components of type 1 (Entity)
      const compResp = await this.api.request('GET',
        `solutioncomponents?$filter=solutionid/uniquename eq '${uniqueName}' and componenttype eq 1&$select=objectid`
      );
      const objectIds = (compResp.value || []).map(c => c.objectid).filter(Boolean);

      if (!objectIds.length) {
        this._showNotification('No entities found in this solution', 'warning');
        return;
      }

      // Batch-fetch entity definitions
      const allEntities = await this.cache.getEntities();
      this._entities = allEntities.filter(e => objectIds.includes(e.MetadataId));

      if (!this._entities.length) {
        // Fallback: if MetadataId not available, load all entities
        this._entities = allEntities.slice(0, 30);
        this._showNotification(`Showing first 30 entities (solution filter unavailable)`, 'info');
      }

      // Collect relationships from the first batch (top 50 entities to avoid rate limits)
      const sample = this._entities.slice(0, 40);
      const entityNames = new Set(this._entities.map(e => e.LogicalName));

      await Promise.all(sample.map(async (ent) => {
        try {
          const rels = await this.cache.getRelationships(ent.LogicalName);
          for (const rel of rels.OneToMany) {
            if (entityNames.has(rel.ReferencingEntity)) {
              this._relationships.push({ ...rel, _type: '1:N' });
            }
          }
        } catch { /* ignore per-entity errors */ }
      }));

      this._renderERD();
    } catch (err) {
      this._showNotification(`Failed to load solution: ${err.message}`, 'error');
    } finally {
      this._showLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render ERD
  // -------------------------------------------------------------------------

  _renderERD() {
    if (!this._svgRoot) return;
    this._svgRoot.innerHTML = '';

    // Compute positions
    this._entities.forEach((ent, i) => {
      const col = i % COL_SIZE;
      const row = Math.floor(i / COL_SIZE);
      this._positions.set(ent.LogicalName, {
        x: 20 + col * (ENTITY_W + H_GAP),
        y: 20 + row * (ENTITY_H + V_GAP),
      });
    });

    // Draw arrows first (behind entities)
    const arrowGroup = svgEl('g', { class: 'erd-arrows' });
    const seen = new Set();
    for (const rel of this._relationships) {
      const key = rel.SchemaName;
      if (seen.has(key)) continue;
      seen.add(key);
      const from = this._positions.get(rel.ReferencedEntity);
      const to = this._positions.get(rel.ReferencingEntity);
      if (!from || !to) continue;
      arrowGroup.appendChild(this._drawArrow(rel, from, to));
    }
    this._svgRoot.appendChild(arrowGroup);

    // Draw entity boxes
    for (const ent of this._entities) {
      const pos = this._positions.get(ent.LogicalName);
      if (!pos) continue;
      this._svgRoot.appendChild(this._drawEntityBox(ent, pos.x, pos.y));
    }

    // Fit SVG viewbox to content
    const totalW = (Math.min(this._entities.length, COL_SIZE)) * (ENTITY_W + H_GAP) + 40;
    const totalH = Math.ceil(this._entities.length / COL_SIZE) * (ENTITY_H + V_GAP) + 40;
    this._svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

    this._pan = { x: 0, y: 0 };
    this._zoom = 1;
    this._updateTransform();
  }

  _drawEntityBox(ent, x, y) {
    const displayName = ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName;
    const isCustom = ent.IsCustomEntity;

    const g = svgEl('g', {
      class: 'erd-entity',
      transform: `translate(${x},${y})`,
      'data-name': ent.LogicalName,
    });

    // Background rect
    const rect = svgEl('rect', {
      class: 'erd-bg',
      x: 0, y: 0,
      width: ENTITY_W,
      height: ENTITY_H,
      rx: 4,
    });
    g.appendChild(rect);

    // Header background
    const headerRect = svgEl('rect', {
      class: isCustom ? 'erd-header erd-header-custom' : 'erd-header',
      x: 0, y: 0,
      width: ENTITY_W,
      height: 32,
      rx: 4,
    });
    g.appendChild(headerRect);

    // Cover header bottom corners
    g.appendChild(svgEl('rect', { x: 0, y: 20, width: ENTITY_W, height: 12, class: isCustom ? 'erd-header erd-header-custom' : 'erd-header' }));

    // Display name
    const titleText = svgEl('text', { x: 8, y: 14, class: 'erd-entity-name' });
    titleText.textContent = displayName.length > 22 ? displayName.substring(0, 20) + '\u2026' : displayName;
    g.appendChild(titleText);

    // Logical name
    const logicalText = svgEl('text', { x: 8, y: 26, class: 'erd-entity-logical' });
    logicalText.textContent = ent.LogicalName;
    g.appendChild(logicalText);

    // Separator line
    g.appendChild(svgEl('line', { x1: 0, y1: 32, x2: ENTITY_W, y2: 32, class: 'erd-separator' }));

    // Fields: PrimaryId + up to 5 more
    const fieldsToShow = [
      { name: ent.PrimaryIdAttribute, label: ent.PrimaryIdAttribute, type: 'Uniqueidentifier', isPk: true },
      { name: ent.PrimaryNameAttribute, label: ent.PrimaryNameAttribute, type: 'String', isPk: false },
    ].filter(f => f.name);

    fieldsToShow.forEach((f, i) => {
      const ty = svgEl('text', { x: 8, y: 32 + 18 + i * 16, class: 'erd-field' });
      const prefix = f.isPk ? '\uD83D\uDD11 ' : '\uD83D\uDCDD ';
      ty.textContent = `${prefix}${f.name} (${attrTypeShort(f.type)})`;
      g.appendChild(ty);
    });

    // Click to select
    g.addEventListener('click', () => this._selectEntity(ent));
    g.style.cursor = 'pointer';

    return g;
  }

  _drawArrow(rel, fromPos, toPos) {
    const fx = fromPos.x + ENTITY_W;
    const fy = fromPos.y + ENTITY_H / 2;
    const tx = toPos.x;
    const ty = toPos.y + ENTITY_H / 2;
    const midX = (fx + tx) / 2;

    const relType = rel._type || '1:N';
    const dashArray = relType === 'N:N' ? '3 3' : relType === 'N:1' ? '6 3' : null;
    const markerId = relType === 'N:1' ? 'arrow-end-dashed' : 'arrow-end';

    const g = svgEl('g', { class: 'erd-arrow-group' });

    // Tooltip — shows on hover via native SVG <title>
    const tooltipParts = [rel.SchemaName || ''];
    if (rel.ReferencedEntity && rel.ReferencingEntity) {
      tooltipParts.push(`${rel.ReferencedEntity} → ${rel.ReferencingEntity}`);
    }
    if (rel.ReferencedAttribute) tooltipParts.push(`on: ${rel.ReferencedAttribute}`);

    const title = svgEl('title');
    title.textContent = tooltipParts.filter(Boolean).join('\n');
    g.appendChild(title);

    const pathAttrs = {
      d: `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`,
      class: 'erd-arrow',
      fill: 'none',
      'marker-end': `url(#${markerId})`,
    };
    if (dashArray) pathAttrs['stroke-dasharray'] = dashArray;

    g.appendChild(svgEl('path', pathAttrs));
    return g;
  }

  // -------------------------------------------------------------------------
  // Entity selection & detail panel
  // -------------------------------------------------------------------------

  _selectEntity(ent) {
    // Clear previous selection
    this._svgRoot?.querySelectorAll('.erd-entity.erd-selected').forEach(el => {
      el.classList.remove('erd-selected');
    });

    // Mark selected
    const g = this._svgRoot?.querySelector(`.erd-entity[data-name="${ent.LogicalName}"]`);
    if (g) g.classList.add('erd-selected');

    this._selectedEntity = ent;
    this._renderDetail(ent);
  }

  async _renderDetail(ent) {
    const panel = this._detailPanel;
    if (!panel) return;
    panel.style.display = 'flex';
    panel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'erd-detail-header';
    const displayName = ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName;
    header.innerHTML = `<strong>${displayName}</strong><br><span class="erd-detail-logical">${ent.LogicalName}</span>`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'erd-detail-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => { panel.style.display = 'none'; this._selectedEntity = null; });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const loading = document.createElement('div');
    loading.className = 'erd-detail-loading';
    loading.textContent = 'Loading attributes\u2026';
    panel.appendChild(loading);

    try {
      const attrs = await this.cache.getAttributes(ent.LogicalName);
      loading.remove();

      const table = document.createElement('table');
      table.className = 'erd-attr-table';
      table.innerHTML = '<thead><tr><th>Attribute</th><th>Type</th><th>Req</th></tr></thead>';

      const tbody = document.createElement('tbody');
      for (const attr of attrs) {
        const name = attr.LogicalName || '';
        const disp = attr.DisplayName?.UserLocalizedLabel?.Label;
        const type = attr.AttributeType || '';
        const req = attr.RequiredLevel?.Value || '';

        const tr = document.createElement('tr');
        tr.className = 'erd-detail-attr';
        tr.innerHTML = `
          <td title="${name}">${disp && disp !== name ? `${disp}<br><small>${name}</small>` : name}</td>
          <td><span class="erd-type-badge" data-type="${type}">${attrTypeShort(type)}</span></td>
          <td>${req === 'ApplicationRequired' ? '\u2713' : ''}</td>
        `;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      panel.appendChild(table);
    } catch (err) {
      loading.textContent = `Error: ${err.message}`;
    }
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  async _exportSchema() {
    const entitiesToExport = this._selectedEntity ? [this._selectedEntity] : this._entities;
    if (!entitiesToExport.length) {
      this._showNotification('No entities loaded', 'warning');
      return;
    }

    const schema = { type: 'object', entities: {} };

    for (const ent of entitiesToExport) {
      let attrs = [];
      try {
        attrs = await this.cache.getAttributes(ent.LogicalName);
      } catch { /* skip */ }

      const properties = {};
      const required = [];

      for (const attr of attrs) {
        const name = attr.LogicalName;
        const type = attr.AttributeType || '';
        const jsType = ['Integer','BigInt','Decimal','Double','Money'].includes(type) ? 'number'
          : type === 'Boolean' ? 'boolean'
          : 'string';

        properties[name] = {
          type: jsType,
          description: attr.DisplayName?.UserLocalizedLabel?.Label || name,
          dataverseType: type,
        };

        if (attr.RequiredLevel?.Value === 'ApplicationRequired') {
          required.push(name);
        }
      }

      schema.entities[ent.LogicalName] = {
        type: 'object',
        description: ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName,
        entitySetName: ent.EntitySetName,
        properties,
        required,
      };
    }

    await this._copyToClipboard(JSON.stringify(schema, null, 2));
    this._showNotification(`Schema for ${entitiesToExport.length} entity(ies) copied`, 'success');
  }

  async _exportPayload() {
    const ent = this._selectedEntity || this._entities[0];
    if (!ent) { this._showNotification('Select an entity first', 'warning'); return; }

    let attrs = [];
    try { attrs = await this.cache.getAttributes(ent.LogicalName); } catch { /* skip */ }

    const payload = {};
    for (const attr of attrs) {
      if (attr.IsPrimaryId) continue;
      const req = attr.RequiredLevel?.Value;
      if (req !== 'ApplicationRequired' && req !== 'SystemRequired') continue;
      payload[attr.LogicalName] = JSON.parse(exampleValue(attr.AttributeType));
    }

    await this._copyToClipboard(JSON.stringify(payload, null, 2));
    this._showNotification(`Example payload for ${ent.LogicalName} copied`, 'success');
  }

  // -------------------------------------------------------------------------
  // Pan / Zoom
  // -------------------------------------------------------------------------

  _setupPanZoom(svg) {
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this._applyZoom(this._zoom * factor);
    }, { passive: false });

    svg.addEventListener('pointerdown', (e) => {
      if (e.target !== svg && !e.target.classList.contains('erd-arrows') &&
          !e.target.closest?.('.erd-arrows')) {
        // If clicking an entity, don't start pan
        return;
      }
      this._dragging = true;
      this._dragStart = { x: e.clientX, y: e.clientY };
      this._panAtDragStart = { ...this._pan };
      svg.setPointerCapture(e.pointerId);
      svg.style.cursor = 'grabbing';
    });

    svg.addEventListener('pointermove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._dragStart.x;
      const dy = e.clientY - this._dragStart.y;
      this._pan = {
        x: this._panAtDragStart.x + dx,
        y: this._panAtDragStart.y + dy,
      };
      this._updateTransform();
    });

    const stopDrag = () => {
      this._dragging = false;
      svg.style.cursor = '';
    };
    svg.addEventListener('pointerup', stopDrag);
    svg.addEventListener('pointercancel', stopDrag);
  }

  _applyZoom(newZoom) {
    this._zoom = Math.max(0.2, Math.min(3, newZoom));
    this._updateTransform();
  }

  _updateTransform() {
    if (this._svgRoot) {
      this._svgRoot.setAttribute('transform',
        `translate(${this._pan.x},${this._pan.y}) scale(${this._zoom})`);
    }
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  _showLoading(show) {
    let overlay = this.container.querySelector('.erd-loading-overlay');
    if (show) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'erd-loading-overlay';
        overlay.textContent = 'Loading ERD\u2026';
        this.container.appendChild(overlay);
      }
    } else {
      overlay?.remove();
    }
  }

  _showNotification(message, type = 'info') {
    const note = document.createElement('div');
    note.className = `erd-notification erd-notification-${type}`;
    note.textContent = message;
    note.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:10000;';
    document.body.appendChild(note);
    setTimeout(() => note.remove(), 3500);
  }

  async _copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      this._showNotification('Copy failed — check clipboard permissions', 'error');
    }
  }
}
