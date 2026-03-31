/**
 * Dataverse Toolkit - API Explorer Module
 *
 * The main navigation panel: a tree-view browser for the Dataverse schema.
 * Supports lazy loading, virtual scrolling for large entity lists, keyboard
 * navigation, search/filter, context menus, and a detail panel integration.
 *
 * @module api-explorer
 */

import DetailPanel, { VALUE_TYPES } from './detail-panel.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CSS = 'dvt-tree';
const SESSION_KEY = 'dvt-explorer-expanded';
const VIRTUAL_ROW_HEIGHT = 28;
const VIRTUAL_OVERSCAN = 10;
const DEBOUNCE_MS = 200;

/** Icons for tree nodes */
const ICONS = Object.freeze({
  tables: '\uD83D\uDCCB',       // clipboard
  search: '\uD83D\uDD0D',       // magnifying glass
  columns: '\uD83D\uDCCA',      // bar chart
  relationships: '\uD83D\uDD17', // link
  keys: '\uD83D\uDD11',         // key
  forms: '\uD83D\uDCCB',        // clipboard
  views: '\uD83D\uDC41\uFE0F',  // eye
  actions: '\u26A1',             // lightning
  globalOptionSets: '\uD83C\uDF10', // globe
  functions: '\uD83D\uDCD0',    // triangular ruler
  solutions: '\uD83D\uDD27',    // wrench
  folder: '\uD83D\uDCC1',
  entity: '',
  oneToMany: '\u2192',
  manyToOne: '\u2190',
  manyToMany: '\u2194',
});

/** Column/attribute type labels */
const ATTR_TYPE_LABELS = Object.freeze({
  String: 'Abc',
  Memo: 'Memo',
  Integer: '#',
  BigInt: '#L',
  Double: '#.#',
  Decimal: '#.00',
  Money: '$',
  Boolean: 'T/F',
  Picklist: '\u25BC',
  State: '\u25CB',
  Status: '\u25CF',
  DateTime: '\uD83D\uDCC5',
  Lookup: '\uD83D\uDD17',
  Customer: '\uD83D\uDD17',
  Owner: '\uD83D\uDD17',
  UniqueIdentifier: 'ID',
  Virtual: '\u2026',
  ManagedProperty: '\u2699',
  EntityName: 'E',
  Image: '\uD83D\uDDBC',
  File: '\uD83D\uDCC4',
  MultiSelectPicklist: '\u2611',
});

// ---------------------------------------------------------------------------
// API endpoint helpers
// ---------------------------------------------------------------------------

const API = {
  entityList: () =>
    `EntityDefinitions?$select=LogicalName,DisplayName,SchemaName,EntitySetName,ObjectTypeCode,OwnershipType,PrimaryIdAttribute,PrimaryNameAttribute,IsCustomEntity,IsActivity,Description&$filter=IsPrivate eq false`,

  entityAttributes: (logicalName) =>
    `EntityDefinitions(LogicalName='${logicalName}')/Attributes?$select=LogicalName,SchemaName,AttributeType,DisplayName,RequiredLevel,IsCustomAttribute,IsPrimaryId,IsPrimaryName,Description`,

  oneToMany: (logicalName) =>
    `EntityDefinitions(LogicalName='${logicalName}')/OneToManyRelationships`,

  manyToOne: (logicalName) =>
    `EntityDefinitions(LogicalName='${logicalName}')/ManyToOneRelationships`,

  manyToMany: (logicalName) =>
    `EntityDefinitions(LogicalName='${logicalName}')/ManyToManyRelationships`,

  keys: (logicalName) =>
    `EntityDefinitions(LogicalName='${logicalName}')/Keys`,

  globalOptionSets: () =>
    `GlobalOptionSetDefinitions`,

  solutions: () =>
    `solutions?$select=friendlyname,uniquename,version,ismanaged,description`,

  globalCustomApis: (isFunction) =>
    `customapis?$select=uniquename,displayname,description,isfunction,isboundapi,boundentitylogicalname` +
    `&$filter=isfunction eq ${isFunction} and isboundapi eq false`,

  boundCustomApis: (entityLogicalName) =>
    `customapis?$select=uniquename,displayname,description,isfunction,isboundapi,boundentitylogicalname` +
    `&$filter=isboundapi eq true and boundentitylogicalname eq '${entityLogicalName}'`,

  customApiParams: (uniquename) =>
    `customapirequestparameters?$select=uniquename,name,description,type,isoptional` +
    `&$filter=customapiid/uniquename eq '${uniquename}'`,

  customApiResponse: (uniquename) =>
    `customapiresponseproperties?$select=uniquename,name,description,type` +
    `&$filter=customapiid/uniquename eq '${uniquename}'`,

  solutionComponents: (solutionUniqueName) =>
    `solutioncomponents?$filter=solutionid/uniquename eq '${solutionUniqueName}' and componenttype eq 1&$select=objectid`,
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function displayName(obj) {
  return obj?.DisplayName?.UserLocalizedLabel?.Label || obj?.LogicalName || '';
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Simple fuzzy match: checks if all characters in needle appear in order
 * within haystack (case insensitive).
 * @param {string} haystack
 * @param {string} needle
 * @returns {boolean}
 */
function fuzzyMatch(haystack, needle) {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni], hi);
    if (idx === -1) return false;
    hi = idx + 1;
  }
  return true;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* noop */ }
    document.body.removeChild(ta);
    return ok;
  }
}

// ---------------------------------------------------------------------------
// TreeNode data model
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TreeNode
 * @property {string} id          - Unique node identifier
 * @property {string} label       - Display text
 * @property {string} [sublabel]  - Secondary text (e.g., logical name)
 * @property {string} [icon]      - Prefix icon
 * @property {string} [badge]     - Badge text (e.g., count)
 * @property {string} [badgeClass] - Badge CSS class
 * @property {boolean} expandable - Whether node can be expanded
 * @property {boolean} expanded   - Whether node is currently expanded
 * @property {boolean} loading    - Whether child data is being fetched
 * @property {boolean} loaded     - Whether children have been fetched
 * @property {boolean} error      - Whether last fetch failed
 * @property {string} [errorMsg]  - Error message if failed
 * @property {number} depth       - Nesting depth
 * @property {string} type        - Node type for context menus & actions
 * @property {Object} [data]      - Raw metadata backing this node
 * @property {TreeNode[]} children
 * @property {TreeNode|null} parent
 */

function createNode(props) {
  return {
    id: props.id || '',
    label: props.label || '',
    sublabel: props.sublabel || '',
    icon: props.icon || '',
    badge: props.badge || '',
    badgeClass: props.badgeClass || '',
    expandable: props.expandable ?? false,
    expanded: false,
    loading: false,
    loaded: false,
    error: false,
    errorMsg: '',
    depth: props.depth ?? 0,
    type: props.type || 'generic',
    data: props.data || null,
    children: [],
    parent: props.parent || null,
  };
}

// ---------------------------------------------------------------------------
// ApiExplorer class
// ---------------------------------------------------------------------------

/**
 * The main API Explorer tree-view panel. Provides a navigable schema browser
 * for a connected Dataverse environment.
 */
class ApiExplorer {
  /**
   * @param {HTMLElement} container - The DOM element to render into
   * @param {Object} apiClient - An object with a `request(method, url, options)` method
   *   that sends messages to the background service worker and returns response data.
   */
  constructor(container, apiClient) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {Object} */
    this.apiClient = apiClient;

    /** @type {TreeNode} Root of the tree */
    this._root = null;

