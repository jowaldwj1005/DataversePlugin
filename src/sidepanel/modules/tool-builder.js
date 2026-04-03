/**
 * Agent Tool Builder — generate JSON Schema tool definitions from Dataverse entities.
 *
 * Card-based UX (similar to Query Builder):
 *  - Pick a root entity → columns become tool input properties
 *  - Add 1:N children via relationship picker → nested arrays for deep insert
 *  - Output: Tool Definition (Claude/OpenAI), Deep Insert payload, API info
 *
 * @module ToolBuilder
 */

const CSS = 'tb';

// ---------------------------------------------------------------------------
// Dataverse → JSON Schema type mapping
// ---------------------------------------------------------------------------

const TYPE_MAP = {
  String:             { type: 'string' },
  Memo:               { type: 'string' },
  Integer:            { type: 'integer' },
  BigInt:             { type: 'integer' },
  Decimal:            { type: 'number' },
  Double:             { type: 'number' },
  Money:              { type: 'number' },
  Boolean:            { type: 'boolean' },
  DateTime:           { type: 'string', format: 'date-time' },
  Uniqueidentifier:   { type: 'string', format: 'uuid' },
  Lookup:             { type: 'string', format: 'uuid' },
  Owner:              { type: 'string', format: 'uuid' },
  Customer:           { type: 'string', format: 'uuid' },
  Picklist:           { type: 'integer' },
  State:              { type: 'integer' },
  Status:             { type: 'integer' },
  MultiSelectPicklist:{ type: 'string' },
  EntityName:         { type: 'string' },
  Image:              { type: 'string', contentEncoding: 'base64' },
  File:               { type: 'string', contentEncoding: 'base64' },
};

const SKIP_TYPES = new Set(['Virtual', 'CalendarRules', 'ManagedProperty', 'EntityName']);
const SKIP_FIELDS = new Set(['versionnumber', 'modifiedon', 'createdon', 'modifiedby', 'createdby',
  'owninguser', 'owningteam', 'owningbusinessunit', 'overriddencreatedon', 'importsequencenumber',
  'timezoneruleversionnumber', 'utcconversiontimezonecode']);

function uid() { return Math.random().toString(36).slice(2, 8); }

// ---------------------------------------------------------------------------
// ToolBuilder module
// ---------------------------------------------------------------------------

export default class ToolBuilder {
  constructor(container, apiClient, metadataCache) {
    this.container = container;
    this.api = apiClient;
    this.cache = metadataCache;

    this._entities = [];
    this._attrCache = new Map();   // entityName → attrs[]
    this._optSetCache = new Map(); // entity:attr → options[]
    this._relCache = new Map();    // entityName → relationships

    // Model
    this._model = null; // { entity, entitySetName, displayName, primaryId, primaryName, attributes[], children[] }
    this._outputMode = 'tool'; // 'tool' | 'deepinsert' | 'api'
    this._toolFormat = 'claude'; // 'claude' | 'openai' | 'mcp'
    this._crudMode = 'create'; // 'create' | 'update' | 'read'

    // DOM refs
    this._canvas = null;
    this._outputPanel = null;
    this._outputPre = null;
  }

  async render() {
    this.container.innerHTML = '';
    this.container.classList.add(`${CSS}-container`);
    this._injectStyles();

    const loading = document.createElement('div');
    loading.className = `${CSS}-loading`;
    loading.textContent = 'Loading entities\u2026';
    this.container.appendChild(loading);

    await this._loadEntities();
    loading.remove();
    this._buildLayout();
  }

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  async _loadEntities() {
    if (this._entities.length) return;
    try {
      const raw = await this.cache.getEntities();
      this._entities = raw
        .filter(e => !e.IsPrivate)
        .sort((a, b) => (a.DisplayName?.UserLocalizedLabel?.Label || a.LogicalName)
          .localeCompare(b.DisplayName?.UserLocalizedLabel?.Label || b.LogicalName));
    } catch { this._entities = []; }
  }

  async _loadAttributes(entityName) {
    if (this._attrCache.has(entityName)) return this._attrCache.get(entityName);
    try {
      const attrs = await this.cache.getAttributes(entityName);
      this._attrCache.set(entityName, attrs);
      return attrs;
    } catch {
      this._attrCache.set(entityName, []);
      return [];
    }
  }

  async _loadRelationships(entityName) {
    if (this._relCache.has(entityName)) return this._relCache.get(entityName);
    try {
      const rels = await this.cache.getRelationships(entityName);
      this._relCache.set(entityName, rels);
      return rels;
    } catch {
      this._relCache.set(entityName, { ManyToOne: [], OneToMany: [], ManyToMany: [] });
      return this._relCache.get(entityName);
    }
  }

