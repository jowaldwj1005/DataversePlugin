/**
 * Dataverse Toolkit – ERD Viewer Module
 *
 * Interactive SVG entity-relationship diagram for a Dataverse solution.
 * Force-directed layout, entity dragging, crow's foot notation,
 * collapsible boxes, minimap, filtering, SVG/PNG export, layout persistence.
 *
 * @module ErdViewer
 */

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const ENTITY_W = 220;
const HEADER_H = 32;
const FIELD_H = 18;
const FIELD_PAD = 6;
const COL_SIZE = 4;
const H_GAP = 120;
const V_GAP = 80;

const SVG_NS = 'http://www.w3.org/2000/svg';

// System lookup fields present on almost every entity — hidden by default
const SYSTEM_FK_FIELDS = new Set([
  'createdby', 'modifiedby', 'createdonbehalfby', 'modifiedonbehalfby',
  'owningbusinessunit', 'owningteam', 'owninguser',
]);

// Force layout constants
const FR_REPULSION = 30000;
const FR_ATTRACTION = 0.03;
const FR_DAMPING = 0.85;
const FR_ITERATIONS = 120;

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

/** Compute entity box height based on field count. */
function entityHeight(fieldCount) {
  return HEADER_H + FIELD_PAD + Math.max(fieldCount, 1) * FIELD_H + FIELD_PAD;
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
    this._entities = [];
    this._relationships = [];   // normalized RelEdge[]
    this._positions = new Map(); // logicalName → { x, y }
    this._selectedEntity = null;

    // Entity box state
    this._expanded = new Map();      // logicalName → boolean (true = show ALL fields)
    this._entityKeyFields = new Map(); // logicalName → FieldInfo[] (PK + FK fields, default view)
    this._entityAllFields = new Map(); // logicalName → FieldInfo[] (all fields, expanded view)
    this._entitySizes = new Map();   // logicalName → { w, h }
    this._hiddenSystemFKs = new Set(SYSTEM_FK_FIELDS); // system FK field names hidden globally
    this._entityFieldOverrides = new Map(); // logicalName → Set of shown field names (per-entity)

    // Adjacency for highlighting
    this._adjacency = new Map();    // logicalName → Set<logicalName>

    // Layout & routing
    this._layoutMode = 'force';     // 'force' | 'grid'
    this._routingMode = 'orthogonal'; // 'bezier' | 'orthogonal'

    // Filter state
    this._filterText = '';
    this._filterCustomOnly = false;
    this._filterHideSystem = false;
    this._visibleEntities = new Set();

    // SVG refs
    this._svg = null;
    this._svgRoot = null;
    this._detailPanel = null;
    this._canvasWrap = null;

    // Minimap
    this._minimapCanvas = null;

    // Pan / zoom state
    this._pan = { x: 0, y: 0 };
    this._zoom = 1;
    this._isPanning = false;
    this._panStart = null;
    this._panAtStart = null;

    // Entity drag state
    this._dragTarget = null;
    this._dragStart = null;
    this._entityPosAtDragStart = null;
    this._dragRAF = null;

    // Highlighting
    this._hoveredEntity = null;

    // Persistence
    this._solutionName = null;

    // Keyboard handler ref for cleanup
    this._keyHandler = null;
  }

  // -------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------

  async render() {
    this.container.innerHTML = '';
    this.container.classList.add('erd-container');

    this._buildToolbar();
    this._buildFilterBar();
    this._buildContent();
    this._addKeyboardShortcuts();
    await this._loadSolutions();
  }

  destroy() {
    if (this._solutionName) this._saveLayout();
    if (this._keyHandler) this.container.removeEventListener('keydown', this._keyHandler);
    if (this._exportMenuClose) document.removeEventListener('click', this._exportMenuClose);
    if (this._fkMenuClose) document.removeEventListener('click', this._fkMenuClose);
    this.container.innerHTML = '';
  }

  // -------------------------------------------------------------------------
  // Build UI
  // -------------------------------------------------------------------------

  _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'erd-toolbar';

    // Solution select
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

    // Layout toggle
    const layoutBtn = document.createElement('button');
    layoutBtn.className = 'erd-btn erd-btn-secondary';
    layoutBtn.textContent = 'Grid';
    layoutBtn.title = 'Toggle layout: Force / Grid';
    layoutBtn.addEventListener('click', () => {
      const oldPositions = new Map(this._positions);
      this._layoutMode = this._layoutMode === 'force' ? 'grid' : 'force';
      layoutBtn.textContent = this._layoutMode === 'force' ? 'Grid' : 'Force';
      this._renderERD();
      this._animateLayoutTransition(oldPositions, new Map(this._positions));
    });

    // Routing toggle
    const routeBtn = document.createElement('button');
    routeBtn.className = 'erd-btn erd-btn-secondary';
    routeBtn.textContent = 'Bezier';
    routeBtn.title = 'Toggle routing: Orthogonal / Bezier';
    routeBtn.addEventListener('click', () => {
      this._routingMode = this._routingMode === 'orthogonal' ? 'bezier' : 'orthogonal';
      routeBtn.textContent = this._routingMode === 'orthogonal' ? 'Bezier' : 'Ortho';
      this._renderERD();
    });

    // Export dropdown
    const exportWrap = document.createElement('div');
    exportWrap.className = 'erd-export-dropdown';
    const exportBtn = document.createElement('button');
    exportBtn.className = 'erd-btn erd-btn-outline';
    exportBtn.textContent = 'Export \u25BE';
    const exportMenu = document.createElement('div');
    exportMenu.className = 'erd-export-menu';
    exportMenu.style.display = 'none';

    for (const [label, fn] of [
      ['Schema (JSON)', () => this._exportSchema()],
      ['Payload (JSON)', () => this._exportPayload()],
      ['Diagram (SVG)', () => this._exportSVG()],
      ['Diagram (PNG)', () => this._exportPNG()],
    ]) {
      const item = document.createElement('button');
      item.className = 'erd-export-item';
      item.textContent = label;
      item.addEventListener('click', () => { exportMenu.style.display = 'none'; fn(); });
      exportMenu.appendChild(item);
    }
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.style.display = exportMenu.style.display === 'none' ? 'flex' : 'none';
    });
    this._exportMenuClose = () => { exportMenu.style.display = 'none'; };
    document.addEventListener('click', this._exportMenuClose);
    exportWrap.append(exportBtn, exportMenu);

    // Zoom controls
    const zoomInBtn = document.createElement('button');
    zoomInBtn.className = 'erd-btn erd-btn-secondary';
    zoomInBtn.textContent = '+';
    zoomInBtn.title = 'Zoom in';
    zoomInBtn.addEventListener('click', () => this._applyZoom(this._zoom * 1.2));

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.className = 'erd-btn erd-btn-secondary';
    zoomOutBtn.textContent = '\u2212';
    zoomOutBtn.title = 'Zoom out';
    zoomOutBtn.addEventListener('click', () => this._applyZoom(this._zoom / 1.2));

    const resetBtn = document.createElement('button');
    resetBtn.className = 'erd-btn erd-btn-secondary';
    resetBtn.textContent = 'Reset';
    resetBtn.title = 'Reset view';
    resetBtn.addEventListener('click', () => {
      this._pan = { x: 0, y: 0 };
      this._zoom = 1;
      this._updateTransform();
    });

    // Hidden snake game button — triple-click to activate
    const snakeBtn = document.createElement('button');
    snakeBtn.className = 'erd-btn erd-btn-secondary';
    snakeBtn.textContent = '\uD83D\uDC0D';
    snakeBtn.title = 'Double-click for a surprise';
    snakeBtn.style.opacity = '0.4';
    snakeBtn.style.marginLeft = 'auto';
    snakeBtn.addEventListener('dblclick', () => {
      import('./easter-eggs.js').then(ee => {
        new ee.SnakeGame(document.body, () => {});
      }).catch(err => console.error('Snake failed:', err));
    });

    toolbar.append(solSelect, loadBtn, layoutBtn, routeBtn, exportWrap, zoomInBtn, zoomOutBtn, resetBtn, snakeBtn);
    this.container.appendChild(toolbar);
  }

  _buildFilterBar() {
    const bar = document.createElement('div');
    bar.className = 'erd-filter-bar';

    const input = document.createElement('input');
    input.className = 'erd-filter-input';
    input.type = 'text';
    input.placeholder = 'Filter entities\u2026';
    input.addEventListener('input', () => { this._filterText = input.value; this._applyFilters(); });
    this._filterInput = input;

    const customLabel = document.createElement('label');
    customLabel.className = 'erd-filter-checkbox';
    const customCb = document.createElement('input');
    customCb.type = 'checkbox';
    customCb.addEventListener('change', () => { this._filterCustomOnly = customCb.checked; this._applyFilters(); });
    customLabel.append(customCb, ' Custom');

    const sysLabel = document.createElement('label');
    sysLabel.className = 'erd-filter-checkbox';
    const sysCb = document.createElement('input');
    sysCb.type = 'checkbox';
    sysCb.addEventListener('change', () => { this._filterHideSystem = sysCb.checked; this._applyFilters(); });
    sysLabel.append(sysCb, ' Hide system');

    // System FK fields toggle dropdown
    const fkWrap = document.createElement('div');
    fkWrap.className = 'erd-export-dropdown';
    const fkBtn = document.createElement('button');
    fkBtn.className = 'erd-btn erd-btn-outline';
    fkBtn.textContent = 'FK Fields \u25BE';
    fkBtn.title = 'Show/hide system lookup fields on all entities';
    const fkMenu = document.createElement('div');
    fkMenu.className = 'erd-export-menu erd-fk-menu';
    fkMenu.style.display = 'none';

    const fkLabels = [
      ['createdby', 'Created By'],
      ['modifiedby', 'Modified By'],
      ['createdonbehalfby', 'Created By (Delegate)'],
      ['modifiedonbehalfby', 'Modified By (Delegate)'],
      ['owningbusinessunit', 'Owning Business Unit'],
      ['owningteam', 'Owning Team'],
      ['owninguser', 'Owning User'],
    ];
    for (const [fieldName, label] of fkLabels) {
      const fkLabel = document.createElement('label');
      fkLabel.className = 'erd-fk-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !this._hiddenSystemFKs.has(fieldName);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          this._hiddenSystemFKs.delete(fieldName);
        } else {
          this._hiddenSystemFKs.add(fieldName);
        }
        this._renderERD(true);
      });
      fkLabel.append(cb, ` ${label}`);
      fkMenu.appendChild(fkLabel);
    }

    // Show all / hide all buttons
    const fkActions = document.createElement('div');
    fkActions.className = 'erd-fk-actions';
    const showAllBtn = document.createElement('button');
    showAllBtn.className = 'erd-btn erd-btn-outline';
    showAllBtn.textContent = 'Show all';
    showAllBtn.addEventListener('click', () => {
      this._hiddenSystemFKs.clear();
      fkMenu.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = true);
      this._renderERD(true);
    });
    const hideAllBtn = document.createElement('button');
    hideAllBtn.className = 'erd-btn erd-btn-outline';
    hideAllBtn.textContent = 'Hide all';
    hideAllBtn.addEventListener('click', () => {
      for (const [fn] of fkLabels) this._hiddenSystemFKs.add(fn);
      fkMenu.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = false);
      this._renderERD(true);
    });
    fkActions.append(showAllBtn, hideAllBtn);
    fkMenu.appendChild(fkActions);

    fkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fkMenu.style.display = fkMenu.style.display === 'none' ? 'flex' : 'none';
    });
    this._fkMenuClose = () => { fkMenu.style.display = 'none'; };
    document.addEventListener('click', this._fkMenuClose);
    fkMenu.addEventListener('click', (e) => e.stopPropagation());
    fkWrap.append(fkBtn, fkMenu);

    bar.append(input, customLabel, sysLabel, fkWrap);
    this.container.appendChild(bar);
  }

  _buildContent() {
    const content = document.createElement('div');
    content.className = 'erd-content';
    this.container.appendChild(content);

    // Canvas wrapper
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'erd-canvas-wrap';
    this._canvasWrap = canvasWrap;
    content.appendChild(canvasWrap);

    // SVG
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'erd-svg');
    svg.setAttribute('xmlns', SVG_NS);
    this._svg = svg;

    // Defs: crow's foot markers
    svg.appendChild(this._createCrowsFootMarkers());

    const root = svgEl('g', { id: 'erd-root' });
    this._svgRoot = root;
    svg.appendChild(root);

    canvasWrap.appendChild(svg);
    this._setupPanZoom(svg);

    // Minimap canvas
    this._buildMinimap(canvasWrap);

    // Detail panel
    const detail = document.createElement('div');
    detail.className = 'erd-detail';
    detail.style.display = 'none';
    this._detailPanel = detail;
    content.appendChild(detail);
  }

  // -------------------------------------------------------------------------
  // Crow's foot SVG markers
  // -------------------------------------------------------------------------

  _createCrowsFootMarkers() {
    const defs = svgEl('defs');

    // "One" marker: perpendicular line |
    const one = svgEl('marker', {
      id: 'cf-one', markerWidth: '12', markerHeight: '12',
      refX: '10', refY: '6', orient: 'auto', markerUnits: 'strokeWidth',
    });
    one.appendChild(svgEl('line', {
      x1: '8', y1: '2', x2: '8', y2: '10',
      stroke: 'var(--color-border-strong,#555)', 'stroke-width': '1.5',
    }));
    defs.appendChild(one);

    // "Many" marker: crow's foot fork ><
    const many = svgEl('marker', {
      id: 'cf-many', markerWidth: '14', markerHeight: '14',
      refX: '12', refY: '7', orient: 'auto', markerUnits: 'strokeWidth',
    });
    many.appendChild(svgEl('line', {
      x1: '12', y1: '7', x2: '2', y2: '2',
      stroke: 'var(--color-border-strong,#555)', 'stroke-width': '1.5',
    }));
    many.appendChild(svgEl('line', {
      x1: '12', y1: '7', x2: '2', y2: '7',
      stroke: 'var(--color-border-strong,#555)', 'stroke-width': '1.5',
    }));
    many.appendChild(svgEl('line', {
      x1: '12', y1: '7', x2: '2', y2: '12',
      stroke: 'var(--color-border-strong,#555)', 'stroke-width': '1.5',
    }));
    defs.appendChild(many);

    // "One-one" marker (for 1 side): single perpendicular + small perpendicular
    const oneOne = svgEl('marker', {
      id: 'cf-one-one', markerWidth: '16', markerHeight: '12',
      refX: '14', refY: '6', orient: 'auto', markerUnits: 'strokeWidth',
    });
    oneOne.appendChild(svgEl('line', {
      x1: '12', y1: '2', x2: '12', y2: '10',
      stroke: 'var(--color-border-strong,#555)', 'stroke-width': '1.5',
    }));
    oneOne.appendChild(svgEl('line', {
      x1: '8', y1: '2', x2: '8', y2: '10',
      stroke: 'var(--color-border-strong,#555)', 'stroke-width': '1.5',
    }));
    defs.appendChild(oneOne);

    // Legacy simple arrowhead (fallback)
    const arrow = svgEl('marker', {
      id: 'arrow-end', markerWidth: '10', markerHeight: '7',
      refX: '9', refY: '3.5', orient: 'auto',
    });
    arrow.appendChild(svgEl('polygon', {
      points: '0 0, 10 3.5, 0 7', fill: 'var(--color-border-strong,#555)',
    }));
    defs.appendChild(arrow);

    return defs;
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
    this._solutionName = uniqueName;
    this._entities = [];
    this._relationships = [];
    this._positions.clear();
    this._expanded.clear();
    this._entityKeyFields.clear();
    this._entityAllFields.clear();
    this._entitySizes.clear();
    this._adjacency.clear();
    this._selectedEntity = null;
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
        this._entities = allEntities.slice(0, 30);
        this._showNotification('Showing first 30 entities (solution filter unavailable)', 'info');
      }

      // Collect relationships (1:N and N:N)
      const sample = this._entities.slice(0, 40);
      const entityNames = new Set(this._entities.map(e => e.LogicalName));

      const rawOneToMany = [];
      const rawManyToMany = [];

      await Promise.all(sample.map(async (ent) => {
        try {
          const rels = await this.cache.getRelationships(ent.LogicalName);
          for (const rel of rels.OneToMany) {
            if (entityNames.has(rel.ReferencingEntity)) {
              rawOneToMany.push(rel);
            }
          }
          if (rels.ManyToMany) {
            for (const rel of rels.ManyToMany) {
              if (entityNames.has(rel.Entity1LogicalName) && entityNames.has(rel.Entity2LogicalName)) {
                rawManyToMany.push(rel);
              }
            }
          }
        } catch { /* ignore per-entity errors */ }
      }));

      this._normalizeRelationships(rawOneToMany, rawManyToMany);

      // Pre-load entity fields (PK + FK) for all entities
      await Promise.all(this._entities.map(ent => this._loadEntityFields(ent)));

      this._renderERD();

      // Restore saved entity positions if available
      try {
        const stored = await chrome.storage?.local?.get(`erd_layout_${uniqueName}`);
        const positions = stored?.[`erd_layout_${uniqueName}`];
        if (positions && typeof positions === 'object') {
          let restored = false;
          for (const ent of this._entities) {
            const pos = positions[ent.LogicalName];
            if (pos?.x != null && pos?.y != null) {
              ent.x = pos.x;
              ent.y = pos.y;
              restored = true;
            }
          }
          if (restored) this._renderERD();
        }
      } catch { /* ok */ }

      // Easter egg achievements
      import('./easter-eggs.js').then(ee => {
        ee.unlockAchievement('first_erd');
        if (this._entities.length >= 10) ee.unlockAchievement('erd_10_entities');
        ee.maybeShowClippy('erd');
      }).catch(() => {});
    } catch (err) {
      this._showNotification(`Failed to load solution: ${err.message}`, 'error');
    } finally {
      this._showLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Normalize relationships into unified RelEdge[]
  // -------------------------------------------------------------------------

  _normalizeRelationships(oneToMany, manyToMany) {
    const seen = new Set();
    this._relationships = [];

    for (const rel of oneToMany) {
      if (seen.has(rel.SchemaName)) continue;
      seen.add(rel.SchemaName);
      this._relationships.push({
        schemaName: rel.SchemaName,
        type: '1:N',
        sourceEntity: rel.ReferencedEntity,
        targetEntity: rel.ReferencingEntity,
        sourceAttribute: rel.ReferencedAttribute,
        targetAttribute: rel.ReferencingAttribute,
        intersectEntity: null,
        navPropertyName: rel.ReferencingEntityNavigationPropertyName || '',
      });
    }

    for (const rel of manyToMany) {
      if (seen.has(rel.SchemaName)) continue;
      seen.add(rel.SchemaName);
      this._relationships.push({
        schemaName: rel.SchemaName,
        type: 'N:N',
        sourceEntity: rel.Entity1LogicalName,
        targetEntity: rel.Entity2LogicalName,
        sourceAttribute: rel.Entity1IntersectAttribute || '',
        targetAttribute: rel.Entity2IntersectAttribute || '',
        intersectEntity: rel.IntersectEntityName || '',
        navPropertyName: rel.Entity1NavigationPropertyName || '',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Load entity fields: key fields (default) + all fields (expanded)
  // -------------------------------------------------------------------------

  async _loadEntityFields(ent) {
    if (this._entityKeyFields.has(ent.LogicalName)) return;
    try {
      const attrs = await this.cache.getAttributes(ent.LogicalName);
      const keyFields = [];
      const allFields = [];

      const makeField = (attr, isPk, isLookup) => ({
        name: attr.LogicalName,
        displayName: attr.DisplayName?.UserLocalizedLabel?.Label || attr.LogicalName,
        type: attr.AttributeType || 'String',
        isPk,
        isLookup,
      });

      // PK
      const pk = attrs.find(a => a.LogicalName === ent.PrimaryIdAttribute);
      if (pk) keyFields.push(makeField(pk, true, false));

      // Primary name
      const pn = attrs.find(a => a.LogicalName === ent.PrimaryNameAttribute);
      if (pn) keyFields.push(makeField(pn, false, false));

      // Lookup/Owner/Customer fields → key fields
      for (const attr of attrs) {
        if (attr.LogicalName === ent.PrimaryIdAttribute || attr.LogicalName === ent.PrimaryNameAttribute) continue;
        const t = attr.AttributeType;
        if (t === 'Lookup' || t === 'Owner' || t === 'Customer') {
          keyFields.push(makeField(attr, false, true));
        }
      }

      // All fields for expanded view (PK first, then alpha by display name)
      if (pk) allFields.push(makeField(pk, true, false));
      if (pn) allFields.push(makeField(pn, false, false));

      const rest = attrs
        .filter(a => a.LogicalName !== ent.PrimaryIdAttribute && a.LogicalName !== ent.PrimaryNameAttribute)
        .sort((a, b) => (a.DisplayName?.UserLocalizedLabel?.Label || a.LogicalName)
          .localeCompare(b.DisplayName?.UserLocalizedLabel?.Label || b.LogicalName));

      for (const attr of rest) {
        const t = attr.AttributeType;
        const isLookup = t === 'Lookup' || t === 'Owner' || t === 'Customer';
        allFields.push(makeField(attr, false, isLookup));
      }

      this._entityKeyFields.set(ent.LogicalName, keyFields);
      this._entityAllFields.set(ent.LogicalName, allFields);
    } catch {
      this._entityKeyFields.set(ent.LogicalName, []);
      this._entityAllFields.set(ent.LogicalName, []);
    }
  }

  // -------------------------------------------------------------------------
  // Visible fields for entity box (respects system FK filter + per-entity overrides)
  // -------------------------------------------------------------------------

  _getVisibleFields(entityName) {
    const isExpanded = this._expanded.get(entityName) === true;
    const allFields = isExpanded
      ? (this._entityAllFields.get(entityName) || [])
      : (this._entityKeyFields.get(entityName) || []);

    // Per-entity override: if set, only show those specific fields
    const overrides = this._entityFieldOverrides.get(entityName);
    if (overrides) {
      return allFields.filter(f => f.isPk || overrides.has(f.name));
    }

    // Otherwise, filter out hidden system FK fields (unless expanded to show all)
    if (isExpanded) return allFields;
    return allFields.filter(f => f.isPk || !f.isLookup || !this._hiddenSystemFKs.has(f.name));
  }

  // -------------------------------------------------------------------------
  // Adjacency graph (for highlighting + force layout)
  // -------------------------------------------------------------------------

  _buildAdjacency() {
    this._adjacency.clear();
    for (const ent of this._entities) {
      this._adjacency.set(ent.LogicalName, new Set());
    }
    for (const rel of this._relationships) {
      this._adjacency.get(rel.sourceEntity)?.add(rel.targetEntity);
      this._adjacency.get(rel.targetEntity)?.add(rel.sourceEntity);
    }
  }

  // -------------------------------------------------------------------------
  // Layout algorithms
  // -------------------------------------------------------------------------

  _computeGridLayout() {
    // Compute row heights (max entity height in each row)
    const rowHeights = [];
    this._entities.forEach((ent, i) => {
      const row = Math.floor(i / COL_SIZE);
      const fields = this._getVisibleFields(ent.LogicalName);
      const h = entityHeight(fields.length);
      if (!rowHeights[row] || h > rowHeights[row]) rowHeights[row] = h;
    });

    this._entities.forEach((ent, i) => {
      const col = i % COL_SIZE;
      const row = Math.floor(i / COL_SIZE);
      let y = 20;
      for (let r = 0; r < row; r++) y += (rowHeights[r] || 60) + V_GAP;
      this._positions.set(ent.LogicalName, {
        x: 20 + col * (ENTITY_W + H_GAP),
        y,
      });
    });
  }

  _computeForceLayout() {
    const entities = this._entities;
    const n = entities.length;
    if (n === 0) return;

    // Initialize positions in a circle
    const radius = Math.max(150, Math.sqrt(n) * 100);
    const cx = radius + 100;
    const cy = radius + 100;

    const pos = new Map();
    entities.forEach((ent, i) => {
      const angle = (2 * Math.PI * i) / n;
      pos.set(ent.LogicalName, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });

    // Build edge list from relationships
    const edges = this._relationships
      .filter(r => pos.has(r.sourceEntity) && pos.has(r.targetEntity))
      .map(r => [r.sourceEntity, r.targetEntity]);

    const names = entities.map(e => e.LogicalName);

    // Fruchterman-Reingold iterations
    for (let iter = 0; iter < FR_ITERATIONS; iter++) {
      const temp = Math.max(1, (1 - iter / FR_ITERATIONS) * radius * 0.1);
      const disp = new Map();
      for (const name of names) disp.set(name, { x: 0, y: 0 });

      // Repulsive forces (all pairs)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = names[i];
          const b = names[j];
          const pa = pos.get(a);
          const pb = pos.get(b);
          let dx = pa.x - pb.x;
          let dy = pa.y - pb.y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const force = FR_REPULSION / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          disp.get(a).x += fx;
          disp.get(a).y += fy;
          disp.get(b).x -= fx;
          disp.get(b).y -= fy;
        }
      }

      // Attractive forces (edges)
      for (const [a, b] of edges) {
        const pa = pos.get(a);
        const pb = pos.get(b);
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = FR_ATTRACTION * dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp.get(a).x += fx;
        disp.get(a).y += fy;
        disp.get(b).x -= fx;
        disp.get(b).y -= fy;
      }

      // Apply displacements with temperature clamping
      for (const name of names) {
        const d = disp.get(name);
        const mag = Math.max(1, Math.sqrt(d.x * d.x + d.y * d.y));
        const clamp = Math.min(mag, temp) / mag;
        const p = pos.get(name);
        p.x += d.x * clamp * FR_DAMPING;
        p.y += d.y * clamp * FR_DAMPING;
      }
    }

    // Overlap resolution pass (use actual entity heights)
    const boxGap = 60;
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const enti = entities[i];
        const fieldsI = this._getVisibleFields(enti.LogicalName);
        const hi = entityHeight(fieldsI.length);
        for (let j = i + 1; j < n; j++) {
          const entj = entities[j];
          const fieldsJ = this._getVisibleFields(entj.LogicalName);
          const hj = entityHeight(fieldsJ.length);
          const pa = pos.get(names[i]);
          const pb = pos.get(names[j]);
          const overlapX = (ENTITY_W + boxGap) - Math.abs(pa.x - pb.x);
          const overlapY = ((hi + hj) / 2 + boxGap) - Math.abs(pa.y - pb.y);
          if (overlapX > 0 && overlapY > 0) {
            const pushX = overlapX / 2 + 5;
            const pushY = overlapY / 2 + 5;
            if (overlapX < overlapY) {
              if (pa.x < pb.x) { pa.x -= pushX; pb.x += pushX; }
              else { pa.x += pushX; pb.x -= pushX; }
            } else {
              if (pa.y < pb.y) { pa.y -= pushY; pb.y += pushY; }
              else { pa.y += pushY; pb.y -= pushY; }
            }
            moved = true;
          }
        }
      }
      if (!moved) break;
    }

    // Translate so minimum x,y is at (20, 20)
    let minX = Infinity, minY = Infinity;
    for (const p of pos.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
    for (const p of pos.values()) { p.x -= minX - 20; p.y -= minY - 20; }

    this._positions = pos;
  }

  // -------------------------------------------------------------------------
  // Render ERD
  // -------------------------------------------------------------------------

  _renderERD(skipLayout = false) {
    if (!this._svgRoot) return;
    this._svgRoot.innerHTML = '';

    // Compute layout
    if (!skipLayout) {
      if (this._layoutMode === 'force') {
        this._computeForceLayout();
      } else {
        this._computeGridLayout();
      }
    }

    // Compute entity sizes
    for (const ent of this._entities) {
      const fields = this._getVisibleFields(ent.LogicalName);
      this._entitySizes.set(ent.LogicalName, {
        w: ENTITY_W,
        h: entityHeight(fields.length),
      });
    }

    // Build adjacency for highlighting
    this._buildAdjacency();

    // All entities visible initially
    this._visibleEntities = new Set(this._entities.map(e => e.LogicalName));
    this._applyFilters(true); // silent = true, just compute _visibleEntities

    // Assign lanes for orthogonal routing
    const laneOffsets = this._routingMode === 'orthogonal' ? this._assignLanes() : new Map();

    // Compute per-entity-side port offsets so arrows don't land at the same Y
    this._portOffsets = this._computePortOffsets();

    // Draw arrows first (behind entities)
    const arrowGroup = svgEl('g', { class: 'erd-arrows' });
    for (const rel of this._relationships) {
      const from = this._positions.get(rel.sourceEntity);
      const to = this._positions.get(rel.targetEntity);
      if (!from || !to) continue;
      if (!this._visibleEntities.has(rel.sourceEntity) || !this._visibleEntities.has(rel.targetEntity)) continue;
      const laneOffset = laneOffsets.get(rel.schemaName) || 0;
      arrowGroup.appendChild(this._drawArrow(rel, from, to, laneOffset));
    }
    this._svgRoot.appendChild(arrowGroup);

    // Draw entity boxes
    for (const ent of this._entities) {
      if (!this._visibleEntities.has(ent.LogicalName)) continue;
      const pos = this._positions.get(ent.LogicalName);
      if (!pos) continue;
      this._svgRoot.appendChild(this._drawEntityBox(ent, pos.x, pos.y));
    }

    // Fit SVG viewbox
    this._fitViewBox();

    // Reset transform
    if (!skipLayout) {
      this._pan = { x: 0, y: 0 };
      this._zoom = 1;
    }
    this._updateTransform();
  }

  _fitViewBox() {
    let maxX = 0, maxY = 0;
    for (const ent of this._entities) {
      if (!this._visibleEntities.has(ent.LogicalName)) continue;
      const pos = this._positions.get(ent.LogicalName);
      const size = this._entitySizes.get(ent.LogicalName);
      if (!pos || !size) continue;
      maxX = Math.max(maxX, pos.x + size.w);
      maxY = Math.max(maxY, pos.y + size.h);
    }
    this._svg.setAttribute('viewBox', `0 0 ${maxX + 40} ${maxY + 40}`);
  }

  // -------------------------------------------------------------------------
  // Draw entity box
  // Default: PK + primary name + FK/Lookup fields
  // Expanded (double-click): ALL fields
  // -------------------------------------------------------------------------

  _drawEntityBox(ent, x, y) {
    const displayName = ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName;
    const isCustom = ent.IsCustomEntity;
    const isExpanded = this._expanded.get(ent.LogicalName) === true;
    const fields = this._getVisibleFields(ent.LogicalName);
    const allFieldCount = (this._entityAllFields.get(ent.LogicalName) || []).length;
    const h = entityHeight(fields.length);
    this._entitySizes.set(ent.LogicalName, { w: ENTITY_W, h });

    const g = svgEl('g', {
      class: 'erd-entity',
      transform: `translate(${x},${y})`,
      'data-name': ent.LogicalName,
    });

    // Background rect
    g.appendChild(svgEl('rect', {
      class: 'erd-bg',
      x: 0, y: 0,
      width: ENTITY_W, height: h,
      rx: 4,
    }));

    // Header background
    g.appendChild(svgEl('rect', {
      class: isCustom ? 'erd-header erd-header-custom' : 'erd-header',
      x: 0, y: 0,
      width: ENTITY_W, height: HEADER_H,
      rx: 4,
    }));
    // Cover bottom corners of header
    g.appendChild(svgEl('rect', {
      x: 0, y: 20, width: ENTITY_W, height: 12,
      class: isCustom ? 'erd-header erd-header-custom' : 'erd-header',
    }));

    // Display name (truncated)
    const titleText = svgEl('text', { x: 8, y: 14, class: 'erd-entity-name' });
    titleText.textContent = displayName.length > 24 ? displayName.substring(0, 22) + '\u2026' : displayName;
    g.appendChild(titleText);

    // Logical name
    const logicalText = svgEl('text', { x: 8, y: 26, class: 'erd-entity-logical' });
    logicalText.textContent = ent.LogicalName;
    g.appendChild(logicalText);

    // Expand/collapse toggle indicator
    const toggleText = svgEl('text', {
      x: ENTITY_W - 14, y: 20, class: 'erd-collapse-toggle',
      'text-anchor': 'middle',
    });
    toggleText.textContent = isExpanded ? '\u25BC' : `[${allFieldCount}]`;
    g.appendChild(toggleText);

    // Separator and fields (always shown)
    g.appendChild(svgEl('line', { x1: 0, y1: HEADER_H, x2: ENTITY_W, y2: HEADER_H, class: 'erd-separator' }));

    fields.forEach((f, i) => {
      const fy = HEADER_H + FIELD_PAD + i * FIELD_H + 12;
      const fieldText = svgEl('text', {
        x: 8, y: fy,
        class: f.isLookup ? 'erd-field erd-field-lookup' : 'erd-field',
        'data-field': f.name,
      });
      const prefix = f.isPk ? '\uD83D\uDD11 ' : f.isLookup ? '\uD83D\uDD17 ' : '';
      const label = f.displayName !== f.name ? f.displayName : f.name;
      fieldText.textContent = `${prefix}${label} (${attrTypeShort(f.type)})`;
      g.appendChild(fieldText);
    });

    // --- Interaction handlers ---

    // Double-click to toggle expanded (all fields) vs key fields
    g.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._expanded.set(ent.LogicalName, !isExpanded);
      this._renderERD(true);
      if (this._selectedEntity?.LogicalName === ent.LogicalName) {
        const newG = this._svgRoot?.querySelector(`.erd-entity[data-name="${ent.LogicalName}"]`);
        if (newG) newG.classList.add('erd-selected');
      }
    });

    // Click to select
    g.addEventListener('click', (e) => {
      if (this._dragTarget) return;
      this._selectEntity(ent);
    });

    // Hover highlighting
    g.addEventListener('mouseenter', () => this._applyHighlighting(ent.LogicalName));
    g.addEventListener('mouseleave', () => this._clearHighlighting());

    // Right-click: per-entity column chooser
    g.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showColumnChooser(ent);
    });

    // Entity dragging
    this._setupEntityDrag(g, ent.LogicalName);

    return g;
  }

  // -------------------------------------------------------------------------
  // Per-entity column chooser popup
  // -------------------------------------------------------------------------

  _showColumnChooser(ent) {
    // Remove any existing chooser
    this._canvasWrap?.querySelector('.erd-col-chooser')?.remove();

    const allFields = this._entityKeyFields.get(ent.LogicalName) || [];
    const currentOverrides = this._entityFieldOverrides.get(ent.LogicalName);
    const displayName = ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName;

    const popup = document.createElement('div');
    popup.className = 'erd-col-chooser';

    const header = document.createElement('div');
    header.className = 'erd-col-chooser-header';
    header.textContent = displayName;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'erd-detail-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => popup.remove());
    header.appendChild(closeBtn);
    popup.appendChild(header);

    const list = document.createElement('div');
    list.className = 'erd-col-chooser-list';

    for (const f of allFields) {
      if (f.isPk) continue; // PK always shown
      const label = document.createElement('label');
      label.className = 'erd-fk-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      // Checked if: no overrides (use default visibility) or explicitly in overrides
      if (currentOverrides) {
        cb.checked = currentOverrides.has(f.name);
      } else {
        cb.checked = !f.isLookup || !this._hiddenSystemFKs.has(f.name);
      }
      cb.addEventListener('change', () => {
        // Initialize overrides from current visibility if first interaction
        if (!this._entityFieldOverrides.has(ent.LogicalName)) {
          const visible = new Set();
          for (const ff of allFields) {
            if (ff.isPk) continue;
            if (!ff.isLookup || !this._hiddenSystemFKs.has(ff.name)) visible.add(ff.name);
          }
          this._entityFieldOverrides.set(ent.LogicalName, visible);
        }
        const overrides = this._entityFieldOverrides.get(ent.LogicalName);
        if (cb.checked) overrides.add(f.name);
        else overrides.delete(f.name);
        this._renderERD(true);
      });
      const dispName = f.displayName !== f.name ? f.displayName : f.name;
      label.append(cb, ` ${dispName} (${attrTypeShort(f.type)})`);
      list.appendChild(label);
    }
    popup.appendChild(list);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'erd-btn erd-btn-outline';
    resetBtn.textContent = 'Reset to default';
    resetBtn.style.cssText = 'margin:6px 8px;font-size:0.75rem;';
    resetBtn.addEventListener('click', () => {
      this._entityFieldOverrides.delete(ent.LogicalName);
      popup.remove();
      this._renderERD(true);
    });
    popup.appendChild(resetBtn);

    // Close on outside click or Escape
    const cleanup = () => {
      popup.remove();
      document.removeEventListener('pointerdown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEsc, true);
    };
    const closeOnOutside = (e) => {
      if (!popup.contains(e.target)) cleanup();
    };
    const closeOnEsc = (e) => {
      if (e.key === 'Escape') cleanup();
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', closeOnOutside, true);
      document.addEventListener('keydown', closeOnEsc, true);
    }, 50);

    this._canvasWrap?.appendChild(popup);
  }

  // -------------------------------------------------------------------------
  // Draw relationship arrows
  // -------------------------------------------------------------------------

  /**
   * Determine the best side (top/right/bottom/left) for an arrow to
   * exit/enter an entity based on the angle to the other entity.
   * Returns { fx, fy, tx, ty } — the exact connection points.
   */
  _computeEndpoints(rel, fromPos, toPos) {
    const fromSize = this._entitySizes.get(rel.sourceEntity) || { w: ENTITY_W, h: 60 };
    const toSize = this._entitySizes.get(rel.targetEntity) || { w: ENTITY_W, h: 60 };

    // Centers
    const fcx = fromPos.x + fromSize.w / 2;
    const fcy = fromPos.y + fromSize.h / 2;
    const tcx = toPos.x + toSize.w / 2;
    const tcy = toPos.y + toSize.h / 2;

    // Angle from source center to target center
    const dx = tcx - fcx;
    const dy = tcy - fcy;
    const angle = Math.atan2(dy, dx); // -PI to PI

    // Pick exit side based on angle
    // right: -45° to 45°, bottom: 45° to 135°, left: 135° to -135°, top: -135° to -45°
    const PI = Math.PI;
    let fx, fy, tx, ty;

    // Port offset for Y distribution
    const portKey = rel.schemaName;
    const fromPort = this._portOffsets?.get(`${rel.sourceEntity}:src:${portKey}`);
    const toPort = this._portOffsets?.get(`${rel.targetEntity}:tgt:${portKey}`);

    if (angle > -PI / 4 && angle <= PI / 4) {
      // Exit RIGHT
      fx = fromPos.x + fromSize.w;
      fy = fromPos.y + (fromPort?.y ?? fromSize.h / 2);
    } else if (angle > PI / 4 && angle <= 3 * PI / 4) {
      // Exit BOTTOM
      fx = fromPos.x + (fromPort?.x ?? fromSize.w / 2);
      fy = fromPos.y + fromSize.h;
    } else if (angle > -3 * PI / 4 && angle <= -PI / 4) {
      // Exit TOP
      fx = fromPos.x + (fromPort?.x ?? fromSize.w / 2);
      fy = fromPos.y;
    } else {
      // Exit LEFT
      fx = fromPos.x;
      fy = fromPos.y + (fromPort?.y ?? fromSize.h / 2);
    }

    // Entry side: opposite direction (angle + PI)
    const entryAngle = Math.atan2(-dy, -dx);
    if (entryAngle > -PI / 4 && entryAngle <= PI / 4) {
      tx = toPos.x + toSize.w;
      ty = toPos.y + (toPort?.y ?? toSize.h / 2);
    } else if (entryAngle > PI / 4 && entryAngle <= 3 * PI / 4) {
      tx = toPos.x + (toPort?.x ?? toSize.w / 2);
      ty = toPos.y + toSize.h;
    } else if (entryAngle > -3 * PI / 4 && entryAngle <= -PI / 4) {
      tx = toPos.x + (toPort?.x ?? toSize.w / 2);
      ty = toPos.y;
    } else {
      tx = toPos.x;
      ty = toPos.y + (toPort?.y ?? toSize.h / 2);
    }

    return { fx, fy, tx, ty };
  }

  _drawArrow(rel, fromPos, toPos, laneOffset = 0) {
    const { fx, fy, tx, ty } = this._computeEndpoints(rel, fromPos, toPos);

    // Path
    let d;
    if (this._routingMode === 'orthogonal') {
      d = this._computeOrthogonalPath(fx, fy, tx, ty, laneOffset);
    } else {
      const midX = (fx + tx) / 2;
      const midY = (fy + ty) / 2;
      // Use control points that respect exit/entry direction
      d = `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`;
    }

    // Markers based on relationship type
    let markerStart, markerEnd, cssClass;
    if (rel.type === '1:N') {
      markerStart = 'url(#cf-one-one)';
      markerEnd = 'url(#cf-many)';
      cssClass = 'erd-arrow';
    } else if (rel.type === 'N:N') {
      markerStart = 'url(#cf-many)';
      markerEnd = 'url(#cf-many)';
      cssClass = 'erd-arrow erd-arrow-nn';
    } else {
      markerStart = '';
      markerEnd = 'url(#arrow-end)';
      cssClass = 'erd-arrow';
    }

    const g = svgEl('g', {
      class: 'erd-arrow-group',
      'data-source': rel.sourceEntity,
      'data-target': rel.targetEntity,
      'data-schema': rel.schemaName,
    });

    // Tooltip
    const tooltipParts = [rel.schemaName];
    if (rel.sourceEntity && rel.targetEntity) {
      tooltipParts.push(`${rel.sourceEntity} \u2192 ${rel.targetEntity}`);
    }
    tooltipParts.push(`Type: ${rel.type}`);
    if (rel.intersectEntity) tooltipParts.push(`Intersect: ${rel.intersectEntity}`);
    if (rel.sourceAttribute) tooltipParts.push(`on: ${rel.sourceAttribute}`);

    const title = svgEl('title');
    title.textContent = tooltipParts.filter(Boolean).join('\n');
    g.appendChild(title);

    const pathAttrs = {
      d, class: cssClass, fill: 'none',
    };
    if (markerStart) pathAttrs['marker-start'] = markerStart;
    if (markerEnd) pathAttrs['marker-end'] = markerEnd;

    g.appendChild(svgEl('path', pathAttrs));
    return g;
  }

  // -------------------------------------------------------------------------
  // Port offset computation: distribute arrows along entity sides
  // -------------------------------------------------------------------------

  /**
   * Determine which side an arrow exits/enters based on angle.
   */
  _getSide(fromPos, fromSize, toPos) {
    const fcx = fromPos.x + fromSize.w / 2;
    const fcy = fromPos.y + fromSize.h / 2;
    const toSize = { w: ENTITY_W, h: 60 };
    const tcx = toPos.x + (toSize.w || ENTITY_W) / 2;
    const tcy = toPos.y + (toSize.h || 60) / 2;
    const angle = Math.atan2(tcy - fcy, tcx - fcx);
    const PI = Math.PI;
    if (angle > -PI / 4 && angle <= PI / 4) return 'right';
    if (angle > PI / 4 && angle <= 3 * PI / 4) return 'bottom';
    if (angle > -3 * PI / 4 && angle <= -PI / 4) return 'top';
    return 'left';
  }

  _computePortOffsets() {
    const offsets = new Map();

    // Group arrows by entity + side
    const entityArrows = new Map();

    for (const rel of this._relationships) {
      const from = this._positions.get(rel.sourceEntity);
      const to = this._positions.get(rel.targetEntity);
      if (!from || !to) continue;
      if (!this._visibleEntities.has(rel.sourceEntity) || !this._visibleEntities.has(rel.targetEntity)) continue;

      const fromSize = this._entitySizes.get(rel.sourceEntity) || { w: ENTITY_W, h: 60 };
      const toSize = this._entitySizes.get(rel.targetEntity) || { w: ENTITY_W, h: 60 };

      const fromSide = this._getSide(from, fromSize, to);
      const toSide = this._getSide(to, toSize, from);

      const srcKey = `${rel.sourceEntity}:${fromSide}`;
      const tgtKey = `${rel.targetEntity}:${toSide}`;

      if (!entityArrows.has(srcKey)) entityArrows.set(srcKey, []);
      entityArrows.get(srcKey).push({ schema: rel.schemaName, role: 'src' });

      if (!entityArrows.has(tgtKey)) entityArrows.set(tgtKey, []);
      entityArrows.get(tgtKey).push({ schema: rel.schemaName, role: 'tgt' });
    }

    // Distribute arrows along each entity side
    for (const [key, arrows] of entityArrows) {
      const [entityName, side] = key.split(':');
      const size = this._entitySizes.get(entityName) || { w: ENTITY_W, h: 60 };

      // For left/right sides: distribute along Y
      // For top/bottom sides: distribute along X
      const isVertical = (side === 'left' || side === 'right');
      const usable = isVertical ? (size.h - HEADER_H - 8) : (size.w - 16);
      const start = isVertical ? (HEADER_H + 4) : 8;

      const step = usable / (arrows.length + 1);
      arrows.forEach((a, i) => {
        const val = start + step * (i + 1);
        if (isVertical) {
          offsets.set(`${entityName}:${a.role}:${a.schema}`, { y: val });
        } else {
          offsets.set(`${entityName}:${a.role}:${a.schema}`, { x: val });
        }
      });
    }

    return offsets;
  }

  // -------------------------------------------------------------------------
  // Field anchor Y position
  // -------------------------------------------------------------------------

  _computeFieldAnchorY(entityName, fieldName) {
    const fields = this._getVisibleFields(entityName);
    if (!fields.length) return null;
    // Try matching by logical name (with or without _value suffix for lookups)
    const idx = fields.findIndex(f =>
      f.name === fieldName ||
      f.name === `_${fieldName}_value` ||
      `_${f.name}_value` === fieldName
    );
    if (idx === -1) return null;
    return HEADER_H + FIELD_PAD + idx * FIELD_H + 12;
  }

  // -------------------------------------------------------------------------
  // Orthogonal edge routing (H-V-H Manhattan)
  // -------------------------------------------------------------------------

  _computeOrthogonalPath(fx, fy, tx, ty, laneOffset = 0) {
    const gap = 25;
    // Simple 3-segment path: exit gap → mid → entry gap
    const midX = (fx + tx) / 2 + laneOffset;
    const midY = (fy + ty) / 2 + laneOffset;

    // If mostly horizontal separation, use H-V-H
    if (Math.abs(tx - fx) > Math.abs(ty - fy)) {
      return `M ${fx} ${fy} H ${midX} V ${ty} H ${tx}`;
    }
    // If mostly vertical, use V-H-V
    return `M ${fx} ${fy} V ${midY} H ${tx} V ${ty}`;
  }

  _assignLanes() {
    const lanes = new Map();
    // Group relationships by approximate midpoint corridor
    const corridors = new Map();

    for (const rel of this._relationships) {
      const from = this._positions.get(rel.sourceEntity);
      const to = this._positions.get(rel.targetEntity);
      if (!from || !to) continue;

      // Bucket by midpoint of the connection (rounded)
      const midX = Math.round(((from.x + to.x) / 2) / 40) * 40;
      const midY = Math.round(((from.y + to.y) / 2) / 40) * 40;
      const key = `${midX},${midY}`;
      if (!corridors.has(key)) corridors.set(key, []);
      corridors.get(key).push(rel.schemaName);
    }

    for (const group of corridors.values()) {
      if (group.length <= 1) {
        lanes.set(group[0], 0);
        continue;
      }
      const half = (group.length - 1) / 2;
      group.forEach((name, i) => {
        lanes.set(name, (i - half) * 8);
      });
    }

    return lanes;
  }

  // -------------------------------------------------------------------------
  // Entity dragging
  // -------------------------------------------------------------------------

  _setupEntityDrag(g, entityName) {
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // prevent pan

      this._dragTarget = entityName;
      this._dragStart = { x: e.clientX, y: e.clientY };
      const pos = this._positions.get(entityName);
      this._entityPosAtDragStart = { x: pos.x, y: pos.y };
      g.classList.add('erd-dragging');
      g.setPointerCapture(e.pointerId);

      const onMove = (me) => {
        if (!this._dragTarget) return;
        if (this._dragRAF) return;
        this._dragRAF = requestAnimationFrame(() => {
          this._dragRAF = null;
          const dx = (me.clientX - this._dragStart.x) / this._zoom;
          const dy = (me.clientY - this._dragStart.y) / this._zoom;
          const newPos = {
            x: this._entityPosAtDragStart.x + dx,
            y: this._entityPosAtDragStart.y + dy,
          };
          this._positions.set(entityName, newPos);
          g.setAttribute('transform', `translate(${newPos.x},${newPos.y})`);
          this._redrawConnectedArrows(entityName);
          this._renderMinimap();
        });
      };

      const onUp = () => {
        this._dragTarget = null;
        g.classList.remove('erd-dragging');
        g.removeEventListener('pointermove', onMove);
        g.removeEventListener('pointerup', onUp);
        g.removeEventListener('pointercancel', onUp);
        if (this._solutionName) this._saveLayout();
      };

      g.addEventListener('pointermove', onMove);
      g.addEventListener('pointerup', onUp);
      g.addEventListener('pointercancel', onUp);
    });
  }

  _redrawConnectedArrows(entityName) {
    if (!this._svgRoot) return;
    const arrowGroups = this._svgRoot.querySelectorAll(
      `.erd-arrow-group[data-source="${entityName}"], .erd-arrow-group[data-target="${entityName}"]`
    );

    // Recompute port offsets since positions changed
    this._portOffsets = this._computePortOffsets();
    const laneOffsets = this._routingMode === 'orthogonal' ? this._assignLanes() : new Map();

    for (const ag of arrowGroups) {
      const schema = ag.getAttribute('data-schema');
      const rel = this._relationships.find(r => r.schemaName === schema);
      if (!rel) continue;

      const from = this._positions.get(rel.sourceEntity);
      const to = this._positions.get(rel.targetEntity);
      if (!from || !to) continue;

      const { fx, fy, tx, ty } = this._computeEndpoints(rel, from, to);

      let d;
      const laneOffset = laneOffsets.get(rel.schemaName) || 0;
      if (this._routingMode === 'orthogonal') {
        d = this._computeOrthogonalPath(fx, fy, tx, ty, laneOffset);
      } else {
        const midX = (fx + tx) / 2;
        d = `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`;
      }

      const path = ag.querySelector('path');
      if (path) path.setAttribute('d', d);
    }
  }

  // -------------------------------------------------------------------------
  // Highlighting
  // -------------------------------------------------------------------------

  _applyHighlighting(entityName) {
    if (this._dragTarget) return; // don't highlight during drag
    this._hoveredEntity = entityName;
    const neighbors = this._adjacency.get(entityName) || new Set();

    // Fade all entities
    this._svgRoot?.querySelectorAll('.erd-entity').forEach(el => {
      const name = el.getAttribute('data-name');
      if (name === entityName || neighbors.has(name)) {
        el.classList.add('erd-highlighted');
        el.classList.remove('erd-faded');
      } else {
        el.classList.add('erd-faded');
        el.classList.remove('erd-highlighted');
      }
    });

    // Fade arrows
    this._svgRoot?.querySelectorAll('.erd-arrow-group').forEach(el => {
      const src = el.getAttribute('data-source');
      const tgt = el.getAttribute('data-target');
      if (src === entityName || tgt === entityName) {
        el.classList.add('erd-highlighted');
        el.classList.remove('erd-faded');
      } else {
        el.classList.add('erd-faded');
        el.classList.remove('erd-highlighted');
      }
    });
  }

  _clearHighlighting() {
    this._hoveredEntity = null;
    this._svgRoot?.querySelectorAll('.erd-faded, .erd-highlighted').forEach(el => {
      el.classList.remove('erd-faded', 'erd-highlighted');
    });
  }

  // -------------------------------------------------------------------------
  // Entity selection & detail panel
  // -------------------------------------------------------------------------

  _selectEntity(ent) {
    this._svgRoot?.querySelectorAll('.erd-entity.erd-selected').forEach(el => {
      el.classList.remove('erd-selected');
    });

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
  // Filtering
  // -------------------------------------------------------------------------

  _applyFilters(silent = false) {
    this._visibleEntities = new Set();
    const text = this._filterText.toLowerCase();

    for (const ent of this._entities) {
      const displayName = (ent.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase();
      const logical = ent.LogicalName.toLowerCase();

      if (text && !displayName.includes(text) && !logical.includes(text)) continue;
      if (this._filterCustomOnly && !ent.IsCustomEntity) continue;
      if (this._filterHideSystem && ent.IsManaged) continue;

      this._visibleEntities.add(ent.LogicalName);
    }

    if (!silent && this._svgRoot) {
      // Toggle visibility on SVG elements
      this._svgRoot.querySelectorAll('.erd-entity').forEach(el => {
        const name = el.getAttribute('data-name');
        el.style.display = this._visibleEntities.has(name) ? '' : 'none';
      });

      this._svgRoot.querySelectorAll('.erd-arrow-group').forEach(el => {
        const src = el.getAttribute('data-source');
        const tgt = el.getAttribute('data-target');
        el.style.display = (this._visibleEntities.has(src) && this._visibleEntities.has(tgt)) ? '' : 'none';
      });

      this._renderMinimap();
    }
  }

  // -------------------------------------------------------------------------
  // Minimap
  // -------------------------------------------------------------------------

  _buildMinimap(parent) {
    const canvas = document.createElement('canvas');
    canvas.className = 'erd-minimap';
    canvas.width = 180;
    canvas.height = 120;

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this._navigateFromMinimap(cx, cy);
    });

    parent.appendChild(canvas);
    this._minimapCanvas = canvas;
  }

  _renderMinimap() {
    const canvas = this._minimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    if (!this._entities.length) return;

    // Compute bounding box of all visible entities
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ent of this._entities) {
      if (!this._visibleEntities.has(ent.LogicalName)) continue;
      const pos = this._positions.get(ent.LogicalName);
      const size = this._entitySizes.get(ent.LogicalName);
      if (!pos || !size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.w);
      maxY = Math.max(maxY, pos.y + size.h);
    }

    if (minX === Infinity) return;

    const pad = 20;
    const totalW = maxX - minX + pad * 2;
    const totalH = maxY - minY + pad * 2;
    const scale = Math.min(cw / totalW, ch / totalH);
    const offX = (cw - totalW * scale) / 2 - minX * scale + pad * scale;
    const offY = (ch - totalH * scale) / 2 - minY * scale + pad * scale;

    // Draw entity rectangles
    for (const ent of this._entities) {
      if (!this._visibleEntities.has(ent.LogicalName)) continue;
      const pos = this._positions.get(ent.LogicalName);
      const size = this._entitySizes.get(ent.LogicalName);
      if (!pos || !size) continue;

      const rx = pos.x * scale + offX;
      const ry = pos.y * scale + offY;
      const rw = size.w * scale;
      const rh = size.h * scale;

      ctx.fillStyle = ent.IsCustomEntity ? 'rgba(0,120,212,0.5)' : 'rgba(85,85,85,0.5)';
      ctx.fillRect(rx, ry, rw, rh);
    }

    // Draw viewport rectangle
    if (this._svg) {
      const svgRect = this._svg.getBoundingClientRect();
      if (svgRect.width > 0 && svgRect.height > 0) {
        const vpX = (-this._pan.x / this._zoom) * scale + offX;
        const vpY = (-this._pan.y / this._zoom) * scale + offY;
        const vpW = (svgRect.width / this._zoom) * scale;
        const vpH = (svgRect.height / this._zoom) * scale;

        ctx.strokeStyle = cssVar('--color-accent-primary') || '#0078d4';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vpX, vpY, vpW, vpH);
      }
    }
  }

  _navigateFromMinimap(cx, cy) {
    const canvas = this._minimapCanvas;
    if (!canvas || !this._svg) return;
    const cw = canvas.width;
    const ch = canvas.height;

    // Recompute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ent of this._entities) {
      if (!this._visibleEntities.has(ent.LogicalName)) continue;
      const pos = this._positions.get(ent.LogicalName);
      const size = this._entitySizes.get(ent.LogicalName);
      if (!pos || !size) continue;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.w);
      maxY = Math.max(maxY, pos.y + size.h);
    }

    if (minX === Infinity) return;

    const pad = 20;
    const totalW = maxX - minX + pad * 2;
    const totalH = maxY - minY + pad * 2;
    const scale = Math.min(cw / totalW, ch / totalH);
    const offX = (cw - totalW * scale) / 2 - minX * scale + pad * scale;
    const offY = (ch - totalH * scale) / 2 - minY * scale + pad * scale;

    // Convert canvas click to diagram coords
    const diagX = (cx - offX) / scale;
    const diagY = (cy - offY) / scale;

    // Center viewport on that point
    const svgRect = this._svg.getBoundingClientRect();
    this._pan = {
      x: -(diagX * this._zoom - svgRect.width / 2),
      y: -(diagY * this._zoom - svgRect.height / 2),
    };
    this._updateTransform();
  }

  // -------------------------------------------------------------------------
  // Export: SVG / PNG
  // -------------------------------------------------------------------------

  /**
   * Build a self-contained SVG string for export.
   * Inlines all CSS rules and resolves custom properties so the SVG
   * renders correctly outside the extension (in viewers or on canvas).
   * @param {{ addBackground: boolean }} opts
   */
  _buildExportSVG({ addBackground = false } = {}) {
    const clone = this._svg.cloneNode(true);
    const rootG = clone.querySelector('#erd-root');
    if (rootG) rootG.removeAttribute('transform');

    const computed = getComputedStyle(document.documentElement);

    // Resolve a var() string to its actual value
    const resolveVar = (str) => str.replace(
      /var\(--([^,)]+)(?:,([^)]+))?\)/g,
      (_, name, fb) => computed.getPropertyValue(`--${name}`).trim() || fb?.trim() || '#888'
    );

    // Collect ALL CSS custom properties used by erd-* rules
    const allVarNames = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          const text = rule.cssText || '';
          for (const m of text.matchAll(/var\(--([\w-]+)/g)) allVarNames.add(`--${m[1]}`);
        }
      } catch { /* cross-origin */ }
    }
    // Also scan the marker elements for var() references
    clone.querySelectorAll('*').forEach(el => {
      for (const attr of el.attributes) {
        for (const m of attr.value.matchAll(/var\(--([\w-]+)/g)) allVarNames.add(`--${m[1]}`);
      }
    });

    // Build :root block with ALL resolved custom property values
    let varBlock = ':root{';
    for (const v of allVarNames) {
      const val = computed.getPropertyValue(v).trim();
      if (val) varBlock += `${v}:${val};`;
    }
    varBlock += '}';

    // Collect erd-* CSS rules
    const rules = [varBlock];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText?.includes('erd-')) rules.push(rule.cssText);
        }
      } catch { /* cross-origin */ }
    }

    // Inject <style> into SVG defs
    const styleEl = document.createElementNS(SVG_NS, 'style');
    styleEl.textContent = rules.join('\n');
    const defs = clone.querySelector('defs') || document.createElementNS(SVG_NS, 'defs');
    defs.appendChild(styleEl);
    if (!clone.querySelector('defs')) clone.insertBefore(defs, clone.firstChild);

    // Resolve var() in all element attributes (markers, inline styles)
    clone.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        if (attr.value.includes('var(')) {
          el.setAttribute(attr.name, resolveVar(attr.value));
        }
      }
    });

    // Set explicit dimensions from content bounding box
    const bbox = this._svg.getBBox?.() || { x: 0, y: 0, width: 800, height: 600 };
    const w = bbox.width + 60;
    const h = bbox.height + 60;
    const vx = bbox.x - 30;
    const vy = bbox.y - 30;
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.setAttribute('viewBox', `${vx} ${vy} ${w} ${h}`);

    // Optional background fill for PNG
    if (addBackground && rootG) {
      const bgRect = document.createElementNS(SVG_NS, 'rect');
      bgRect.setAttribute('x', vx);
      bgRect.setAttribute('y', vy);
      bgRect.setAttribute('width', w);
      bgRect.setAttribute('height', h);
      bgRect.setAttribute('fill', computed.getPropertyValue('--color-bg-base').trim() || '#1e1e1e');
      rootG.insertBefore(bgRect, rootG.firstChild);
    }

    return { svgString: new XMLSerializer().serializeToString(clone), w, h };
  }

  _exportSVG() {
    if (!this._svg) { this._showNotification('No diagram to export', 'warning'); return; }

    const { svgString } = this._buildExportSVG();
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `erd-${this._solutionName || 'diagram'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    this._showNotification('SVG exported', 'success');
  }

  _exportPNG() {
    if (!this._svg) { this._showNotification('No diagram to export', 'warning'); return; }

    const { svgString, w, h } = this._buildExportSVG({ addBackground: true });
    const scale = 2;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) { this._showNotification('PNG export failed', 'error'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `erd-${this._solutionName || 'diagram'}.png`;
        a.click();
        URL.revokeObjectURL(url);
        this._showNotification('PNG exported', 'success');
      }, 'image/png');
    };
    img.onerror = () => this._showNotification('PNG export failed — could not render SVG', 'error');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
  }

  // -------------------------------------------------------------------------
  // Export: Schema / Payload
  // -------------------------------------------------------------------------

  async _exportSchema() {
    const entitiesToExport = this._selectedEntity ? [this._selectedEntity] : this._entities;
    if (!entitiesToExport.length) {
      this._showNotification('No entities loaded', 'warning');
      return;
    }

    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'Dataverse Entities',
      description: `Generated by Dataverse Toolkit on ${new Date().toISOString().slice(0, 10)}`,
      definitions: {},
    };

    const dvTypeToJsonSchema = (dvType) => {
      switch (dvType) {
        case 'Integer': case 'BigInt':
          return { type: 'integer' };
        case 'Decimal': case 'Double': case 'Money':
          return { type: 'number' };
        case 'Boolean':
          return { type: 'boolean' };
        case 'DateTime':
          return { type: 'string', format: 'date-time' };
        case 'Lookup': case 'Owner': case 'Customer':
          return { type: 'string', format: 'uuid', description: 'Lookup GUID value' };
        case 'Uniqueidentifier':
          return { type: 'string', format: 'uuid' };
        case 'Picklist': case 'Status': case 'State':
          return { type: 'integer', description: 'OptionSet integer value' };
        default:
          return { type: 'string' };
      }
    };

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
        const displayLabel = attr.DisplayName?.UserLocalizedLabel?.Label;

        const prop = dvTypeToJsonSchema(type);
        if (displayLabel && displayLabel !== name) prop.title = displayLabel;
        prop['x-dataverse-type'] = type;
        if (attr.IsPrimaryId) prop['x-dataverse-primaryId'] = true;
        if (attr.IsPrimaryName) prop['x-dataverse-primaryName'] = true;
        properties[name] = prop;

        if (attr.RequiredLevel?.Value === 'ApplicationRequired') {
          required.push(name);
        }
      }

      const entDisplayName = ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName;
      schema.definitions[ent.LogicalName] = {
        type: 'object',
        title: entDisplayName,
        description: `EntitySetName: ${ent.EntitySetName}`,
        properties,
        ...(required.length ? { required } : {}),
      };
    }

    await this._copyToClipboard(JSON.stringify(schema, null, 2));
    this._showNotification(`JSON Schema (draft-07) for ${entitiesToExport.length} entity(ies) copied`, 'success');
  }

  async _exportPayload() {
    const ent = this._selectedEntity || this._entities[0];
    if (!ent) { this._showNotification('Select an entity first', 'warning'); return; }

    let attrs = [];
    try { attrs = await this.cache.getAttributes(ent.LogicalName); } catch { /* skip */ }

    const payload = {};
    const optionalPayload = {};
    for (const attr of attrs) {
      if (attr.IsPrimaryId) continue;
      const req = attr.RequiredLevel?.Value;
      const val = JSON.parse(exampleValue(attr.AttributeType));
      if (req === 'ApplicationRequired' || req === 'SystemRequired') {
        payload[attr.LogicalName] = val;
      } else if (req !== 'None' && !attr.IsCustomAttribute) {
        optionalPayload[attr.LogicalName] = val;
      }
    }
    const combined = { ...payload, ...optionalPayload };

    await this._copyToClipboard(JSON.stringify(combined, null, 2));
    this._showNotification(`Example POST payload for ${ent.LogicalName} copied (${Object.keys(payload).length} required + ${Object.keys(optionalPayload).length} optional fields)`, 'success');
  }

  // -------------------------------------------------------------------------
  // Pan / Zoom
  // -------------------------------------------------------------------------

  _setupPanZoom(svg) {
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      // Zoom toward cursor position
      const rect = svg.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      this._zoomAtPoint(this._zoom * factor, cx, cy);
    }, { passive: false });

    svg.addEventListener('pointerdown', (e) => {
      // Only pan if clicking empty space (not an entity)
      if (e.target !== svg && !e.target.classList.contains('erd-arrows') &&
          !e.target.closest?.('.erd-arrows') && !e.target.closest?.('.erd-arrow-group')) {
        return;
      }
      this._isPanning = true;
      this._panStart = { x: e.clientX, y: e.clientY };
      this._panAtStart = { ...this._pan };
      svg.setPointerCapture(e.pointerId);
      svg.style.cursor = 'grabbing';
    });

    svg.addEventListener('pointermove', (e) => {
      if (!this._isPanning) return;
      const dx = e.clientX - this._panStart.x;
      const dy = e.clientY - this._panStart.y;
      this._pan = {
        x: this._panAtStart.x + dx,
        y: this._panAtStart.y + dy,
      };
      this._updateTransform();
    });

    const stopPan = () => {
      this._isPanning = false;
      svg.style.cursor = '';
    };
    svg.addEventListener('pointerup', stopPan);
    svg.addEventListener('pointercancel', stopPan);
  }

  _applyZoom(newZoom) {
    // Zoom toward center of SVG viewport
    if (this._svg) {
      const rect = this._svg.getBoundingClientRect();
      this._zoomAtPoint(newZoom, rect.width / 2, rect.height / 2);
    } else {
      this._zoom = Math.max(0.2, Math.min(3, newZoom));
      this._updateTransform();
    }
  }

  _zoomAtPoint(newZoom, cx, cy) {
    const oldZoom = this._zoom;
    this._zoom = Math.max(0.2, Math.min(3, newZoom));
    // Adjust pan so the diagram point under (cx, cy) stays in place
    this._pan.x = cx - (cx - this._pan.x) * (this._zoom / oldZoom);
    this._pan.y = cy - (cy - this._pan.y) * (this._zoom / oldZoom);
    this._updateTransform();
  }

  _updateTransform() {
    if (this._svgRoot) {
      this._svgRoot.setAttribute('transform',
        `translate(${this._pan.x},${this._pan.y}) scale(${this._zoom})`);
    }
    this._renderMinimap();
  }

  // -------------------------------------------------------------------------
  // Layout persistence (chrome.storage.local)
  // -------------------------------------------------------------------------

  _saveLayout() {
    if (!this._solutionName) return;
    const positions = {};
    for (const [k, v] of this._positions) positions[k] = v;
    const expanded = {};
    for (const [k, v] of this._expanded) expanded[k] = v;

    const data = {
      positions,
      expanded,
      layoutMode: this._layoutMode,
      routingMode: this._routingMode,
      pan: this._pan,
      zoom: this._zoom,
    };

    try {
      chrome.storage?.local?.set({ [`erd_layout_${this._solutionName}`]: data });
    } catch { /* storage unavailable */ }
  }

  async _restoreLayout(solutionName) {
    try {
      const key = `erd_layout_${solutionName}`;
      const result = await new Promise(resolve =>
        chrome.storage?.local?.get(key, resolve) ?? resolve({})
      );
      const data = result?.[key];
      if (!data?.positions) return false;

      // Validate that saved entities still exist
      const currentNames = new Set(this._entities.map(e => e.LogicalName));
      const savedNames = Object.keys(data.positions);
      const validCount = savedNames.filter(n => currentNames.has(n)).length;
      if (validCount < currentNames.size * 0.5) return false; // too stale

      for (const [k, v] of Object.entries(data.positions)) {
        if (currentNames.has(k)) this._positions.set(k, v);
      }
      if (data.expanded) {
        for (const [k, v] of Object.entries(data.expanded)) {
          if (currentNames.has(k)) this._expanded.set(k, v);
        }
      }
      if (data.layoutMode) this._layoutMode = data.layoutMode;
      if (data.routingMode) this._routingMode = data.routingMode;
      if (data.pan) this._pan = data.pan;
      if (data.zoom) this._zoom = data.zoom;

      // Position any new entities not in saved layout
      let maxX = 0, maxY = 0;
      for (const p of this._positions.values()) {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      for (const ent of this._entities) {
        if (!this._positions.has(ent.LogicalName)) {
          maxX += ENTITY_W + H_GAP;
          this._positions.set(ent.LogicalName, { x: maxX, y: 20 });
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Layout transition animation
  // -------------------------------------------------------------------------

  _animateLayoutTransition(oldPositions, newPositions) {
    // Respect reduced motion
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const duration = 300;
    const start = performance.now();
    const entities = this._entities.filter(e =>
      oldPositions.has(e.LogicalName) && newPositions.has(e.LogicalName)
    );

    const animate = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = t * (2 - t); // ease-out quadratic

      for (const ent of entities) {
        const old = oldPositions.get(ent.LogicalName);
        const target = newPositions.get(ent.LogicalName);
        const current = {
          x: old.x + (target.x - old.x) * ease,
          y: old.y + (target.y - old.y) * ease,
        };
        this._positions.set(ent.LogicalName, current);

        const g = this._svgRoot?.querySelector(`.erd-entity[data-name="${ent.LogicalName}"]`);
        if (g) g.setAttribute('transform', `translate(${current.x},${current.y})`);
      }

      // Redraw all arrows
      for (const ent of entities) {
        this._redrawConnectedArrows(ent.LogicalName);
      }
      this._renderMinimap();

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        // Ensure final positions are exact
        for (const ent of entities) {
          this._positions.set(ent.LogicalName, { ...newPositions.get(ent.LogicalName) });
        }
        this._fitViewBox();
        if (this._solutionName) this._saveLayout();
      }
    };

    requestAnimationFrame(animate);
  }

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  _addKeyboardShortcuts() {
    this._keyHandler = (e) => {
      // Only handle if ERD container or children have focus
      if (!this.container.contains(document.activeElement) && document.activeElement !== document.body) return;

      switch (e.key) {
        case '+': case '=':
          e.preventDefault();
          this._applyZoom(this._zoom * 1.2);
          break;
        case '-':
          e.preventDefault();
          this._applyZoom(this._zoom / 1.2);
          break;
        case '0':
          e.preventDefault();
          this._pan = { x: 0, y: 0 };
          this._zoom = 1;
          this._updateTransform();
          break;
        case 'f':
          if (e.ctrlKey || e.metaKey) break; // don't override browser find
          e.preventDefault();
          this._filterInput?.focus();
          break;
        case 'Escape':
          this._filterInput?.blur();
          if (this._selectedEntity) {
            this._selectedEntity = null;
            this._detailPanel.style.display = 'none';
            this._svgRoot?.querySelectorAll('.erd-selected').forEach(el => el.classList.remove('erd-selected'));
          }
          break;
      }
    };
    document.addEventListener('keydown', this._keyHandler);
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
      this._showNotification('Copy failed \u2014 check clipboard permissions', 'error');
    }
  }
}