    /** @type {Map<string, TreeNode>} Fast lookup by node id */
    this._nodeMap = new Map();

    /** @type {string} Current search filter */
    this._filter = '';

    /** @type {TreeNode[]} Flattened visible rows for virtual scroll */
    this._visibleRows = [];

    /** @type {number} Virtual scroll offset */
    this._scrollTop = 0;

    /** @type {string|null} Currently focused node id */
    this._focusedNodeId = null;

    /** @type {string|null} Currently selected node id */
    this._selectedNodeId = null;

    /** @type {DetailPanel|null} Detail panel instance */
    this._detailPanel = null;

    /** @type {HTMLElement|null} */
    this._treeContainer = null;

    /** @type {HTMLElement|null} */
    this._viewport = null;

    /** @type {HTMLElement|null} */
    this._scrollContent = null;

    /** @type {HTMLElement|null} */
    this._contextMenu = null;

    /** @type {Object|null} Environment info */
    this._env = null;

    /** @type {Set<string>} Remembered expanded node ids */
    this._expandedState = new Set();

    /** @type {Function|null} Callback when "View Records" is requested */
    this.onViewRecords = null;

    /** @type {Function|null} Callback when "Open in Request Builder" is requested */
    this.onOpenRequestBuilder = null;

    /** @type {Function|null} Callback when "Create FetchXML Query" is requested */
    this.onCreateFetchXml = null;

    this._loadExpandedState();
    this._injectStyles();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Render the explorer UI and begin loading the entity list.
   * @param {Object} [env] - Optional environment info { url, orgName, orgId }
   */
  async render(env) {
    this._env = env || null;
    this.container.innerHTML = '';

    // Build layout: tree pane (left) + detail pane (right)
    const layout = document.createElement('div');
    layout.className = `${CSS}-layout`;

    // Tree pane
    const treePane = document.createElement('div');
    treePane.className = `${CSS}-pane`;
    treePane.tabIndex = 0;

    // Search bar
    const searchBar = document.createElement('div');
    searchBar.className = `${CSS}-search-bar`;
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = `${ICONS.search} Search tables, columns\u2026`;
    searchInput.className = `${CSS}-search-input`;
    searchInput.addEventListener('input', debounce((e) => {
      this._filter = e.target.value.trim();
      this._rebuildVisibleRows();
      this._renderVirtualList();
    }, DEBOUNCE_MS));
    searchBar.appendChild(searchInput);
    treePane.appendChild(searchBar);

    // Virtual scroll viewport
    const viewport = document.createElement('div');
    viewport.className = `${CSS}-viewport`;
    viewport.addEventListener('scroll', () => {
      this._scrollTop = viewport.scrollTop;
      this._renderVirtualList();
    });
    this._viewport = viewport;

    const scrollContent = document.createElement('div');
    scrollContent.className = `${CSS}-scroll-content`;
    this._scrollContent = scrollContent;
    viewport.appendChild(scrollContent);
    treePane.appendChild(viewport);

    // Keyboard navigation
    treePane.addEventListener('keydown', (e) => this._handleKeyDown(e));

    this._treeContainer = treePane;
    layout.appendChild(treePane);

    // Detail pane
    const detailPane = document.createElement('div');
    detailPane.className = `${CSS}-detail-pane`;
    this._detailPanel = new DetailPanel(detailPane, {
      title: 'Details',
      showSearch: true,
      collapsible: true,
    });
    this._detailPanel.render();
    layout.appendChild(detailPane);

    this.container.appendChild(layout);

    // Context menu container (appended to body for positioning)
    this._createContextMenu();

    // Build tree root and load data
    await this._initialize();
  }

  /**
   * Refresh the entire tree by reloading entity list.
   */
  async refresh() {
    if (!this._root) return;
    this._root.children = [];
    this._root.loaded = false;
    this._nodeMap.clear();
    this._nodeMap.set(this._root.id, this._root);
    await this._initialize();
  }