  async _loadOptionSet(entityName, attrName) {
    const key = `${entityName}:${attrName}`;
    if (this._optSetCache.has(key)) return this._optSetCache.get(key);
    try {
      const opts = await this.cache.getOptionSet(entityName, attrName);
      this._optSetCache.set(key, opts || []);
      return opts || [];
    } catch {
      this._optSetCache.set(key, []);
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Layout
  // -----------------------------------------------------------------------

  _buildLayout() {
    this.container.innerHTML = '';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = `${CSS}-toolbar`;
    toolbar.appendChild(this._buildEntityPicker());

    // CRUD mode toggle
    const crudToggle = document.createElement('div');
    crudToggle.className = `${CSS}-crud-toggle`;
    for (const mode of ['create', 'update', 'read']) {
      const btn = document.createElement('button');
      btn.className = `${CSS}-crud-btn ${this._crudMode === mode ? `${CSS}-crud-active` : ''}`;
      btn.textContent = mode === 'create' ? 'Create' : mode === 'update' ? 'Update' : 'Read';
      btn.addEventListener('click', () => {
        this._crudMode = mode;
        crudToggle.querySelectorAll(`.${CSS}-crud-btn`).forEach(b => b.classList.remove(`${CSS}-crud-active`));
        btn.classList.add(`${CSS}-crud-active`);
        this._syncOutput();
      });
      crudToggle.appendChild(btn);
    }
    toolbar.appendChild(crudToggle);
    this.container.appendChild(toolbar);

    // Canvas (entity cards)
    this._canvas = document.createElement('div');
    this._canvas.className = `${CSS}-canvas`;
    this.container.appendChild(this._canvas);

    // Output panel
    this._outputPanel = document.createElement('div');
    this._outputPanel.className = `${CSS}-output`;
    this.container.appendChild(this._outputPanel);
    this._buildOutputPanel();

    // Initial render
    if (this._model) {
      this._renderCards();
      this._syncOutput();
    } else {
      this._canvas.innerHTML = `<div class="${CSS}-hint">Select an entity above to start building a tool definition.</div>`;
    }
  }

  // -----------------------------------------------------------------------
  // Entity picker
  // -----------------------------------------------------------------------

  _buildEntityPicker() {
    const wrap = document.createElement('div');
    wrap.className = `${CSS}-entity-picker`;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search entity\u2026';
    input.className = `${CSS}-entity-input`;
    if (this._model) {
      const dn = this._model.displayName || this._model.entity;
      input.value = `${dn} (${this._model.entity})`;
    }

    const list = document.createElement('div');
    list.className = `${CSS}-entity-list`;
    list.style.display = 'none';

    const renderList = (filter) => {
      list.innerHTML = '';
      const f = (filter || '').toLowerCase();
      const filtered = this._entities.filter(e => {
        const dn = e.DisplayName?.UserLocalizedLabel?.Label || '';
        return e.LogicalName.includes(f) || dn.toLowerCase().includes(f);
      }).slice(0, 80);
      for (const ent of filtered) {
        const item = document.createElement('div');
        item.className = `${CSS}-entity-option`;
        const dn = ent.DisplayName?.UserLocalizedLabel?.Label;
        item.textContent = dn ? `${dn} (${ent.LogicalName})` : ent.LogicalName;
        item.addEventListener('click', () => {
          list.style.display = 'none';
          input.value = item.textContent;
          this._selectEntity(ent);
        });
        list.appendChild(item);
      }
      list.style.display = filtered.length ? '' : 'none';
    };

    input.addEventListener('focus', () => renderList(input.value));
    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('blur', () => setTimeout(() => list.style.display = 'none', 200));

    wrap.append(input, list);
    return wrap;
  }

  async _selectEntity(ent) {
    const attrs = await this._loadAttributes(ent.LogicalName);

    // Pre-select writable, non-system fields
    const writable = attrs.filter(a =>
      !SKIP_TYPES.has(a.AttributeType) &&
      !SKIP_FIELDS.has(a.LogicalName) &&
      !a.IsLogical &&
      !a.AttributeOf &&
      a.LogicalName !== ent.PrimaryIdAttribute &&
      a.IsValidForCreate !== false
    );

    // Auto-select required + primary name
    const selected = writable.filter(a =>
      a.RequiredLevel?.Value === 'ApplicationRequired' ||
      a.RequiredLevel?.Value === 'SystemRequired' ||
      a.LogicalName === ent.PrimaryNameAttribute
    );

    this._model = {
      entity: ent.LogicalName,
      entitySetName: ent.EntitySetName || ent.LogicalName + 's',
      displayName: ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName,
      primaryIdAttribute: ent.PrimaryIdAttribute,
      primaryNameAttribute: ent.PrimaryNameAttribute,
      attributes: selected.map(a => a.LogicalName),
      allWritable: writable.map(a => a.LogicalName),
      children: [],
    };

    this._renderCards();
    this._syncOutput();
  }

  // -----------------------------------------------------------------------
  // Card rendering
  // -----------------------------------------------------------------------

  _renderCards() {
    this._canvas.innerHTML = '';
    if (!this._model) return;

    // Root card
    this._canvas.appendChild(this._renderEntityCard(this._model, true));

    // Child cards
    for (const child of this._model.children) {
      this._canvas.appendChild(this._renderEntityCard(child, false));
    }

    // Add child card
    const addCard = document.createElement('div');
    addCard.className = `${CSS}-card ${CSS}-card-add`;
    addCard.innerHTML = `<div class="${CSS}-add-inner">\u2795<br>Add Child<br>Entity</div>`;
    addCard.addEventListener('click', () => this._showChildPicker());
    this._canvas.appendChild(addCard);
  }

  _renderEntityCard(model, isRoot) {
    const card = document.createElement('div');
    card.className = `${CSS}-card ${isRoot ? `${CSS}-card-root` : `${CSS}-card-child`}`;

    // Header
    const header = document.createElement('div');
    header.className = `${CSS}-card-header`;

    const title = document.createElement('span');
    title.className = `${CSS}-card-title`;
    title.textContent = model.displayName || model.entity;

    header.appendChild(title);

    if (!isRoot) {
      const badge = document.createElement('span');
      badge.className = `${CSS}-rel-badge`;
      badge.textContent = `1:N via ${model.navProperty}`;
      header.appendChild(badge);

      const removeBtn = document.createElement('button');
      removeBtn.className = `${CSS}-remove-btn`;
      removeBtn.textContent = '\u00D7';
      removeBtn.title = 'Remove child entity';
      removeBtn.addEventListener('click', () => {
        this._model.children = this._model.children.filter(c => c !== model);
        this._renderCards();
        this._syncOutput();
      });
      header.appendChild(removeBtn);
    }

    card.appendChild(header);

    // Body — columns
    const body = document.createElement('div');
    body.className = `${CSS}-card-body`;

    const attrs = this._attrCache.get(model.entity) || [];
    const writable = attrs.filter(a =>
      !SKIP_TYPES.has(a.AttributeType) &&
      !SKIP_FIELDS.has(a.LogicalName) &&
      !a.IsLogical &&
      !a.AttributeOf &&
      a.IsValidForCreate !== false
    );

    if (writable.length === 0 && attrs.length === 0) {
      body.innerHTML = `<div class="${CSS}-loading-sm">Loading columns\u2026</div>`;
      this._loadAttributes(model.entity).then(() => {
        this._renderCards();
      });
    } else {
      // Search
      const search = document.createElement('input');
      search.type = 'text';
      search.placeholder = 'Filter columns\u2026';
      search.className = `${CSS}-col-search`;
      body.appendChild(search);

      // Column count
      const countEl = document.createElement('div');
      countEl.className = `${CSS}-col-count`;
      const updateCount = () => {
        countEl.textContent = `${model.attributes.length} of ${writable.length} columns selected`;
      };
      updateCount();
      body.appendChild(countEl);

      // Column list
      const list = document.createElement('div');
      list.className = `${CSS}-col-list`;

      for (const attr of writable) {
        const row = document.createElement('label');
        row.className = `${CSS}-col-item`;
        row.dataset.name = attr.LogicalName.toLowerCase();

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = model.attributes.includes(attr.LogicalName);
        cb.addEventListener('change', () => {
          if (cb.checked) {
            if (!model.attributes.includes(attr.LogicalName)) model.attributes.push(attr.LogicalName);
          } else {
            model.attributes = model.attributes.filter(n => n !== attr.LogicalName);
          }
          updateCount();
          this._syncOutput();
        });

        const dn = attr.DisplayName?.UserLocalizedLabel?.Label || attr.LogicalName;
        const nameSpan = document.createElement('span');
        nameSpan.className = `${CSS}-col-name`;
        nameSpan.textContent = `${dn} (${attr.LogicalName})`;

        const typeBadge = document.createElement('span');
        typeBadge.className = `${CSS}-type-badge`;
        typeBadge.dataset.type = attr.AttributeType;
        typeBadge.textContent = attr.AttributeType;

        const isReq = attr.RequiredLevel?.Value === 'ApplicationRequired' || attr.RequiredLevel?.Value === 'SystemRequired';
        if (isReq) {
          const reqBadge = document.createElement('span');
          reqBadge.className = `${CSS}-req-badge`;
          reqBadge.textContent = 'required';
          row.append(cb, nameSpan, typeBadge, reqBadge);
        } else {
          row.append(cb, nameSpan, typeBadge);
        }

        list.appendChild(row);
      }

      search.addEventListener('input', () => {
        const f = search.value.toLowerCase();
        list.querySelectorAll(`.${CSS}-col-item`).forEach(item => {
          item.style.display = item.dataset.name.includes(f) ? '' : 'none';
        });
      });

      body.appendChild(list);
    }

    card.appendChild(body);
    return card;
  }

  // -----------------------------------------------------------------------
  // Child entity (1:N) picker
  // -----------------------------------------------------------------------

  async _showChildPicker() {
    if (!this._model) return;

    const overlay = document.createElement('div');
    overlay.className = `${CSS}-modal-overlay`;

    const modal = document.createElement('div');
    modal.className = `${CSS}-modal`;

    const header = document.createElement('div');
    header.className = `${CSS}-modal-header`;
    header.innerHTML = `<span>Add Child Entity (1:N)</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = `${CSS}-modal-close`;
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = `${CSS}-modal-body`;
    body.innerHTML = `<div class="${CSS}-loading-sm">Loading relationships\u2026</div>`;
    modal.appendChild(body);

    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    this.container.appendChild(overlay);

    const rels = await this._loadRelationships(this._model.entity);
    body.innerHTML = '';

    // Search
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Filter relationships\u2026';
    search.className = `${CSS}-rel-search`;
    body.appendChild(search);

    const list = document.createElement('div');
    list.className = `${CSS}-rel-list`;

    // Only 1:N — these are the children we can deep-insert
    const oneToMany = (rels.OneToMany || []).filter(r => {
      // Skip already-added children
      return !this._model.children.some(c => c.navProperty === r.ReferencingEntityNavigationPropertyName);
    });

    if (oneToMany.length === 0) {
      list.innerHTML = `<div class="${CSS}-hint" style="padding:12px;">No 1:N relationships available (or all already added).</div>`;
    }

    for (const rel of oneToMany) {
      const childEntity = rel.ReferencingEntity;
      const entityMeta = this._entities.find(e => e.LogicalName === childEntity);
      const dn = entityMeta?.DisplayName?.UserLocalizedLabel?.Label || childEntity;
      const navProp = rel.ReferencingEntityNavigationPropertyName;

      const item = document.createElement('div');
      item.className = `${CSS}-rel-item`;
      item.dataset.search = `${childEntity} ${navProp} ${rel.SchemaName}`.toLowerCase();
      item.innerHTML = `
        <span class="${CSS}-rel-badge-sm">1:N</span>
        <span class="${CSS}-rel-label">${dn}</span>
        <span class="${CSS}-rel-nav">via ${navProp}</span>
      `;
      item.addEventListener('click', async () => {
        overlay.remove();
        await this._addChild(rel);
      });
      list.appendChild(item);
    }

    search.addEventListener('input', () => {
      const f = search.value.toLowerCase();
      list.querySelectorAll(`.${CSS}-rel-item`).forEach(el => {
        el.style.display = el.dataset.search.includes(f) ? '' : 'none';
      });
    });

    body.appendChild(list);
  }

  async _addChild(rel) {
    const childEntity = rel.ReferencingEntity;
    const navProp = rel.ReferencingEntityNavigationPropertyName;
    const attrs = await this._loadAttributes(childEntity);
    const entityMeta = this._entities.find(e => e.LogicalName === childEntity);

    const writable = attrs.filter(a =>
      !SKIP_TYPES.has(a.AttributeType) &&
      !SKIP_FIELDS.has(a.LogicalName) &&
      !a.IsLogical &&
      !a.AttributeOf &&
      a.LogicalName !== rel.ReferencingAttribute && // FK to parent — auto-handled by deep insert
      a.IsValidForCreate !== false
    );

    const required = writable.filter(a =>
      a.RequiredLevel?.Value === 'ApplicationRequired' ||
      a.RequiredLevel?.Value === 'SystemRequired' ||
      a.LogicalName === (entityMeta?.PrimaryNameAttribute || '')
    );

    this._model.children.push({
      entity: childEntity,
      entitySetName: entityMeta?.EntitySetName || childEntity + 's',
      displayName: entityMeta?.DisplayName?.UserLocalizedLabel?.Label || childEntity,
      navProperty: navProp,
      fkAttribute: rel.ReferencingAttribute,
      primaryIdAttribute: entityMeta?.PrimaryIdAttribute,
      attributes: required.map(a => a.LogicalName),
      allWritable: writable.map(a => a.LogicalName),
    });

    this._renderCards();
    this._syncOutput();
  }

  // -----------------------------------------------------------------------
  // Output panel
  // -----------------------------------------------------------------------

  _buildOutputPanel() {
    this._outputPanel.innerHTML = '';

    // Output mode tabs
    const tabs = document.createElement('div');
    tabs.className = `${CSS}-output-tabs`;

    const modes = [
      { id: 'tool', label: 'Tool Schema' },
      { id: 'deepinsert', label: 'Deep Insert' },
      { id: 'api', label: 'API Info' },
    ];

    for (const m of modes) {
      const btn = document.createElement('button');
      btn.className = `${CSS}-out-tab ${this._outputMode === m.id ? `${CSS}-out-tab-active` : ''}`;
      btn.textContent = m.label;
      btn.addEventListener('click', () => {
        this._outputMode = m.id;
        tabs.querySelectorAll(`.${CSS}-out-tab`).forEach(b => b.classList.remove(`${CSS}-out-tab-active`));
        btn.classList.add(`${CSS}-out-tab-active`);
        this._syncOutput();
      });
      tabs.appendChild(btn);
    }

    // Format toggle (only for tool mode, but always render — visibility toggled)
    const formatWrap = document.createElement('div');
    formatWrap.className = `${CSS}-format-wrap`;
    const formatSelect = document.createElement('select');
    formatSelect.className = `${CSS}-format-select`;
    for (const [val, label] of [['claude', 'Claude / Anthropic'], ['openai', 'OpenAI Functions'], ['mcp', 'MCP (Claude Desktop)']]) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      if (val === this._toolFormat) opt.selected = true;
      formatSelect.appendChild(opt);
    }
    formatSelect.addEventListener('change', () => {
      this._toolFormat = formatSelect.value;
      this._syncOutput();
    });
    formatWrap.appendChild(formatSelect);
    tabs.appendChild(formatWrap);

    this._outputPanel.appendChild(tabs);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = `${CSS}-copy-btn`;
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      if (this._outputPre) {
        navigator.clipboard.writeText(this._outputPre.textContent).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => copyBtn.textContent = 'Copy', 1500);
        });
      }
    });
    this._outputPanel.appendChild(copyBtn);

    // Pre block
    this._outputPre = document.createElement('pre');
    this._outputPre.className = `${CSS}-output-pre`;
    this._outputPanel.appendChild(this._outputPre);
  }

  // -----------------------------------------------------------------------
  // Schema generation
  // -----------------------------------------------------------------------

  _syncOutput() {
    if (!this._outputPre || !this._model) {
      if (this._outputPre) this._outputPre.textContent = '// Select an entity to generate output';
      return;
    }

    // Toggle format selector visibility
    const formatWrap = this._outputPanel.querySelector(`.${CSS}-format-wrap`);
    if (formatWrap) formatWrap.style.display = this._outputMode === 'tool' ? '' : 'none';

    switch (this._outputMode) {
      case 'tool':
        this._outputPre.textContent = JSON.stringify(this._generateToolSchema(), null, 2);
        break;
      case 'deepinsert':
        this._outputPre.textContent = JSON.stringify(this._generateDeepInsertTemplate(), null, 2);
        break;
      case 'api':
        this._outputPre.textContent = this._generateApiInfo();
        break;
    }
  }

  _generateToolSchema() {
    const m = this._model;
    const isRead = this._crudMode === 'read';

    if (isRead) return this._generateReadToolSchema();

    const attrs = this._attrCache.get(m.entity) || [];
    const isUpdate = this._crudMode === 'update';

    const properties = {};
    const required = [];

    if (isUpdate) {
      properties[m.primaryIdAttribute] = {
        type: 'string',
        format: 'uuid',
        description: `Primary key of the ${m.displayName} record to update`,
      };
      required.push(m.primaryIdAttribute);
    }

    for (const name of m.attributes) {
      const attr = attrs.find(a => a.LogicalName === name);
      if (!attr) continue;
      const prop = this._attrToSchemaProperty(attr, m.entity);
      properties[name] = prop;

      const isReq = attr.RequiredLevel?.Value === 'ApplicationRequired' || attr.RequiredLevel?.Value === 'SystemRequired';
      if (isReq && !isUpdate) required.push(name);
    }

    // Children as array properties (deep insert)
    if (!isUpdate) {
      for (const child of m.children) {
        const childAttrs = this._attrCache.get(child.entity) || [];
        const childProps = {};
        const childReq = [];

        for (const name of child.attributes) {
          const attr = childAttrs.find(a => a.LogicalName === name);
          if (!attr) continue;
          childProps[name] = this._attrToSchemaProperty(attr, child.entity);

          const isReq = attr.RequiredLevel?.Value === 'ApplicationRequired' || attr.RequiredLevel?.Value === 'SystemRequired';
          if (isReq) childReq.push(name);
        }

        properties[child.navProperty] = {
          type: 'array',
          description: `${child.displayName} records (1:N via ${child.navProperty}). Lookup to parent is set automatically via deep insert.`,
          items: {
            type: 'object',
            properties: childProps,
            ...(childReq.length ? { required: childReq } : {}),
          },
        };
      }
    }

    const inputSchema = {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
    };

    const verb = isUpdate ? 'Update' : 'Create';
    const toolName = `${verb.toLowerCase()}_${m.entity}`;
    const description = `${verb} a ${m.displayName} record in Dataverse` +
      (m.children.length && !isUpdate ? ` with ${m.children.map(c => c.displayName).join(', ')} child records via deep insert` : '');

    return this._wrapToolFormat(toolName, description, inputSchema);
  }

  _generateReadToolSchema() {
    const m = this._model;
    const attrs = this._attrCache.get(m.entity) || [];
    const selectedCols = m.attributes.map(n => attrs.find(a => a.LogicalName === n)).filter(Boolean);

    const properties = {
      filter: {
        type: 'string',
        description: `OData $filter expression (e.g. "statecode eq 0 and name ne null"). Available columns: ${m.attributes.join(', ')}`,
      },
      select: {
        type: 'string',
        description: `Comma-separated column names to return. Available: ${m.attributes.join(', ')}`,
      },
      top: {
        type: 'integer',
        description: 'Maximum number of records to return (default 50, max 5000)',
        default: 50,
      },
      orderby: {
        type: 'string',
        description: 'OData $orderby expression (e.g. "createdon desc")',
      },
    };

    // Add entity-specific filter helpers for picklists
    for (const attr of selectedCols) {
      if (['Picklist', 'State', 'Status'].includes(attr.AttributeType)) {
        const key = `${m.entity}:${attr.LogicalName}`;
        const cached = this._optSetCache.get(key);
        if (cached?.length) {
          const vals = cached.map(o => `${o.Value}=${o.Label?.UserLocalizedLabel?.Label || o.Value}`).join(', ');
          properties[`_hint_${attr.LogicalName}_values`] = {
            type: 'string',
            description: `Reference: ${attr.LogicalName} values: ${vals}`,
            enum: cached.map(o => String(o.Value)),
          };
        }
      }
    }

    const inputSchema = {
      type: 'object',
      properties,
    };

    const toolName = `list_${m.entity}`;
    const description = `Query ${m.displayName} records from Dataverse. Returns matching records with selected columns. Use $filter for conditions, $top to limit results.`;

    return this._wrapToolFormat(toolName, description, inputSchema);
  }

  _wrapToolFormat(toolName, description, inputSchema) {
    if (this._toolFormat === 'claude') {
      return { name: toolName, description, input_schema: inputSchema };
    }
    if (this._toolFormat === 'mcp') {
      return { name: toolName, description, inputSchema };
    }
    // OpenAI
    return { type: 'function', function: { name: toolName, description, parameters: inputSchema } };
  }

  _attrToSchemaProperty(attr, entityName) {
    const base = TYPE_MAP[attr.AttributeType] || { type: 'string' };
    const prop = { ...base };
    const dn = attr.DisplayName?.UserLocalizedLabel?.Label;
    if (dn) prop.description = dn;

    // Lookup hint — Targets is type-specific and not in base $select, so just mark as GUID
    if (['Lookup', 'Owner', 'Customer'].includes(attr.AttributeType)) {
      prop.description = `${dn || attr.LogicalName} — GUID of related record`;
    }

    // OptionSet — populate enum from cache
    if (['Picklist', 'State', 'Status'].includes(attr.AttributeType)) {
      const key = `${entityName}:${attr.LogicalName}`;
      if (this._optSetCache.has(key)) {
        const cached = this._optSetCache.get(key);
        if (cached.length) {
          prop.enum = cached.map(o => o.Value);
          const enumDescs = cached.map(o => `${o.Value} = ${o.Label?.UserLocalizedLabel?.Label || o.Value}`);
          prop.description = (prop.description ? prop.description + '. ' : '') + 'Values: ' + enumDescs.join(', ');
        }
        // else: empty option set — no enum, but don't re-fetch
      } else {
        // First time: trigger async load, will populate on next sync
        this._loadOptionSet(entityName, attr.LogicalName).then(() => this._syncOutput());
      }
    }

    return prop;
  }

  _generateDeepInsertTemplate() {
    const m = this._model;
    const attrs = this._attrCache.get(m.entity) || [];
    const template = {};

    for (const name of m.attributes) {
      const attr = attrs.find(a => a.LogicalName === name);
      if (!attr) continue;
      template[name] = this._placeholderValue(attr);
    }

    for (const child of m.children) {
      const childAttrs = this._attrCache.get(child.entity) || [];
      const childTemplate = {};
      for (const name of child.attributes) {
        const attr = childAttrs.find(a => a.LogicalName === name);
        if (!attr) continue;
        childTemplate[name] = this._placeholderValue(attr);
      }
      template[child.navProperty] = [childTemplate];
    }

    return template;
  }

  _placeholderValue(attr) {
    switch (attr.AttributeType) {
      case 'String': case 'Memo': return `<${attr.LogicalName}>`;
      case 'Integer': case 'BigInt': return 0;
      case 'Decimal': case 'Double': case 'Money': return 0.00;
      case 'Boolean': return false;
      case 'DateTime': return '2025-01-01T00:00:00Z';
      case 'Lookup': case 'Owner': case 'Customer':
        return `<${(attr.Targets || ['entity'])[0]}_guid>`;
      case 'Picklist': case 'State': case 'Status': return 1;
      default: return null;
    }
  }

  _generateApiInfo() {
    const m = this._model;
    const isRead = this._crudMode === 'read';
    const isUpdate = this._crudMode === 'update';

    if (isRead) {
      let info = `=== API Endpoint ===\n`;
      info += `GET /api/data/v9.2/${m.entitySetName}\n\n`;
      info += `=== Query Options ===\n`;
      info += `$select=${m.attributes.join(',')}\n`;
      info += `$filter=<your filter>\n`;
      info += `$top=50\n`;
      info += `$orderby=<column asc|desc>\n\n`;
      info += `=== Headers ===\n`;
      info += `OData-MaxVersion: 4.0\n`;
      info += `OData-Version: 4.0\n`;
      info += `Prefer: odata.include-annotations="*"\n\n`;
      info += `=== Notes ===\n`;
      info += `Response: { value: [...records], @odata.count: N }\n`;
      info += `Add $count=true to get total record count.\n`;
      info += `Null fields are omitted from the response.\n`;
      return info;
    }

    const method = isUpdate ? 'PATCH' : 'POST';
    const url = isUpdate
      ? `${m.entitySetName}(<${m.primaryIdAttribute}>)`
      : m.entitySetName;

    let info = `=== API Endpoint ===\n`;
    info += `${method} /api/data/v9.2/${url}\n\n`;
    info += `=== Headers ===\n`;
    info += `Content-Type: application/json\n`;
    info += `OData-MaxVersion: 4.0\n`;
    info += `OData-Version: 4.0\n`;

    if (!isUpdate) {
      info += `Prefer: return=representation\n`;
    }

    if (m.children.length && !isUpdate) {
      info += `\n=== Deep Insert Notes ===\n`;
      info += `This request uses deep insert to create the parent and all child records in a single POST.\n`;
      info += `Child records are nested under their navigation property:\n`;
      for (const child of m.children) {
        info += `  - "${child.navProperty}" → creates ${child.displayName} records\n`;
        info += `    The lookup "${child.fkAttribute}" on ${child.entity} to ${m.entity} is set automatically.\n`;
      }
    }

    if (isUpdate) {
      info += `\n=== Update Notes ===\n`;
      info += `Replace <${m.primaryIdAttribute}> in the URL with the record's GUID.\n`;
      info += `Only include fields you want to change in the body.\n`;
      info += `Deep insert (child arrays) is NOT supported for PATCH — use separate requests.\n`;
    }

    return info;
  }

  // -----------------------------------------------------------------------
  // CSS
  // -----------------------------------------------------------------------

  _injectStyles() {
    if (document.querySelector(`#${CSS}-styles`)) return;
    const style = document.createElement('style');
    style.id = `${CSS}-styles`;
    style.textContent = `
      .${CSS}-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        font-size: 0.82rem;
      }

      /* Toolbar */
      .${CSS}-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        flex-shrink: 0;
      }

      /* Entity picker */
      .${CSS}-entity-picker { position: relative; flex: 1; }
      .${CSS}-entity-input {
        width: 100%; box-sizing: border-box;
        padding: 5px 8px; font-size: 0.82rem;
        background: var(--color-bg-input); color: var(--color-text-primary);
        border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      }
      .${CSS}-entity-list {
        position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
        max-height: 240px; overflow-y: auto;
        background: var(--color-bg-primary); border: 1px solid var(--color-border);
        border-radius: var(--radius-sm); box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }
      .${CSS}-entity-option {
        padding: 5px 10px; cursor: pointer; font-size: 0.78rem;
        color: var(--color-text-primary);
      }
      .${CSS}-entity-option:hover { background: var(--color-bg-hover); }

      /* CRUD toggle */
      .${CSS}-crud-toggle { display: flex; gap: 2px; flex-shrink: 0; }
      .${CSS}-crud-btn {
        padding: 4px 10px; font-size: 0.72rem; font-weight: 600;
        background: transparent; color: var(--color-text-muted);
        border: 1px solid var(--color-border); cursor: pointer;
        border-radius: var(--radius-sm);
      }
      .${CSS}-crud-btn:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
      .${CSS}-crud-btn:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
      .${CSS}-crud-active {
        background: var(--color-accent-primary); color: #fff;
        border-color: var(--color-accent-primary);
      }

      /* Canvas */
      .${CSS}-canvas {
        flex: 1; overflow-y: auto; padding: 10px 12px;
        display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start;
      }
      .${CSS}-hint {
        color: var(--color-text-muted); font-size: 0.78rem;
        padding: 20px 0; width: 100%; text-align: center;
      }

      /* Cards */
      .${CSS}-card {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-bg-primary);
        width: calc(50% - 5px);
        min-width: 200px;
        display: flex; flex-direction: column;
      }
      .${CSS}-card-root { border-left: 3px solid var(--color-accent-primary); }
      .${CSS}-card-child { border-left: 3px solid #4ec9b0; }
      .${CSS}-card-add {
        border: 2px dashed var(--color-border-subtle);
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        min-height: 120px; opacity: 0.6;
      }
      .${CSS}-card-add:hover { opacity: 1; border-color: var(--color-accent-primary); }
      .${CSS}-add-inner { text-align: center; font-size: 0.78rem; color: var(--color-text-muted); line-height: 1.6; }

      .${CSS}-card-header {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--color-border-subtle);
        background: var(--color-bg-secondary);
        border-radius: var(--radius-md) var(--radius-md) 0 0;
      }
      .${CSS}-card-title { font-weight: 600; font-size: 0.82rem; color: var(--color-text-primary); flex: 1; }
      .${CSS}-rel-badge {
        font-size: 0.65rem; padding: 1px 6px;
        border-radius: 8px; background: rgba(78,201,176,0.15);
        color: #4ec9b0; font-weight: 600; white-space: nowrap;
      }
      .${CSS}-remove-btn {
        background: none; border: none; font-size: 1rem; cursor: pointer;
        color: var(--color-text-muted); padding: 0 2px;
      }
      .${CSS}-remove-btn:hover { color: #f93e3e; }

      .${CSS}-card-body { padding: 6px 10px; flex: 1; overflow-y: auto; max-height: 220px; }
      .${CSS}-loading-sm { font-size: 0.75rem; color: var(--color-text-muted); padding: 8px 0; }

      .${CSS}-col-search {
        width: 100%; box-sizing: border-box;
        padding: 3px 6px; font-size: 0.72rem;
        background: var(--color-bg-input); color: var(--color-text-primary);
        border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm);
        margin-bottom: 4px;
      }
      .${CSS}-col-count { font-size: 0.68rem; color: var(--color-text-muted); margin-bottom: 4px; }
      .${CSS}-col-list { display: flex; flex-direction: column; gap: 1px; }
      .${CSS}-col-item {
        display: flex; align-items: center; gap: 5px;
        padding: 2px 4px; cursor: pointer; font-size: 0.72rem;
        border-radius: 2px; color: var(--color-text-primary);
      }
      .${CSS}-col-item:hover { background: var(--color-bg-hover); }
      .${CSS}-col-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .${CSS}-type-badge {
        font-size: 0.6rem; padding: 0 4px; border-radius: 3px;
        background: var(--color-bg-secondary); color: var(--color-text-muted);
        font-family: monospace; white-space: nowrap;
      }
      .${CSS}-req-badge {
        font-size: 0.58rem; padding: 0 4px; border-radius: 3px;
        background: rgba(249,62,62,0.15); color: #f93e3e;
        font-weight: 600; white-space: nowrap;
      }

      /* Relationship picker modal */
      .${CSS}-modal-overlay {
        position: absolute; inset: 0; z-index: 100;
        background: rgba(0,0,0,0.5);
        display: flex; align-items: center; justify-content: center;
      }
      .${CSS}-modal {
        background: var(--color-bg-primary); border: 1px solid var(--color-border);
        border-radius: var(--radius-md); width: 90%; max-width: 420px;
        max-height: 80%; display: flex; flex-direction: column;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      }
      .${CSS}-modal-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 14px; border-bottom: 1px solid var(--color-border);
        font-weight: 600; font-size: 0.85rem; color: var(--color-text-primary);
      }
      .${CSS}-modal-close {
        background: none; border: none; font-size: 1.1rem; cursor: pointer;
        color: var(--color-text-muted);
      }
      .${CSS}-modal-body { padding: 10px 14px; overflow-y: auto; flex: 1; }
      .${CSS}-rel-search {
        width: 100%; box-sizing: border-box;
        padding: 4px 8px; font-size: 0.78rem;
        background: var(--color-bg-input); color: var(--color-text-primary);
        border: 1px solid var(--color-border); border-radius: var(--radius-sm);
        margin-bottom: 8px;
      }
      .${CSS}-rel-list { display: flex; flex-direction: column; gap: 2px; }
      .${CSS}-rel-item {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 8px; cursor: pointer; border-radius: var(--radius-sm);
        color: var(--color-text-primary);
      }
      .${CSS}-rel-item:hover { background: var(--color-bg-hover); }
      .${CSS}-rel-badge-sm {
        font-size: 0.6rem; padding: 1px 5px; border-radius: 6px;
        background: rgba(78,201,176,0.15); color: #4ec9b0; font-weight: 600;
      }
      .${CSS}-rel-label { font-size: 0.78rem; font-weight: 500; }
      .${CSS}-rel-nav { font-size: 0.68rem; color: var(--color-text-muted); margin-left: auto; }

      /* Output panel */
      .${CSS}-output {
        flex-shrink: 0;
        border-top: 1px solid var(--color-border);
        background: var(--color-bg-secondary);
        display: flex; flex-direction: column;
        max-height: 45%; min-height: 120px;
        position: relative;
      }
      .${CSS}-output-tabs {
        display: flex; align-items: center; gap: 2px;
        padding: 4px 10px;
        border-bottom: 1px solid var(--color-border-subtle);
      }
      .${CSS}-out-tab {
        padding: 3px 10px; font-size: 0.72rem; font-weight: 500;
        background: transparent; color: var(--color-text-muted);
        border: 1px solid transparent; cursor: pointer;
        border-radius: var(--radius-sm);
      }
      .${CSS}-out-tab:hover { color: var(--color-text-primary); }
      .${CSS}-out-tab-active {
        background: var(--color-bg-primary); color: var(--color-text-primary);
        border-color: var(--color-border);
      }
      .${CSS}-format-wrap { margin-left: auto; }
      .${CSS}-format-select {
        font-size: 0.7rem; padding: 2px 6px;
        background: var(--color-bg-input); color: var(--color-text-primary);
        border: 1px solid var(--color-border); border-radius: var(--radius-sm);
      }
      .${CSS}-copy-btn {
        position: absolute; top: 30px; right: 10px; z-index: 5;
        padding: 2px 10px; font-size: 0.68rem; font-weight: 600;
        background: var(--color-bg-input); color: var(--color-text-primary);
        border: 1px solid var(--color-border); border-radius: var(--radius-sm);
        cursor: pointer;
      }
      .${CSS}-copy-btn:hover { background: var(--color-bg-hover); }
      .${CSS}-output-pre {
        flex: 1; overflow: auto; margin: 0;
        padding: 10px 12px; font-size: 0.72rem;
        font-family: Consolas, 'Courier New', monospace;
        color: var(--color-text-primary); white-space: pre-wrap;
        line-height: 1.5;
      }
    `;
    document.head.appendChild(style);
  }
}