  /**
   * Destroy the explorer and clean up.
   */
  destroy() {
    this._saveExpandedState();
    if (this._contextMenu) {
      this._contextMenu.remove();
      this._contextMenu = null;
    }
    if (this._detailPanel) {
      this._detailPanel.destroy();
      this._detailPanel = null;
    }
    this.container.innerHTML = '';
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async _initialize() {
    const orgName = this._env?.orgName || 'Dataverse';

    this._root = createNode({
      id: 'root',
      label: orgName,
      icon: '',
      expandable: true,
      depth: 0,
      type: 'root',
    });
    this._root.expanded = true;
    this._root.loaded = true;
    this._nodeMap.set('root', this._root);

    // Build top-level category nodes
    const tablesNode = createNode({
      id: 'tables',
      label: 'Tables',
      icon: ICONS.tables,
      expandable: true,
      depth: 1,
      type: 'tables-category',
      parent: this._root,
    });

    const globalOptionSetsNode = createNode({
      id: 'global-optionsets',
      label: 'Global Option Sets',
      icon: ICONS.globalOptionSets,
      expandable: true,
      depth: 1,
      type: 'global-optionsets-category',
      parent: this._root,
    });

    const actionsNode = createNode({
      id: 'global-actions',
      label: 'Actions',
      icon: ICONS.actions,
      expandable: true,
      depth: 1,
      type: 'global-actions-category',
      parent: this._root,
    });

    const functionsNode = createNode({
      id: 'global-functions',
      label: 'Functions',
      icon: ICONS.functions,
      expandable: true,
      depth: 1,
      type: 'global-functions-category',
      parent: this._root,
    });

    const solutionsNode = createNode({
      id: 'solutions',
      label: 'Solutions',
      icon: ICONS.solutions,
      expandable: true,
      depth: 1,
      type: 'solutions-category',
      parent: this._root,
    });

    this._root.children = [tablesNode, globalOptionSetsNode, actionsNode, functionsNode, solutionsNode];
    for (const child of this._root.children) {
      this._nodeMap.set(child.id, child);
    }

    // Restore expanded state
    for (const node of this._nodeMap.values()) {
      if (this._expandedState.has(node.id)) {
        node.expanded = true;
      }
    }

    this._rebuildVisibleRows();
    this._renderVirtualList();

    // Auto-load the tables list
    await this._loadChildren(tablesNode);
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  /**
   * Load children for a given node based on its type.
   * @param {TreeNode} node
   */
  async _loadChildren(node) {
    if (node.loaded || node.loading) return;

    node.loading = true;
    node.error = false;
    this._updateNodeInDom(node);

    try {
      switch (node.type) {
        case 'tables-category':
          await this._loadEntities(node);
          break;
        case 'entity':
          this._buildEntitySubtree(node);
          break;
        case 'entity-columns':
          await this._loadAttributes(node);
          break;
        case 'entity-relationships':
          this._buildRelationshipCategories(node);
          break;
        case 'rel-one-to-many':
          await this._loadRelationships(node, 'oneToMany');
          break;
        case 'rel-many-to-one':
          await this._loadRelationships(node, 'manyToOne');
          break;
        case 'rel-many-to-many':
          await this._loadRelationships(node, 'manyToMany');
          break;
        case 'entity-keys':
          await this._loadKeys(node);
          break;
        case 'entity-forms':
        case 'entity-views':
          node.children = [createNode({
            id: `${node.id}-placeholder`,
            label: 'Coming soon\u2026',
            depth: node.depth + 1,
            type: 'placeholder',
            parent: node,
          })];
          this._nodeMap.set(node.children[0].id, node.children[0]);
          break;
        case 'entity-actions':
          await this._loadCustomApis(node, node.data?.entityLogicalName);
          break;
        case 'global-optionsets-category':
          await this._loadGlobalOptionSets(node);
          break;
        case 'solutions-category':
          await this._loadSolutions(node);
          break;
        case 'global-actions-category':
          await this._loadGlobalCustomApis(node, false);
          break;
        case 'global-functions-category':
          await this._loadGlobalCustomApis(node, true);
          break;
        case 'solution':
          await this._loadSolutionEntities(node);
          break;
        case 'customapi':
          this._buildCustomApiSubtree(node);
          break;
        case 'customapi-params':
          await this._loadCustomApiParams(node, false);
          break;
        case 'customapi-response':
          await this._loadCustomApiParams(node, true);
          break;
        default:
          break;
      }

      node.loaded = true;
    } catch (err) {
      node.error = true;
      node.errorMsg = err.message || 'Failed to load';
      node.children = [this._createErrorNode(node, err.message)];
    } finally {
      node.loading = false;
      this._rebuildVisibleRows();
      this._renderVirtualList();
    }
  }

  /**
   * Make an API request through the apiClient.
   * @param {string} url - Relative API URL
   * @returns {Promise<Object>} Response data
   */
  async _apiGet(url) {
    return this.apiClient.request('GET', url);
  }

  /** Load entity definitions into the tables node. */
  async _loadEntities(node) {
    const data = await this._apiGet(API.entityList());
    const entities = data.value || data || [];
    entities.sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));

    node.badge = String(entities.length);

    node.children = entities.map((entity) => {
      const dName = displayName(entity);
      const label = dName && dName !== entity.LogicalName
        ? `${dName} (${entity.LogicalName})`
        : entity.LogicalName;

      const child = createNode({
        id: `entity-${entity.LogicalName}`,
        label,
        sublabel: entity.EntitySetName,
        expandable: true,
        depth: node.depth + 1,
        type: 'entity',
        data: entity,
        parent: node,
      });

      if (entity.IsCustomEntity) child.badgeClass = 'custom';

      // Restore expanded state
      if (this._expandedState.has(child.id)) {
        child.expanded = true;
      }

      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  /** Build the entity sub-tree categories (Columns, Relationships, etc.) */
  _buildEntitySubtree(node) {
    const logicalName = node.data?.LogicalName;
    const depth = node.depth + 1;

    const categories = [
      { id: `${node.id}-columns`, label: 'Columns', icon: ICONS.columns, type: 'entity-columns' },
      { id: `${node.id}-relationships`, label: 'Relationships', icon: ICONS.relationships, type: 'entity-relationships' },
      { id: `${node.id}-keys`, label: 'Keys', icon: ICONS.keys, type: 'entity-keys' },
      { id: `${node.id}-forms`, label: 'Forms', icon: ICONS.forms, type: 'entity-forms' },
      { id: `${node.id}-views`, label: 'Views', icon: ICONS.views, type: 'entity-views' },
      { id: `${node.id}-actions`, label: 'Actions & Functions', icon: ICONS.actions, type: 'entity-actions' },
    ];

    node.children = categories.map((cat) => {
      const child = createNode({
        id: cat.id,
        label: cat.label,
        icon: cat.icon,
        expandable: true,
        depth,
        type: cat.type,
        data: { entityLogicalName: logicalName },
        parent: node,
      });
      if (this._expandedState.has(child.id)) child.expanded = true;
      this._nodeMap.set(child.id, child);
      return child;
    });

    node.loaded = true;
  }

  /** Load attributes for an entity. */
  async _loadAttributes(node) {
    const logicalName = node.data?.entityLogicalName;
    const data = await this._apiGet(API.entityAttributes(logicalName));
    const attrs = data.value || data || [];

    // Sort: PK first, then primary name, then required, then alphabetical
    attrs.sort((a, b) => {
      if (a.IsPrimaryId && !b.IsPrimaryId) return -1;
      if (!a.IsPrimaryId && b.IsPrimaryId) return 1;
      if (a.IsPrimaryName && !b.IsPrimaryName) return -1;
      if (!a.IsPrimaryName && b.IsPrimaryName) return 1;
      const aReq = a.RequiredLevel?.Value === 'ApplicationRequired' || a.RequiredLevel?.Value === 'SystemRequired';
      const bReq = b.RequiredLevel?.Value === 'ApplicationRequired' || b.RequiredLevel?.Value === 'SystemRequired';
      if (aReq && !bReq) return -1;
      if (!aReq && bReq) return 1;
      return (a.LogicalName || '').localeCompare(b.LogicalName || '');
    });

    node.badge = String(attrs.length);

    node.children = attrs.map((attr) => {
      const typeBadge = ATTR_TYPE_LABELS[attr.AttributeType] || attr.AttributeType || '?';
      const tags = [];
      if (attr.IsPrimaryId) tags.push('PK');
      if (attr.IsPrimaryName) tags.push('Name');
      const reqLevel = attr.RequiredLevel?.Value;
      if (reqLevel === 'ApplicationRequired' || reqLevel === 'SystemRequired') tags.push('Required');
      if (attr.IsCustomAttribute) tags.push('Custom');

      const dName = displayName(attr);
      const label = dName && dName !== attr.LogicalName
        ? `${dName} (${attr.LogicalName})`
        : attr.LogicalName;

      const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';

      const child = createNode({
        id: `${node.id}-${attr.LogicalName}`,
        label: `${label}${tagStr}`,
        sublabel: typeBadge,
        depth: node.depth + 1,
        type: 'attribute',
        data: attr,
        parent: node,
      });
      child.badgeClass = attr.IsCustomAttribute ? 'custom' : '';
      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  /** Build relationship sub-categories. */
  _buildRelationshipCategories(node) {
    const logicalName = node.data?.entityLogicalName;
    const depth = node.depth + 1;

    const cats = [
      { id: `${node.id}-1n`, label: 'One-to-Many', icon: ICONS.oneToMany, type: 'rel-one-to-many' },
      { id: `${node.id}-n1`, label: 'Many-to-One', icon: ICONS.manyToOne, type: 'rel-many-to-one' },
      { id: `${node.id}-nn`, label: 'Many-to-Many', icon: ICONS.manyToMany, type: 'rel-many-to-many' },
    ];

    node.children = cats.map((cat) => {
      const child = createNode({
        id: cat.id,
        label: cat.label,
        icon: cat.icon,
        expandable: true,
        depth,
        type: cat.type,
        data: { entityLogicalName: logicalName },
        parent: node,
      });
      if (this._expandedState.has(child.id)) child.expanded = true;
      this._nodeMap.set(child.id, child);
      return child;
    });

    node.loaded = true;
  }

  /** Load relationships of a specific type. */
  async _loadRelationships(node, relType) {
    const logicalName = node.data?.entityLogicalName;
    let url;
    if (relType === 'oneToMany') url = API.oneToMany(logicalName);
    else if (relType === 'manyToOne') url = API.manyToOne(logicalName);
    else url = API.manyToMany(logicalName);

    const data = await this._apiGet(url);
    const rels = data.value || data || [];

    node.badge = String(rels.length);

    node.children = rels.map((rel) => {
      const schemaName = rel.SchemaName || rel.IntersectEntityName || '?';
      let target = '';
      if (relType === 'oneToMany') target = rel.ReferencingEntity || '';
      else if (relType === 'manyToOne') target = rel.ReferencedEntity || '';
      else target = rel.Entity1LogicalName === logicalName ? (rel.Entity2LogicalName || '') : (rel.Entity1LogicalName || '');

      const arrow = relType === 'oneToMany' ? '\u2192' : relType === 'manyToOne' ? '\u2190' : '\u2194';
      const label = target ? `${schemaName} ${arrow} ${target}` : schemaName;

      const child = createNode({
        id: `${node.id}-${schemaName}`,
        label,
        depth: node.depth + 1,
        type: 'relationship',
        data: { ...rel, _relType: relType, _entityLogicalName: logicalName },
        parent: node,
      });
      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  /** Load alternate keys. */
  async _loadKeys(node) {
    const logicalName = node.data?.entityLogicalName;
    const data = await this._apiGet(API.keys(logicalName));
    const keys = data.value || data || [];

    node.badge = String(keys.length);

    if (keys.length === 0) {
      const emptyNode = createNode({
        id: `${node.id}-empty`,
        label: '(no alternate keys)',
        depth: node.depth + 1,
        type: 'placeholder',
        parent: node,
      });
      node.children = [emptyNode];
      this._nodeMap.set(emptyNode.id, emptyNode);
      return;
    }

    node.children = keys.map((key) => {
      const dName = displayName(key) || key.LogicalName || key.SchemaName;
      const cols = (key.KeyAttributes || []).join(', ');
      const label = cols ? `${dName} (${cols})` : dName;

      const child = createNode({
        id: `${node.id}-${key.LogicalName || key.SchemaName}`,
        label,
        depth: node.depth + 1,
        type: 'key',
        data: key,
        parent: node,
      });
      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  /** Load global option sets. */
  async _loadGlobalOptionSets(node) {
    const data = await this._apiGet(API.globalOptionSets());
    const sets = data.value || data || [];

    node.badge = String(sets.length);

    node.children = sets.map((os) => {
      const dName = displayName(os) || os.Name;
      const child = createNode({
        id: `global-os-${os.Name}`,
        label: dName !== os.Name ? `${dName} (${os.Name})` : os.Name,
        depth: node.depth + 1,
        type: 'global-optionset',
        data: os,
        parent: node,
      });
      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  /** Load solutions. */
  async _loadSolutions(node) {
    const data = await this._apiGet(API.solutions());
    const sols = data.value || data || [];
    sols.sort((a, b) => (a.friendlyname || '').localeCompare(b.friendlyname || ''));

    node.badge = String(sols.length);

    node.children = sols.map((sol) => {
      const label = sol.friendlyname || sol.uniquename;
      const version = sol.version ? ` v${sol.version}` : '';
      const managed = sol.ismanaged ? ' [Managed]' : '';

      const child = createNode({
        id: `solution-${sol.uniquename}`,
        label: `${label}${version}${managed}`,
        expandable: true,
        depth: node.depth + 1,
        type: 'solution',
        data: sol,
        parent: node,
      });
      if (this._expandedState.has(child.id)) child.expanded = true;
      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  /** Load entities that belong to a solution. */
  async _loadSolutionEntities(node) {
    const uniqueName = node.data?.uniquename;
    if (!uniqueName) return;

    const compData = await this._apiGet(API.solutionComponents(uniqueName));
    const objectIds = new Set((compData.value || []).map(c => c.objectid).filter(Boolean));

    if (!objectIds.size) {
      const empty = createNode({
        id: `${node.id}-empty`,
        label: '(no entities in this solution)',
        depth: node.depth + 1,
        type: 'placeholder',
        parent: node,
      });
      node.children = [empty];
      this._nodeMap.set(empty.id, empty);
      return;
    }

    // Match objectIds against the entity list (cached in node map from tables category)
    const tablesNode = this._nodeMap.get('tables');
    let allEntities = (tablesNode?.children || [])
      .filter(c => c.type === 'entity')
      .map(c => c.data)
      .filter(Boolean);

    // If tables haven't been loaded yet, fetch minimal entity list
    if (!allEntities.length) {
      const entData = await this._apiGet(
        'EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,MetadataId,IsCustomEntity&$filter=IsPrivate eq false'
      );
      allEntities = entData.value || [];
    }

    const entities = allEntities
      .filter(e => objectIds.has(e.MetadataId))
      .sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));

    node.badge = String(entities.length);

    node.children = entities.map((entity) => {
      const dName = displayName(entity);
      const label = dName && dName !== entity.LogicalName
        ? `${dName} (${entity.LogicalName})`
        : entity.LogicalName;
      const child = createNode({
        id: `${node.id}-entity-${entity.LogicalName}`,
        label,
        sublabel: entity.EntitySetName,
        expandable: true,
        depth: node.depth + 1,
        type: 'entity',
        data: entity,
        parent: node,
      });
      if (entity.IsCustomEntity) child.badgeClass = 'custom';
      if (this._expandedState.has(child.id)) child.expanded = true;
      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  /** Load global custom actions or functions. */
  async _loadGlobalCustomApis(node, isFunction) {
    const data = await this._apiGet(API.globalCustomApis(isFunction));
    const apis = data.value || [];
    apis.sort((a, b) => (a.uniquename || '').localeCompare(b.uniquename || ''));

    node.badge = String(apis.length);

    if (!apis.length) {
      const empty = createNode({
        id: `${node.id}-empty`,
        label: `(no custom ${isFunction ? 'functions' : 'actions'} registered)`,
        depth: node.depth + 1,
        type: 'placeholder',
        parent: node,
      });
      node.children = [empty];
      this._nodeMap.set(empty.id, empty);
      return;
    }

    node.children = this._buildCustomApiNodes(apis, node);
  }

  /** Load entity-bound custom actions and functions. */
  async _loadCustomApis(node, entityLogicalName) {
    if (!entityLogicalName) return;
    const data = await this._apiGet(API.boundCustomApis(entityLogicalName));
    const apis = data.value || [];
    apis.sort((a, b) => (a.uniquename || '').localeCompare(b.uniquename || ''));

    node.badge = String(apis.length);

    if (!apis.length) {
      const empty = createNode({
        id: `${node.id}-empty`,
        label: '(no bound actions/functions)',
        depth: node.depth + 1,
        type: 'placeholder',
        parent: node,
      });
      node.children = [empty];
      this._nodeMap.set(empty.id, empty);
      return;
    }

    node.children = this._buildCustomApiNodes(apis, node);
  }

  /** Build tree nodes for a list of Custom API objects. */
  _buildCustomApiNodes(apis, parentNode) {
    return apis.map((api) => {
      const dName = api.displayname || api.uniquename;
      const isFunction = api.isfunction;
      const isBound = api.isboundapi;
      const boundLabel = isBound ? ` (bound: ${api.boundentitylogicalname || '?'})` : '';

      const child = createNode({
        id: `customapi-${api.uniquename}`,
        label: `${dName || api.uniquename}${boundLabel}`,
        sublabel: api.uniquename,
        expandable: true,
        depth: parentNode.depth + 1,
        type: 'customapi',
        data: api,
        parent: parentNode,
      });
      child.badge = isFunction ? 'fn' : 'action';
      child.badgeClass = isFunction ? '' : 'custom';
      if (this._expandedState.has(child.id)) child.expanded = true;
      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  /** Build parameter/response sub-categories for a Custom API node. */
  _buildCustomApiSubtree(node) {
    const uniquename = node.data?.uniquename;
    const depth = node.depth + 1;

    const cats = [
      { id: `${node.id}-params`, label: 'Request Parameters', icon: ICONS.columns, type: 'customapi-params' },
      { id: `${node.id}-resp`, label: 'Response Properties', icon: ICONS.columns, type: 'customapi-response' },
    ];

    node.children = cats.map((cat) => {
      const child = createNode({
        id: cat.id,
        label: cat.label,
        icon: cat.icon,
        expandable: true,
        depth,
        type: cat.type,
        data: { uniquename },
        parent: node,
      });
      if (this._expandedState.has(child.id)) child.expanded = true;
      this._nodeMap.set(child.id, child);
      return child;
    });

    node.loaded = true;
  }

  /** Load request parameters or response properties for a Custom API. */
  async _loadCustomApiParams(node, isResponse) {
    const uniquename = node.data?.uniquename;
    if (!uniquename) return;

    const url = isResponse ? API.customApiResponse(uniquename) : API.customApiParams(uniquename);
    const data = await this._apiGet(url);
    const params = data.value || [];

    node.badge = String(params.length);

    if (!params.length) {
      const empty = createNode({
        id: `${node.id}-empty`,
        label: `(none)`,
        depth: node.depth + 1,
        type: 'placeholder',
        parent: node,
      });
      node.children = [empty];
      this._nodeMap.set(empty.id, empty);
      return;
    }

    node.children = params.map((p) => {
      const typeLabel = p.type != null ? ` : ${p.type}` : '';
      const optional = p.isoptional ? ' (optional)' : '';
      const child = createNode({
        id: `${node.id}-${p.uniquename || p.name}`,
        label: `${p.name || p.uniquename}${typeLabel}${optional}`,
        sublabel: p.description || '',
        depth: node.depth + 1,
        type: 'customapi-param',
        data: p,
        parent: node,
      });
      this._nodeMap.set(child.id, child);
      return child;
    });
  }

  _createErrorNode(parentNode, message) {
    const errNode = createNode({
      id: `${parentNode.id}-error`,
      label: `Error: ${message || 'Failed to load'}`,
      depth: parentNode.depth + 1,
      type: 'error',
      parent: parentNode,
    });
    errNode.badgeClass = 'error';

    // Add retry child
    const retryNode = createNode({
      id: `${parentNode.id}-retry`,
      label: '\u21BB Retry',
      depth: parentNode.depth + 1,
      type: 'retry',
      data: { targetNodeId: parentNode.id },
      parent: parentNode,
    });

    this._nodeMap.set(errNode.id, errNode);
    this._nodeMap.set(retryNode.id, retryNode);
    return errNode;
  }

  // -------------------------------------------------------------------------
  // Virtual scroll & rendering
  // -------------------------------------------------------------------------

  /** Flatten the tree into visible rows, applying filters. */
  _rebuildVisibleRows() {
    const rows = [];
    const filter = this._filter.toLowerCase();

    const walk = (node) => {
      // Skip root node in display
      if (node.type === 'root') {
        for (const child of node.children) walk(child);
        return;
      }

      // Apply filter: only filter entity-level nodes in the tables category
      if (filter && node.type === 'entity') {
        const matchLabel = fuzzyMatch(node.label, filter);
        const matchLogical = node.data && fuzzyMatch(node.data.LogicalName, filter);
        const matchDisplay = node.data && fuzzyMatch(displayName(node.data), filter);
        const matchEntitySet = node.data && fuzzyMatch(node.data.EntitySetName || '', filter);
        if (!matchLabel && !matchLogical && !matchDisplay && !matchEntitySet) return;
      }

      rows.push(node);

      if (node.expanded && node.children.length > 0) {
        for (const child of node.children) walk(child);
      }
    };

    if (this._root) {
      for (const child of this._root.children) walk(child);
    }

    this._visibleRows = rows;
  }

  /** Render the visible portion of the virtual list. */
  _renderVirtualList() {
    if (!this._viewport || !this._scrollContent) return;

    const totalHeight = this._visibleRows.length * VIRTUAL_ROW_HEIGHT;
    this._scrollContent.style.height = `${totalHeight}px`;

    // Calculate visible range
    const viewportHeight = this._viewport.clientHeight;
    const startIdx = Math.max(0, Math.floor(this._scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const endIdx = Math.min(
      this._visibleRows.length,
      Math.ceil((this._scrollTop + viewportHeight) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN
    );

    // Remove existing rendered rows
    const existing = this._scrollContent.querySelectorAll(`.${CSS}-node`);
    for (const el of existing) el.remove();

    // Render visible rows
    for (let i = startIdx; i < endIdx; i++) {
      const node = this._visibleRows[i];
      const el = this._createNodeElement(node);
      el.style.position = 'absolute';
      el.style.top = `${i * VIRTUAL_ROW_HEIGHT}px`;
      el.style.left = '0';
      el.style.right = '0';
      this._scrollContent.appendChild(el);
    }
  }

  /**
   * Create the DOM element for a single tree node row.
   * @param {TreeNode} node
   * @returns {HTMLElement}
   */
  _createNodeElement(node) {
    const el = document.createElement('div');
    el.className = `${CSS}-node`;
    el.dataset.nodeId = node.id;
    el.style.paddingLeft = `${node.depth * 16 + 4}px`;
    el.style.height = `${VIRTUAL_ROW_HEIGHT}px`;

    if (node.id === this._selectedNodeId) el.classList.add('selected');
    if (node.id === this._focusedNodeId) el.classList.add('focused');
    if (node.error) el.classList.add('error');
    if (node.type === 'error') el.classList.add('error-node');
    if (node.type === 'placeholder') el.classList.add('placeholder-node');

    // Expand/collapse chevron
    const chevron = document.createElement('span');
    chevron.className = `${CSS}-chevron`;
    if (node.expandable) {
      chevron.textContent = node.expanded ? '\u25BE' : '\u25B8';
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleNode(node);
      });
    }
    el.appendChild(chevron);

    // Loading spinner
    if (node.loading) {
      const spinner = document.createElement('span');
      spinner.className = `${CSS}-spinner`;
      el.appendChild(spinner);
    }

    // Icon
    if (node.icon) {
      const icon = document.createElement('span');
      icon.className = `${CSS}-icon`;
      icon.textContent = node.icon;
      el.appendChild(icon);
    }

    // Label
    const label = document.createElement('span');
    label.className = `${CSS}-label`;
    label.textContent = node.label;
    el.appendChild(label);

    // Sublabel (type badge for attributes)
    if (node.sublabel) {
      const sub = document.createElement('span');
      sub.className = `${CSS}-sublabel`;
      sub.textContent = node.sublabel;
      el.appendChild(sub);
    }

    // Badge
    if (node.badge) {
      const badge = document.createElement('span');
      badge.className = `${CSS}-badge ${node.badgeClass || ''}`;
      badge.textContent = node.badge;
      el.appendChild(badge);
    }

    // Click handler
    el.addEventListener('click', () => this._onNodeClick(node));

    // Context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showContextMenu(e, node);
    });

    return el;
  }

  /** Update a single node's representation without full re-render. */
  _updateNodeInDom(node) {
    const el = this._scrollContent?.querySelector(`[data-node-id="${node.id}"]`);
    if (!el) return;
    // Just re-render the virtual list for simplicity with virtual scroll
    this._rebuildVisibleRows();
    this._renderVirtualList();
  }

  // -------------------------------------------------------------------------
  // Interaction handlers
  // -------------------------------------------------------------------------

  /** Handle click on a tree node. */
  async _onNodeClick(node) {
    this._selectedNodeId = node.id;

    // If it's a retry node, re-load the parent
    if (node.type === 'retry') {
      const targetId = node.data?.targetNodeId;
      const target = this._nodeMap.get(targetId);
      if (target) {
        target.loaded = false;
        target.error = false;
        target.children = [];
        await this._loadChildren(target);
      }
      return;
    }

    // Toggle expand on expandable nodes
    if (node.expandable) {
      await this._toggleNode(node);
    }

    // Show details in the detail panel
    this._showNodeDetails(node);

    this._renderVirtualList();
  }

  /** Toggle a node's expanded state and lazy-load if needed. */
  async _toggleNode(node) {
    if (!node.expandable) return;

    node.expanded = !node.expanded;

    if (node.expanded) {
      this._expandedState.add(node.id);
      if (!node.loaded && !node.loading) {
        await this._loadChildren(node);
      }
    } else {
      this._expandedState.delete(node.id);
    }

    this._saveExpandedState();
    this._rebuildVisibleRows();
    this._renderVirtualList();
  }

  /** Show metadata details for the selected node in the detail panel. */
  _showNodeDetails(node) {
    if (!this._detailPanel) return;

    switch (node.type) {
      case 'entity':
        this._showEntityDetails(node.data);
        break;
      case 'attribute':
        this._showAttributeDetails(node.data);
        break;
      case 'relationship':
        this._showRelationshipDetails(node.data);
        break;
      case 'key':
        this._showKeyDetails(node.data);
        break;
      case 'global-optionset':
        this._showOptionSetDetails(node.data);
        break;
      case 'solution':
        this._showSolutionDetails(node.data);
        break;
      case 'customapi':
        this._showCustomApiDetails(node.data);
        break;
      default:
        this._detailPanel.clear();
        break;
    }
  }

  /** Build detail panel for a Custom API node. */
  _showCustomApiDetails(api) {
    if (!api) return;
    const typeLabel = api.isfunction ? 'Function' : 'Action';
    const bindLabel = api.isboundapi ? `Bound (${api.boundentitylogicalname || '?'})` : 'Unbound';
    this._detailPanel.setData({
      title: api.displayname || api.uniquename,
      raw: api,
      sections: [{
        title: `Custom API \u2014 ${typeLabel}`,
        entries: [
          { key: 'uniquename', value: api.uniquename, label: 'Unique Name' },
          { key: 'displayname', value: api.displayname, label: 'Display Name' },
          { key: 'isfunction', value: typeLabel, label: 'Type' },
          { key: 'binding', value: bindLabel, label: 'Binding' },
          { key: 'description', value: api.description || '(none)', label: 'Description' },
        ],
      }],
    });
  }

  /** Build detail panel data for an entity. */
  _showEntityDetails(entity) {
    if (!entity) return;
    this._detailPanel.setData({
      title: displayName(entity) || entity.LogicalName,
      raw: entity,
      sections: [
        {
          title: 'General',
          entries: [
            { key: 'LogicalName', value: entity.LogicalName, label: 'Logical Name' },
            { key: 'SchemaName', value: entity.SchemaName, label: 'Schema Name' },
            { key: 'EntitySetName', value: entity.EntitySetName, label: 'Entity Set Name' },
            { key: 'DisplayName', value: displayName(entity), label: 'Display Name' },
            { key: 'ObjectTypeCode', value: entity.ObjectTypeCode, label: 'Object Type Code', type: VALUE_TYPES.NUMBER },
          ],
        },
        {
          title: 'Ownership & Type',
          entries: [
            { key: 'OwnershipType', value: entity.OwnershipType, label: 'Ownership Type' },
            { key: 'IsCustomEntity', value: entity.IsCustomEntity, label: 'Is Custom Entity', type: VALUE_TYPES.BOOLEAN },
            { key: 'IsActivity', value: entity.IsActivity, label: 'Is Activity', type: VALUE_TYPES.BOOLEAN },
          ],
        },
        {
          title: 'Primary Fields',
          entries: [
            { key: 'PrimaryIdAttribute', value: entity.PrimaryIdAttribute, label: 'Primary ID Attribute' },
            { key: 'PrimaryNameAttribute', value: entity.PrimaryNameAttribute, label: 'Primary Name Attribute' },
          ],
        },
        {
          title: 'Description',
          collapsed: true,
          entries: [
            { key: 'Description', value: entity.Description?.UserLocalizedLabel?.Label || '(none)', label: 'Description' },
          ],
        },
      ],
    });
  }

  /** Build detail panel data for an attribute. */
  _showAttributeDetails(attr) {
    if (!attr) return;
    const entries = [
      { key: 'LogicalName', value: attr.LogicalName, label: 'Logical Name' },
      { key: 'SchemaName', value: attr.SchemaName, label: 'Schema Name' },
      { key: 'DisplayName', value: displayName(attr), label: 'Display Name' },
      { key: 'AttributeType', value: attr.AttributeType, label: 'Attribute Type' },
      { key: 'RequiredLevel', value: attr.RequiredLevel?.Value, label: 'Required Level' },
      { key: 'IsPrimaryId', value: attr.IsPrimaryId, label: 'Is Primary ID', type: VALUE_TYPES.BOOLEAN },
      { key: 'IsPrimaryName', value: attr.IsPrimaryName, label: 'Is Primary Name', type: VALUE_TYPES.BOOLEAN },
      { key: 'IsCustomAttribute', value: attr.IsCustomAttribute, label: 'Is Custom', type: VALUE_TYPES.BOOLEAN, isCustom: attr.IsCustomAttribute },
    ];

    // Type-specific properties
    if (attr.MaxLength != null) entries.push({ key: 'MaxLength', value: attr.MaxLength, label: 'Max Length', type: VALUE_TYPES.NUMBER });
    if (attr.MinValue != null) entries.push({ key: 'MinValue', value: attr.MinValue, label: 'Min Value', type: VALUE_TYPES.NUMBER });
    if (attr.MaxValue != null) entries.push({ key: 'MaxValue', value: attr.MaxValue, label: 'Max Value', type: VALUE_TYPES.NUMBER });
    if (attr.Precision != null) entries.push({ key: 'Precision', value: attr.Precision, label: 'Precision', type: VALUE_TYPES.NUMBER });
    if (attr.Format) entries.push({ key: 'Format', value: attr.Format, label: 'Format' });

    const descEntries = [
      { key: 'Description', value: attr.Description?.UserLocalizedLabel?.Label || '(none)', label: 'Description' },
    ];

    this._detailPanel.setData({
      title: displayName(attr) || attr.LogicalName,
      raw: attr,
      sections: [
        { title: 'Properties', entries },
        { title: 'Description', collapsed: true, entries: descEntries },
      ],
    });
  }

  /** Build detail panel data for a relationship. */
  _showRelationshipDetails(rel) {
    if (!rel) return;
    const relType = rel._relType;
    const entries = [
      { key: 'SchemaName', value: rel.SchemaName, label: 'Schema Name' },
      { key: 'RelationshipType', value: relType === 'manyToMany' ? 'Many-to-Many' : relType === 'oneToMany' ? 'One-to-Many' : 'Many-to-One', label: 'Type' },
    ];

    if (relType === 'oneToMany' || relType === 'manyToOne') {
      entries.push(
        { key: 'ReferencingEntity', value: rel.ReferencingEntity, label: 'Referencing Entity' },
        { key: 'ReferencedEntity', value: rel.ReferencedEntity, label: 'Referenced Entity' },
        { key: 'ReferencingAttribute', value: rel.ReferencingAttribute, label: 'Referencing Attribute' },
        { key: 'ReferencedAttribute', value: rel.ReferencedAttribute, label: 'Referenced Attribute' },
      );
    } else {
      entries.push(
        { key: 'Entity1LogicalName', value: rel.Entity1LogicalName, label: 'Entity 1' },
        { key: 'Entity2LogicalName', value: rel.Entity2LogicalName, label: 'Entity 2' },
        { key: 'IntersectEntityName', value: rel.IntersectEntityName, label: 'Intersect Entity' },
      );
    }

    // Cascade config
    const cascadeEntries = [];
    if (rel.CascadeConfiguration) {
      const cc = rel.CascadeConfiguration;
      for (const [k, v] of Object.entries(cc)) {
        cascadeEntries.push({ key: k, value: v, label: k });
      }
    }

    const sections = [{ title: 'Relationship', entries }];
    if (cascadeEntries.length > 0) {
      sections.push({ title: 'Cascade Configuration', collapsed: true, entries: cascadeEntries });
    }

    this._detailPanel.setData({ title: rel.SchemaName, raw: rel, sections });
  }

  _showKeyDetails(key) {
    if (!key) return;
    this._detailPanel.setData({
      title: displayName(key) || key.SchemaName,
      raw: key,
      sections: [{
        title: 'Alternate Key',
        entries: [
          { key: 'LogicalName', value: key.LogicalName, label: 'Logical Name' },
          { key: 'SchemaName', value: key.SchemaName, label: 'Schema Name' },
          { key: 'DisplayName', value: displayName(key), label: 'Display Name' },
          { key: 'KeyAttributes', value: key.KeyAttributes, label: 'Key Attributes', type: VALUE_TYPES.ARRAY },
        ],
      }],
    });
  }

  _showOptionSetDetails(os) {
    if (!os) return;
    const options = os.Options || [];
    const optEntries = options.map((opt) => ({
      key: String(opt.Value),
      value: opt.Label?.UserLocalizedLabel?.Label || String(opt.Value),
      label: `${opt.Value}`,
    }));

    this._detailPanel.setData({
      title: displayName(os) || os.Name,
      raw: os,
      sections: [
        {
          title: 'Option Set',
          entries: [
            { key: 'Name', value: os.Name, label: 'Name' },
            { key: 'DisplayName', value: displayName(os), label: 'Display Name' },
            { key: 'OptionSetType', value: os.OptionSetType, label: 'Type' },
            { key: 'IsGlobal', value: os.IsGlobal, label: 'Is Global', type: VALUE_TYPES.BOOLEAN },
          ],
        },
        {
          title: `Values (${options.length})`,
          entries: optEntries,
        },
      ],
    });
  }

  _showSolutionDetails(sol) {
    if (!sol) return;
    this._detailPanel.setData({
      title: sol.friendlyname || sol.uniquename,
      raw: sol,
      sections: [{
        title: 'Solution',
        entries: [
          { key: 'friendlyname', value: sol.friendlyname, label: 'Friendly Name' },
          { key: 'uniquename', value: sol.uniquename, label: 'Unique Name' },
          { key: 'version', value: sol.version, label: 'Version' },
          { key: 'ismanaged', value: sol.ismanaged, label: 'Is Managed', type: VALUE_TYPES.BOOLEAN },
          { key: 'description', value: sol.description || '(none)', label: 'Description' },
        ],
      }],
    });
  }

  // -------------------------------------------------------------------------
  // Context menu
  // -------------------------------------------------------------------------

  _createContextMenu() {
    if (this._contextMenu) this._contextMenu.remove();

    const menu = document.createElement('div');
    menu.className = `${CSS}-context-menu`;
    menu.style.display = 'none';
    document.body.appendChild(menu);
    this._contextMenu = menu;

    // Close on click outside
    document.addEventListener('click', () => {
      menu.style.display = 'none';
    });
  }

  /**
   * Show the context menu for a node.
   * @param {MouseEvent} event
   * @param {TreeNode} node
   */
  _showContextMenu(event, node) {
    const menu = this._contextMenu;
    if (!menu) return;

    menu.innerHTML = '';
    const items = this._getContextMenuItems(node);
    if (items.length === 0) return;

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = `${CSS}-ctx-separator`;
        menu.appendChild(sep);
        continue;
      }

      const el = document.createElement('div');
      el.className = `${CSS}-ctx-item`;
      el.textContent = item.label;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = 'none';
        item.action();
      });
      menu.appendChild(el);
    }

    // Position
    menu.style.display = 'block';
    const menuRect = menu.getBoundingClientRect();
    let x = event.clientX;
    let y = event.clientY;
    if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 4;
    if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 4;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  /**
   * Build context menu items for a node type.
   * @param {TreeNode} node
   * @returns {Array<{label: string, action: Function} | {separator: true}>}
   */
  _getContextMenuItems(node) {
    const items = [];

    if (node.type === 'entity') {
      const entity = node.data;
      items.push(
        {
          label: 'Open in Request Builder',
          action: () => {
            if (this.onOpenRequestBuilder) this.onOpenRequestBuilder(entity);
          },
        },
        {
          label: 'Create FetchXML Query',
          action: () => {
            if (this.onCreateFetchXml) this.onCreateFetchXml(entity);
          },
        },
        {
          label: 'View Records',
          action: () => {
            if (this.onViewRecords) this.onViewRecords(entity);
          },
        },
        { separator: true },
        {
          label: 'Copy Logical Name',
          action: () => copyToClipboard(entity.LogicalName),
        },
        {
          label: 'Copy Entity Set Name',
          action: () => copyToClipboard(entity.EntitySetName),
        },
        {
          label: 'Copy Schema Name',
          action: () => copyToClipboard(entity.SchemaName),
        },
      );
    } else if (node.type === 'attribute') {
      const attr = node.data;
      items.push(
        {
          label: 'Copy Logical Name',
          action: () => copyToClipboard(attr.LogicalName),
        },
        {
          label: 'Copy Schema Name',
          action: () => copyToClipboard(attr.SchemaName),
        },
        { separator: true },
        {
          label: 'Add to Select',
          action: () => {
            // Dispatch a custom event that the request builder can listen for
            this.container.dispatchEvent(new CustomEvent('dvt-add-select', {
              bubbles: true,
              detail: { attribute: attr.LogicalName },
            }));
          },
        },
        {
          label: 'Filter by this column',
          action: () => {
            this.container.dispatchEvent(new CustomEvent('dvt-add-filter', {
              bubbles: true,
              detail: { attribute: attr.LogicalName, type: attr.AttributeType },
            }));
          },
        },
      );
    } else if (node.type === 'relationship') {
      const rel = node.data;
      const targetEntity = rel._relType === 'oneToMany' ? rel.ReferencingEntity
        : rel._relType === 'manyToOne' ? rel.ReferencedEntity
        : null;

      items.push({
        label: 'Copy Schema Name',
        action: () => copyToClipboard(rel.SchemaName),
      });

      if (targetEntity) {
        items.push({
          label: `Navigate to ${targetEntity}`,
          action: () => this._navigateToEntity(targetEntity),
        });
      }
    }

    return items;
  }

  /**
   * Navigate to and expand a specific entity node.
   * @param {string} logicalName
   */
  async _navigateToEntity(logicalName) {
    const nodeId = `entity-${logicalName}`;
    const node = this._nodeMap.get(nodeId);
    if (!node) return;

    // Ensure parent tables node is expanded
    const tablesNode = this._nodeMap.get('tables');
    if (tablesNode && !tablesNode.expanded) {
      tablesNode.expanded = true;
      this._expandedState.add(tablesNode.id);
    }

    // Select and scroll to the entity
    this._selectedNodeId = node.id;
    this._showNodeDetails(node);
    this._rebuildVisibleRows();

    // Find the row index and scroll to it
    const idx = this._visibleRows.indexOf(node);
    if (idx >= 0 && this._viewport) {
      this._viewport.scrollTop = idx * VIRTUAL_ROW_HEIGHT;
    }

    this._renderVirtualList();
  }

  // -------------------------------------------------------------------------
  // Keyboard navigation
  // -------------------------------------------------------------------------

  /**
   * Handle keyboard events for tree navigation.
   * @param {KeyboardEvent} e
   */
  _handleKeyDown(e) {
    if (!this._visibleRows.length) return;

    const focusedIdx = this._focusedNodeId
      ? this._visibleRows.findIndex((n) => n.id === this._focusedNodeId)
      : -1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = Math.min(focusedIdx + 1, this._visibleRows.length - 1);
        this._focusedNodeId = this._visibleRows[next]?.id || null;
        this._ensureVisible(next);
        this._renderVirtualList();
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        const prev = Math.max(focusedIdx - 1, 0);
        this._focusedNodeId = this._visibleRows[prev]?.id || null;
        this._ensureVisible(prev);
        this._renderVirtualList();
        break;
      }

      case 'ArrowRight': {
        e.preventDefault();
        if (focusedIdx >= 0) {
          const node = this._visibleRows[focusedIdx];
          if (node.expandable && !node.expanded) {
            this._toggleNode(node);
          }
        }
        break;
      }

      case 'ArrowLeft': {
        e.preventDefault();
        if (focusedIdx >= 0) {
          const node = this._visibleRows[focusedIdx];
          if (node.expandable && node.expanded) {
            this._toggleNode(node);
          } else if (node.parent && node.parent.type !== 'root') {
            // Move focus to parent
            this._focusedNodeId = node.parent.id;
            const parentIdx = this._visibleRows.indexOf(node.parent);
            this._ensureVisible(parentIdx);
            this._renderVirtualList();
          }
        }
        break;
      }

      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (focusedIdx >= 0) {
          this._onNodeClick(this._visibleRows[focusedIdx]);
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * Ensure a row at the given index is visible in the viewport.
   * @param {number} idx
   */
  _ensureVisible(idx) {
    if (!this._viewport || idx < 0) return;
    const top = idx * VIRTUAL_ROW_HEIGHT;
    const bottom = top + VIRTUAL_ROW_HEIGHT;
    const vTop = this._viewport.scrollTop;
    const vBottom = vTop + this._viewport.clientHeight;

    if (top < vTop) {
      this._viewport.scrollTop = top;
    } else if (bottom > vBottom) {
      this._viewport.scrollTop = bottom - this._viewport.clientHeight;
    }
  }

  // -------------------------------------------------------------------------
  // State persistence
  // -------------------------------------------------------------------------

  _loadExpandedState() {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        this._expandedState = new Set(JSON.parse(stored));
      }
    } catch {
      this._expandedState = new Set();
    }
  }

  _saveExpandedState() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...this._expandedState]));
    } catch {
      // sessionStorage may be unavailable
    }
  }

  // -------------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById(`${CSS}-styles`)) return;

    const style = document.createElement('style');
    style.id = `${CSS}-styles`;
    style.textContent = `
      .${CSS}-layout {
        display: flex;
        height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: var(--dvt-text, #1e1e1e);
        background: var(--dvt-bg, #ffffff);
      }
      .${CSS}-pane {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--dvt-border, #e0e0e0);
        outline: none;
      }
      .${CSS}-detail-pane {
        width: 320px;
        min-width: 200px;
        flex-shrink: 0;
        overflow: hidden;
      }

      /* Search bar */
      .${CSS}-search-bar {
        padding: 6px 8px;
        border-bottom: 1px solid var(--dvt-border, #e0e0e0);
        flex-shrink: 0;
      }
      .${CSS}-search-input {
        width: 100%;
        padding: 5px 8px;
        border: 1px solid var(--dvt-border, #d0d0d0);
        border-radius: 4px;
        font-size: 12px;
        outline: none;
        background: var(--dvt-input-bg, #f9f9f9);
        color: inherit;
        box-sizing: border-box;
      }
      .${CSS}-search-input:focus {
        border-color: var(--dvt-accent, #0078d4);
        box-shadow: 0 0 0 1px var(--dvt-accent, #0078d4);
      }

      /* Virtual scroll viewport */
      .${CSS}-viewport {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
      }
      .${CSS}-scroll-content {
        position: relative;
        width: 100%;
      }

      /* Tree node */
      .${CSS}-node {
        display: flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        user-select: none;
        border-bottom: 1px solid transparent;
        box-sizing: border-box;
        padding-right: 8px;
      }
      .${CSS}-node:hover {
        background: var(--dvt-hover, #f0f6ff);
      }
      .${CSS}-node.selected {
        background: var(--dvt-selected, #e1efff);
        border-bottom-color: var(--dvt-accent, #0078d4);
      }
      .${CSS}-node.focused {
        outline: 1px solid var(--dvt-accent, #0078d4);
        outline-offset: -1px;
      }
      .${CSS}-node.error-node {
        color: #c62828;
      }
      .${CSS}-node.placeholder-node {
        color: var(--dvt-muted, #999);
        font-style: italic;
      }

      .${CSS}-chevron {
        width: 14px;
        flex-shrink: 0;
        text-align: center;
        font-size: 10px;
        color: var(--dvt-muted, #888);
      }
      .${CSS}-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid var(--dvt-border, #d0d0d0);
        border-top-color: var(--dvt-accent, #0078d4);
        border-radius: 50%;
        animation: ${CSS}-spin 0.6s linear infinite;
        flex-shrink: 0;
      }
      @keyframes ${CSS}-spin {
        to { transform: rotate(360deg); }
      }
      .${CSS}-icon {
        flex-shrink: 0;
        font-size: 12px;
        width: 16px;
        text-align: center;
      }
      .${CSS}-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .${CSS}-sublabel {
        flex-shrink: 0;
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 3px;
        background: var(--dvt-badge-bg, #e8e8e8);
        color: var(--dvt-badge-color, #555);
        font-weight: 600;
        font-family: 'Cascadia Code', Consolas, monospace;
      }
      .${CSS}-badge {
        flex-shrink: 0;
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--dvt-badge-bg, #e0e0e0);
        color: var(--dvt-badge-color, #555);
        font-weight: 600;
      }
      .${CSS}-badge.custom {
        background: #f3e5f5;
        color: #6a1b9a;
      }
      .${CSS}-badge.error {
        background: #fce4ec;
        color: #c62828;
      }

      /* Context menu */
      .${CSS}-context-menu {
        position: fixed;
        z-index: 10000;
        min-width: 180px;
        background: var(--dvt-bg, #ffffff);
        border: 1px solid var(--dvt-border, #d0d0d0);
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        padding: 4px 0;
        font-size: 12px;
      }
      .${CSS}-ctx-item {
        padding: 6px 14px;
        cursor: pointer;
        white-space: nowrap;
      }
      .${CSS}-ctx-item:hover {
        background: var(--dvt-hover, #f0f6ff);
      }
      .${CSS}-ctx-separator {
        height: 1px;
        background: var(--dvt-border, #e0e0e0);
        margin: 4px 0;
      }
    `;
    document.head.appendChild(style);
  }
}

export { ApiExplorer };
export default ApiExplorer;
