/**
 * AI Customizer v3 — Conversational Dataverse customization via BYOK LLM
 *
 * Chat-based UI with stateful context. Each exchange builds on the previous.
 * Supports view modification and creation.
 */

import { injectStyles } from './ai-customizer/styles.js';
import { estimateTokens } from './ai-customizer/provider-adapters.js';
import { renderXmlDiff } from './ai-customizer/xml-diff.js';
import { AgentRunner } from './ai-customizer/agent-runner.js';
import { AgentTimeline } from './ai-customizer/agent-timeline.js';
import { ViewOperation } from './ai-customizer/operations/view-operation.js';
import { ToolRegistry, registerBuiltinTools } from './ai-customizer/tool-registry.js';
import { ToolExecutor } from './ai-customizer/tool-executor.js';
import { SkillManager } from './ai-customizer/skill-manager.js';
import { SessionManager } from './ai-customizer/session-manager.js';
import { ModuleBridge } from './ai-customizer/module-bridge.js';
import app from '../app.js';

const CSS = 'ac';
const STORAGE_KEY = 'dvt-settings';
const MAX_LOG_ENTRIES = 1000;

const TAG_COLORS = {
  META: '--color-info', SEND: '--color-accent-primary', RECV: '--color-success',
  DIFF: '--color-warning', WRITE: '--color-accent-secondary', PUB: '--color-success',
  ERR: '--color-error', WARN: '--color-warning',
};

let msgCounter = 0;

export default class AiCustomizer {
  #settings = {};
  #entities = [];
  #entitiesSorted = [];
  #selectedEntity = null;
  #activeOp = null;
  #opContext = null;
  #runner = null;
  #toolRegistry = null;
  #toolExecutor = null;
  #bridge = null;
  #skillManager = null;
  #sessionManager = null;
  #debugLog = [];
  #activeFilter = 'all';
  #autoScroll = true;
  #consoleExpanded = true;
  #systemPromptOverride = null;

  // DOM refs
  #entitySelect = null;
  #selectorContainer = null;
  #chatArea = null;
  #skillDrawer = null;
  #promptTextarea = null;
  #tokenEstimate = null;
  #sendBtn = null;
  #logContainer = null;
  #paletteEl = null;
  #paletteVisible = false;
  #paletteSelection = 0;
  #paletteItems = [];
  #responsesBar = null;

  constructor(container, apiClient, metadataCache) {
    this.container = container;
    this.api = apiClient;
    this.cache = metadataCache;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async render() {
    this.container.innerHTML = '';
    this.container.classList.add(`${CSS}-container`);
    injectStyles();

    const stored = await chrome.storage.local.get(STORAGE_KEY);
    this.#settings = stored[STORAGE_KEY] || {};

    if (!this.#settings.aiProvider || !this.#settings.aiEndpoint || !this.#settings.aiApiKey) {
      this.container.innerHTML = `
        <div class="${CSS}-unconfigured">
          <div class="${CSS}-unconfigured-icon">&#10024;</div>
          <h3>Dataverse Agent</h3>
          <p>Configure your AI provider to get started.</p>
          <p class="${CSS}-unconfigured-hint">Supports OpenAI, Azure OpenAI, Anthropic, or any OpenAI-compatible endpoint.</p>
          <button class="${CSS}-unconfigured-btn">Open Settings \u2192</button>
        </div>`;
      this.container.querySelector(`.${CSS}-unconfigured-btn`)?.addEventListener('click', () => {
        app.switchTab('settings');
      });
      return;
    }

    this.#activeOp = new ViewOperation(this.api, this.cache, this.#settings);

    // Initialize tool system
    this.#toolRegistry = new ToolRegistry();
    registerBuiltinTools(this.#toolRegistry);
    await this.#toolRegistry.load(); // load user tools
    this.#toolExecutor = new ToolExecutor(this.#toolRegistry, this.api, this.cache, {
      onConfirmation: (tool, params, reasoning) => this._showConfirmation(tool, params, reasoning),
      onLog: (tag, summary, detail) => this._log(tag, summary, detail),
    });

    // Initialize module bridge (connects agent to all extension modules)
    this.#bridge = new ModuleBridge(app);
    this.#toolExecutor.setBridge(this.#bridge);

    // Initialize skill + session managers
    this.#skillManager = new SkillManager();
    await this.#skillManager.load();
    this.#toolExecutor.setSkillManager(this.#skillManager);
    this.#sessionManager = new SessionManager();
    await this.#sessionManager.load();

    this._buildToolbar();
    this._buildChatArea();
    this._buildDebugConsole();
    this._buildInputBar();

    // Restore session messages if any
    const history = this.#sessionManager.getHistory();
    if (history.length > 0) {
      for (const msg of history) {
        if (msg.type === 'user') {
          this._addUserMessage(msg.text);
        } else {
          const agentMsg = this._addAgentMessage();
          if (msg.text) {
            const content = document.createElement('div');
            content.className = `${CSS}-agent-content`;
            content.innerHTML = this._renderMarkdown(msg.text);
            agentMsg.bubble.appendChild(content);
          }
        }
      }
    }

    this._log('META', 'Loading entities...');
    try {
      this.#entities = await this.cache.getEntities();
      this.#entitiesSorted = [...this.#entities].sort((a, b) => {
        const aName = a.DisplayName?.UserLocalizedLabel?.Label || a.LogicalName;
        const bName = b.DisplayName?.UserLocalizedLabel?.Label || b.LogicalName;
        return aName.localeCompare(bName);
      });
      this._log('META', `${this.#entities.length} entities loaded`);
    } catch (err) {
      this._log('ERR', `Failed to load entities: ${err.message}`);
    }
  }

  onHide() {}

  /**
   * Receive context from the quick chat bar or module bridge.
   * If quickChatMessage is provided, auto-send it.
   */
  setContext(ctx) {
    if (ctx?.quickChatMessage && this.#promptTextarea) {
      this.#promptTextarea.value = ctx.quickChatMessage;
      // Auto-send after a brief tick (let the DOM settle after tab switch)
      requestAnimationFrame(() => this._onSend());
    }
  }

  // =========================================================================
  // Toolbar
  // =========================================================================

  _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = `${CSS}-toolbar`;

    // Entity search
    const entityGroup = document.createElement('div');
    entityGroup.className = `${CSS}-select-group ${CSS}-entity-search-wrap`;
    const entityLabel = document.createElement('label');
    entityLabel.className = `${CSS}-select-label`;
    entityLabel.textContent = 'Entity';
    this.#entitySelect = document.createElement('input');
    this.#entitySelect.type = 'text';
    this.#entitySelect.className = `${CSS}-select ${CSS}-entity-input`;
    this.#entitySelect.placeholder = 'Search entity...';
    this.#entitySelect.autocomplete = 'off';
    const entityList = document.createElement('div');
    entityList.className = `${CSS}-entity-list`;
    entityList.style.display = 'none';
    this.#entitySelect.addEventListener('input', () => this._filterEntityList(entityList));
    this.#entitySelect.addEventListener('focus', () => this._filterEntityList(entityList));
    this.#entitySelect.addEventListener('blur', () => setTimeout(() => { entityList.style.display = 'none'; }, 180));
    entityGroup.append(entityLabel, this.#entitySelect, entityList);

    // Operation-specific selectors
    this.#selectorContainer = document.createElement('div');
    this.#selectorContainer.style.cssText = 'display:contents;';
    this.#activeOp.buildSelectorUI(this.#selectorContainer, (ctx) => this._onTargetReady(ctx));

    // Status dot
    const status = document.createElement('div');
    status.className = `${CSS}-status`;
    const dot = document.createElement('span');
    dot.className = `${CSS}-status-dot ${CSS}-status-connected`;
    const label = document.createElement('span');
    label.className = `${CSS}-status-label`;
    label.textContent = `${this.#settings.aiProvider} \u00B7 ${this.#settings.aiModel || 'default'}`;
    status.append(dot, label);

    // Session controls
    const sessionGroup = document.createElement('div');
    sessionGroup.className = `${CSS}-session-bar`;

    this._sessionSelect = document.createElement('select');
    this._sessionSelect.className = `${CSS}-select`;
    this._sessionSelect.style.cssText = 'font-size:0.72rem;max-width:140px;';
    this._populateSessionSelect(this._sessionSelect);
    this._sessionSelect.addEventListener('change', () => {
      if (this._sessionSelect.value === '__new__') {
        const name = `Session ${this.#sessionManager.getAll().length + 1}`;
        this.#sessionManager.create(name);
        this.#sessionManager.save();
        this._populateSessionSelect(this._sessionSelect);
        this._clearChat();
      } else {
        this.#sessionManager.switchTo(this._sessionSelect.value);
        this.#sessionManager.save();
        this._replaySession();
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    deleteBtn.textContent = '\u00D7';
    deleteBtn.title = 'Delete session';
    deleteBtn.addEventListener('click', () => {
      if (this.#sessionManager.getAll().length <= 1) return;
      this.#sessionManager.delete(this.#sessionManager.activeId);
      this.#sessionManager.save();
      this._populateSessionSelect(this._sessionSelect);
      this._replaySession();
    });

    const exportBtn = document.createElement('button');
    exportBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    exportBtn.textContent = '\u2913';
    exportBtn.title = 'Export session';
    exportBtn.addEventListener('click', () => {
      const json = this.#sessionManager.exportAsJson();
      if (json) {
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `session_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    });

    const skillsBtn = document.createElement('button');
    skillsBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    skillsBtn.textContent = '\uD83D\uDCDA';
    skillsBtn.title = 'Skills';
    skillsBtn.addEventListener('click', () => this._toggleSkillDrawer());

    sessionGroup.append(this._sessionSelect, deleteBtn, exportBtn, skillsBtn);

    // Collapsible Context section (Entity, Type, View)
    const contextWrap = document.createElement('details');
    contextWrap.className = `${CSS}-context-details`;
    const contextSummary = document.createElement('summary');
    contextSummary.className = `${CSS}-context-summary`;
    contextSummary.textContent = 'Context';
    const contextBody = document.createElement('div');
    contextBody.className = `${CSS}-context-body`;
    contextBody.append(entityGroup, this.#selectorContainer);
    contextWrap.append(contextSummary, contextBody);

    toolbar.append(sessionGroup, contextWrap, status);
    this.container.appendChild(toolbar);
  }

  _filterEntityList(listEl) {
    const filter = (this.#entitySelect.value || '').toLowerCase();
    listEl.innerHTML = '';
    const matches = this.#entitiesSorted.filter(e => {
      const dn = (e.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase();
      return e.LogicalName.toLowerCase().includes(filter) || dn.includes(filter);
    }).slice(0, 60);
    if (!matches.length) { listEl.style.display = 'none'; return; }
    for (const ent of matches) {
      const item = document.createElement('div');
      item.className = `${CSS}-entity-option`;
      const dn = ent.DisplayName?.UserLocalizedLabel?.Label;
      item.textContent = dn ? `${dn} (${ent.LogicalName})` : ent.LogicalName;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.#entitySelect.value = item.textContent;
        listEl.style.display = 'none';
        this._selectEntity(ent);
      });
      listEl.appendChild(item);
    }
    listEl.style.display = '';
  }

  async _selectEntity(ent) {
    this.#selectedEntity = ent;
    this.#activeOp.setEntity(ent);
    this.#opContext = null;
    this._log('META', `Loading views for ${ent.LogicalName}...`);
    try {
      const views = await this.#activeOp.loadViews();
      this._log('META', `${views.length} views found`);
    } catch (err) {
      this._log('ERR', `Failed to load views: ${err.message}`);
    }
  }

  _populateSessionSelect(select) {
    select.innerHTML = '';
    for (const s of this.#sessionManager.getAll()) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      opt.selected = s.id === this.#sessionManager.activeId;
      select.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ New Session';
    select.appendChild(newOpt);
  }

  _clearChat() {
    if (this.#chatArea) this.#chatArea.innerHTML = '';
  }

  _replaySession() {
    this._clearChat();
    for (const msg of this.#sessionManager.getHistory()) {
      if (msg.type === 'user') {
        this._addUserMessage(msg.text);
      } else {
        const am = this._addAgentMessage();
        if (msg.text) {
          const content = document.createElement('div');
          content.className = `${CSS}-agent-content`;
          content.innerHTML = this._renderMarkdown(msg.text);
          am.bubble.appendChild(content);
        }
      }
    }
  }

  _onTargetReady(context) {
    this.#opContext = context;
    this._log('META', `"${context.viewName}" selected`,
      `layoutxml: ${context.layoutxml?.length || 0} chars\nfetchxml: ${context.fetchxml?.length || 0} chars`);
  }

  // =========================================================================
  // Chat Area
  // =========================================================================

  _buildChatArea() {
    this.#chatArea = document.createElement('div');
    this.#chatArea.className = `${CSS}-chat-area`;

    // Skill drawer (sibling to chat, positioned relative to container)
    this.#skillDrawer = document.createElement('div');
    this.#skillDrawer.className = `${CSS}-skill-drawer`;

    this.container.appendChild(this.#chatArea);
    this.container.appendChild(this.#skillDrawer);
  }

  // -----------------------------------------------------------------------
  // Skill Drawer
  // -----------------------------------------------------------------------

  async _seedDefaultSkills() {
    if (this.#skillManager.getAll().length > 0) return;
    this._renderSkillDrawer();
    await new Promise(r => setTimeout(r, 600));

    // Skill 1: Create tables
    await this.#skillManager.create(
      'Create Dataverse tables via Web API',
      `**Endpoint:** \`POST EntityDefinitions\`
**Header:** \`MSCRM.SolutionUniqueName: YourSolution\` (to assign to a solution)

**Required body structure:**
- \`@odata.type\`: \`Microsoft.Dynamics.CRM.EntityMetadata\`
- \`SchemaName\`: e.g. \`prefix_tablename\` (no hyphens, use underscores)
- \`DisplayName\` and \`DisplayCollectionName\`: Label objects with \`@odata.type: Microsoft.Dynamics.CRM.Label\`
- \`OwnershipType\`: \`UserOwned\` or \`OrganizationOwned\`
- \`HasNotes\`, \`HasActivities\`, \`IsActivity\`: booleans
- \`Attributes\`: array containing the **primary name column** as \`StringAttributeMetadata\` with \`IsPrimaryName: true\`

**Minimal working example:**
\`\`\`json
{
  "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
  "SchemaName": "prefix_demo",
  "DisplayName": { "LocalizedLabels": [{ "Label": "Demo", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" },
  "DisplayCollectionName": { "LocalizedLabels": [{ "Label": "Demos", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" },
  "OwnershipType": "UserOwned",
  "HasNotes": false,
  "HasActivities": false,
  "IsActivity": false,
  "Attributes": [{
    "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
    "SchemaName": "prefix_name",
    "IsPrimaryName": true,
    "RequiredLevel": { "Value": "ApplicationRequired" },
    "MaxLength": 200,
    "DisplayName": { "LocalizedLabels": [{ "Label": "Name", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" }
  }]
}
\`\`\`

**Common pitfalls:**
- Missing \`@odata.type\` on Label objects or the entity itself → OData deserialization error
- Using \`PrimaryAttribute\` as a top-level property → invalid, must be in \`Attributes[]\` with \`IsPrimaryName: true\`
- Using \`CreateEntity\` action instead of \`POST EntityDefinitions\` → wrong route
- Hyphens in SchemaName → validation error
- After creation: run \`publish_entity\` to make the table visible`,
      {
        tags: ['dataverse', 'webapi', 'metadata', 'entity', 'table-creation'],
        trigger: 'When creating custom Dataverse tables/entities via the Web API',
        linkedTools: ['execute_action'],
      }
    );

    // Skill 2: Add columns
    await this.#skillManager.create(
      'Add columns to Dataverse tables via Web API',
      `**Endpoint:** \`POST EntityDefinitions(LogicalName='entityname')/Attributes\`
**Header:** \`MSCRM.SolutionUniqueName: YourSolution\`

Each attribute type requires its own \`@odata.type\`. All Label objects need \`@odata.type: Microsoft.Dynamics.CRM.Label\`.

**String (single line):**
\`\`\`json
{ "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", "SchemaName": "prefix_field", "MaxLength": 200, "FormatName": { "Value": "Text" }, "DisplayName": { "LocalizedLabels": [{ "Label": "Field", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" }, "RequiredLevel": { "Value": "None" } }
\`\`\`

**Memo (multi-line text):**
\`\`\`json
{ "@odata.type": "Microsoft.Dynamics.CRM.MemoAttributeMetadata", "SchemaName": "prefix_description", "MaxLength": 1048576, "Format": "Text", "DisplayName": { "LocalizedLabels": [{ "Label": "Description", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" }, "RequiredLevel": { "Value": "None" } }
\`\`\`

**Boolean (Yes/No):**
\`\`\`json
{ "@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata", "SchemaName": "prefix_flag", "DefaultValue": false, "DisplayName": { "LocalizedLabels": [{ "Label": "Flag", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" }, "RequiredLevel": { "Value": "None" }, "OptionSet": { "@odata.type": "Microsoft.Dynamics.CRM.BooleanOptionSetMetadata", "TrueOption": { "Value": 1, "Label": { "LocalizedLabels": [{ "Label": "Yes", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" } }, "FalseOption": { "Value": 0, "Label": { "LocalizedLabels": [{ "Label": "No", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" } } } }
\`\`\`

**Choice/Picklist:**
\`\`\`json
{ "@odata.type": "Microsoft.Dynamics.CRM.PicklistAttributeMetadata", "SchemaName": "prefix_category", "DisplayName": { "LocalizedLabels": [{ "Label": "Category", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" }, "RequiredLevel": { "Value": "None" }, "OptionSet": { "@odata.type": "Microsoft.Dynamics.CRM.OptionSetMetadata", "IsGlobal": false, "OptionSetType": "Picklist", "Options": [{ "Value": 100000000, "Label": { "LocalizedLabels": [{ "Label": "Option A", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" } }, { "Value": 100000001, "Label": { "LocalizedLabels": [{ "Label": "Option B", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" } }] } }
\`\`\`

**Integer:**
\`\`\`json
{ "@odata.type": "Microsoft.Dynamics.CRM.IntegerAttributeMetadata", "SchemaName": "prefix_count", "MinValue": 0, "MaxValue": 2147483647, "Format": "None", "DisplayName": { "LocalizedLabels": [{ "Label": "Count", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" }, "RequiredLevel": { "Value": "None" } }
\`\`\`

**File:**
\`\`\`json
{ "@odata.type": "Microsoft.Dynamics.CRM.FileAttributeMetadata", "SchemaName": "prefix_file", "MaxSizeInKB": 131072, "DisplayName": { "LocalizedLabels": [{ "Label": "File", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" }, "RequiredLevel": { "Value": "None" } }
\`\`\`

**RequiredLevel values:** \`None\`, \`ApplicationRequired\`, \`SystemRequired\``,
      {
        tags: ['dataverse', 'webapi', 'metadata', 'attributes', 'columns'],
        trigger: 'When adding columns/attributes to existing Dataverse tables',
        linkedTools: ['execute_action'],
      }
    );

    // Skill 3: Create relationships
    await this.#skillManager.create(
      'Create Dataverse relationships via Web API',
      `**Endpoint:** \`POST RelationshipDefinitions\`
**Header:** \`MSCRM.SolutionUniqueName: YourSolution\`

**1:N Lookup relationship:**
\`\`\`json
{
  "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
  "SchemaName": "prefix_parent_child",
  "ReferencedEntity": "prefix_parent",
  "ReferencingEntity": "prefix_child",
  "Lookup": {
    "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
    "SchemaName": "prefix_parentid",
    "DisplayName": { "LocalizedLabels": [{ "Label": "Parent", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" },
    "RequiredLevel": { "Value": "ApplicationRequired" }
  }
}
\`\`\`

**Self-referential lookup** (same entity in both Referenced and Referencing):
\`\`\`json
{
  "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
  "SchemaName": "prefix_item_parentitem",
  "ReferencedEntity": "prefix_item",
  "ReferencingEntity": "prefix_item",
  "Lookup": {
    "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
    "SchemaName": "prefix_parentitemid",
    "DisplayName": { "LocalizedLabels": [{ "Label": "Parent Item", "LanguageCode": 1033 }], "@odata.type": "Microsoft.Dynamics.CRM.Label" },
    "RequiredLevel": { "Value": "None" }
  }
}
\`\`\`

**Key points:**
- \`ReferencedEntity\` = the "one" side (parent), \`ReferencingEntity\` = the "many" side (child)
- The \`Lookup\` object creates the actual lookup column on the referencing entity
- \`SchemaName\` on the relationship must be globally unique
- \`RequiredLevel\`: use \`ApplicationRequired\` for mandatory lookups, \`None\` for optional`,
      {
        tags: ['dataverse', 'webapi', 'metadata', 'relationships', 'lookups'],
        trigger: 'When creating relationships/lookups between Dataverse tables',
        linkedTools: ['execute_action'],
      }
    );

    this._renderSkillDrawer();
    import('./easter-eggs.js').then(ee => ee.forceShowClippy(
      'Ich hab dir 3 Skills kreiert,\ndamit du so tun kannst als könntest du\nDatenmodelle entwerfen. 📎✨'
    )).catch(() => {});
  }

  async _toggleSkillDrawer() {
    if (!this.#skillDrawer) return;
    const isOpen = this.#skillDrawer.classList.toggle('open');
    if (isOpen) {
      await this._seedDefaultSkills();
      this._renderSkillDrawer();
    }
  }

  _renderSkillDrawer() {
    const drawer = this.#skillDrawer;
    drawer.innerHTML = '';

    const skills = this.#skillManager.getAll();

    // Header
    const header = document.createElement('div');
    header.className = `${CSS}-skill-drawer-header`;
    const h3 = document.createElement('h3');
    h3.textContent = `Skills (${skills.length})`;
    const actions = document.createElement('div');
    actions.className = `${CSS}-skill-drawer-actions`;
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.title = 'New skill';
    addBtn.addEventListener('click', () => this._showSkillForm());
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => this.#skillDrawer.classList.remove('open'));
    actions.append(addBtn, closeBtn);
    header.append(h3, actions);
    drawer.appendChild(header);

    // Tag filter bar
    const allTags = [...new Set(skills.flatMap(s => s.tags || []))].sort();
    if (allTags.length) {
      const tagBar = document.createElement('div');
      tagBar.className = `${CSS}-skill-tags-bar`;
      const allChip = document.createElement('button');
      allChip.className = `${CSS}-skill-tag-chip active`;
      allChip.textContent = 'all';
      allChip.addEventListener('click', () => {
        this._skillTagFilter = null;
        this._renderSkillDrawer();
      });
      tagBar.appendChild(allChip);
      for (const tag of allTags) {
        const chip = document.createElement('button');
        chip.className = `${CSS}-skill-tag-chip${this._skillTagFilter === tag ? ' active' : ''}`;
        chip.textContent = tag;
        chip.addEventListener('click', () => {
          this._skillTagFilter = this._skillTagFilter === tag ? null : tag;
          this._renderSkillDrawer();
        });
        tagBar.appendChild(chip);
      }
      if (!this._skillTagFilter) allChip.classList.add('active');
      else allChip.classList.remove('active');
      drawer.appendChild(tagBar);
    }

    // Skill list
    const list = document.createElement('div');
    list.className = `${CSS}-skill-list`;

    const filtered = this._skillTagFilter
      ? skills.filter(s => s.tags?.includes(this._skillTagFilter))
      : skills;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = `${CSS}-skill-empty`;
      empty.textContent = skills.length ? 'No skills match this tag.' : 'No skills yet. Click + to create one, or ask the agent to save knowledge as a skill.';
      list.appendChild(empty);
    }

    for (const skill of filtered) {
      list.appendChild(this._buildSkillCard(skill));
    }

    drawer.appendChild(list);
  }

  _buildSkillCard(skill) {
    const card = document.createElement('div');
    card.className = `${CSS}-skill-card`;

    // Header row
    const header = document.createElement('div');
    header.className = `${CSS}-skill-card-header`;

    const toggle = document.createElement('button');
    toggle.className = `${CSS}-skill-card-toggle${skill.enabled !== false ? ' on' : ''}`;
    toggle.title = skill.enabled !== false ? 'Enabled' : 'Disabled';
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.#skillManager.update(skill.id, { enabled: skill.enabled === false });
      this._renderSkillDrawer();
    });

    const name = document.createElement('span');
    name.className = `${CSS}-skill-card-name`;
    name.textContent = skill.name;

    header.append(toggle, name);
    header.addEventListener('click', () => {
      const body = card.querySelector(`.${CSS}-skill-card-body`);
      if (body) {
        const opening = !body.classList.contains('open');
        body.classList.toggle('open');
        if (opening && skill.name === 'Create Dataverse tables via Web API') {
          import('./easter-eggs.js').then(ee => ee.forceShowClippy(
            'Ah, der Klassiker! EntityDefinitions POST —\ndamit fing alles an. Ohne mich wärst du\nnoch bei PrimaryAttribute. 📎'
          )).catch(() => {});
        }
      }
    });

    card.appendChild(header);

    // Tags
    if (skill.tags?.length) {
      const meta = document.createElement('div');
      meta.className = `${CSS}-skill-card-meta`;
      for (const tag of skill.tags) {
        const t = document.createElement('span');
        t.className = `${CSS}-skill-card-meta-tag`;
        t.textContent = tag;
        meta.appendChild(t);
      }
      card.appendChild(meta);
    }

    // Trigger
    if (skill.trigger) {
      const trig = document.createElement('div');
      trig.className = `${CSS}-skill-card-trigger`;
      trig.textContent = skill.trigger;
      card.appendChild(trig);
    }

    // Expandable body
    const body = document.createElement('div');
    body.className = `${CSS}-skill-card-body`;

    const content = document.createElement('div');
    content.innerHTML = this._renderMarkdown(skill.content);
    body.appendChild(content);

    const bodyActions = document.createElement('div');
    bodyActions.className = `${CSS}-skill-card-body-actions`;
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => this._showSkillForm(skill));
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', async () => {
      await this.#skillManager.delete(skill.id);
      this._renderSkillDrawer();
    });
    bodyActions.append(editBtn, deleteBtn);
    body.appendChild(bodyActions);

    card.appendChild(body);
    return card;
  }

  _showSkillForm(existingSkill = null) {
    // Remove any existing form
    this.#skillDrawer.querySelector(`.${CSS}-skill-form`)?.remove();

    const form = document.createElement('div');
    form.className = `${CSS}-skill-form`;

    form.innerHTML = `
      <label>Name</label>
      <input type="text" id="skill-name" value="${existingSkill?.name || ''}" placeholder="e.g. EntityDefinitions POST" />
      <label>Tags (comma-separated)</label>
      <input type="text" id="skill-tags" value="${(existingSkill?.tags || []).join(', ')}" placeholder="e.g. api, metadata" />
      <label>Trigger (when is this relevant?)</label>
      <input type="text" id="skill-trigger" value="${existingSkill?.trigger || ''}" placeholder="e.g. When creating tables via Web API" />
      <label>Content (Markdown)</label>
      <textarea id="skill-content" placeholder="Knowledge to persist...">${existingSkill?.content || ''}</textarea>
    `;

    const actions = document.createElement('div');
    actions.className = `${CSS}-skill-form-actions`;
    const saveBtn = document.createElement('button');
    saveBtn.className = `${CSS}-btn-primary`;
    saveBtn.textContent = existingSkill ? 'Update' : 'Create';
    saveBtn.style.cssText = 'font-size:0.72rem;padding:4px 12px;';
    saveBtn.addEventListener('click', async () => {
      const name = form.querySelector('#skill-name').value.trim();
      const content = form.querySelector('#skill-content').value.trim();
      if (!name || !content) return;
      const tags = form.querySelector('#skill-tags').value.split(',').map(t => t.trim()).filter(Boolean);
      const trigger = form.querySelector('#skill-trigger').value.trim();

      if (existingSkill) {
        await this.#skillManager.update(existingSkill.id, { name, content, tags, trigger });
      } else {
        await this.#skillManager.create(name, content, { tags, trigger });
      }
      form.remove();
      this._renderSkillDrawer();
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = `${CSS}-btn-secondary`;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'font-size:0.72rem;padding:4px 12px;';
    cancelBtn.addEventListener('click', () => form.remove());
    actions.append(saveBtn, cancelBtn);
    form.appendChild(actions);

    this.#skillDrawer.appendChild(form);
    form.querySelector('#skill-name').focus();
  }

  _addUserMessage(text) {
    const msg = document.createElement('div');
    msg.className = `${CSS}-chat-msg ${CSS}-chat-user`;
    const bubble = document.createElement('div');
    bubble.className = `${CSS}-chat-bubble`;
    bubble.textContent = text;
    msg.appendChild(bubble);
    this.#chatArea.appendChild(msg);
    this._scrollChat();
    return msg;
  }

  _addAgentMessage() {
    const id = `agent-msg-${++msgCounter}`;
    const msg = document.createElement('div');
    msg.className = `${CSS}-chat-msg ${CSS}-chat-agent`;
    msg.id = id;
    const bubble = document.createElement('div');
    bubble.className = `${CSS}-chat-bubble`;

    // Timeline container (inside bubble)
    const timelineEl = document.createElement('div');
    bubble.appendChild(timelineEl);

    // Diff container (hidden until result)
    const diffEl = document.createElement('div');
    diffEl.className = `${CSS}-diff-panel`;
    diffEl.style.display = 'none';
    bubble.appendChild(diffEl);

    // Action bar (hidden until result)
    const actionBar = document.createElement('div');
    actionBar.className = `${CSS}-action-bar`;
    actionBar.style.display = 'none';
    bubble.appendChild(actionBar);

    // Status line
    const statusLine = document.createElement('div');
    statusLine.className = `${CSS}-chat-status`;
    bubble.appendChild(statusLine);

    msg.appendChild(bubble);
    this.#chatArea.appendChild(msg);
    this._scrollChat();

    return { id, element: msg, bubble, timelineEl, diffEl, actionBar, statusLine };
  }

  _scrollChat() {
    requestAnimationFrame(() => {
      this.#chatArea.scrollTop = this.#chatArea.scrollHeight;
    });
  }

  // =========================================================================
  // Input Bar (fixed at bottom)
  // =========================================================================

  _buildInputBar() {
    const bar = document.createElement('div');
    bar.className = `${CSS}-input-bar`;

    // Slash command palette (hidden by default)
    this.#paletteEl = this._buildPalette();
    bar.appendChild(this.#paletteEl);

    this.#promptTextarea = document.createElement('textarea');
    this.#promptTextarea.className = `${CSS}-prompt-input`;
    this.#promptTextarea.placeholder = 'Enter to send, Shift+Enter for new line, / for commands';
    this.#promptTextarea.rows = 2;
    this.#promptTextarea.addEventListener('input', () => {
      this._updateTokenEstimate();
      this._updatePalette();
    });
    this.#promptTextarea.addEventListener('keydown', (e) => {
      // Palette navigation
      if (this.#paletteVisible) {
        if (e.key === 'ArrowDown') { e.preventDefault(); this._paletteMoveSelection(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this._paletteMoveSelection(-1); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._paletteSelectCurrent(); return; }
        if (e.key === 'Escape') { e.preventDefault(); this._hidePalette(); return; }
        if (e.key === 'Tab') { e.preventDefault(); this._paletteSelectCurrent(); return; }
      } else {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._onSend();
        }
      }
    });

    const controls = document.createElement('div');
    controls.className = `${CSS}-input-controls`;

    this.#sendBtn = document.createElement('button');
    this.#sendBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
    this.#sendBtn.textContent = 'Send';
    this.#sendBtn.addEventListener('click', () => this._onSend());

    // Commands button (visual access to palette)
    const cmdBtn = document.createElement('button');
    cmdBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    cmdBtn.textContent = '/ Commands';
    cmdBtn.title = 'Show slash commands';
    cmdBtn.addEventListener('click', () => {
      this.#promptTextarea.value = '/';
      this.#promptTextarea.focus();
      this._updatePalette();
    });

    const sysPromptBtn = document.createElement('button');
    sysPromptBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    sysPromptBtn.textContent = 'System Prompt';
    sysPromptBtn.addEventListener('click', () => this._showSystemPromptEditor());

    this.#tokenEstimate = document.createElement('span');
    this.#tokenEstimate.className = `${CSS}-token-estimate`;

    controls.append(this.#sendBtn, cmdBtn, sysPromptBtn, this.#tokenEstimate);

    // Responses API inline settings (reasoning + web search)
    this.#responsesBar = this._buildResponsesBar();
    bar.append(this.#promptTextarea, this.#responsesBar, controls);
    this.container.appendChild(bar);
  }

  _updateTokenEstimate() {
    const text = this.#promptTextarea?.value || '';
    this.#tokenEstimate.textContent = text.trim() ? `~${estimateTokens(text)} tokens` : '';
  }

  // ---- Responses API inline toggles (reasoning + web search) ---------------

  _buildResponsesBar() {
    const bar = document.createElement('div');
    bar.className = `${CSS}-responses-bar`;

    const show = this.#settings.aiProvider
      && this.#settings.aiProvider !== 'anthropic'
      && this.#settings.aiApiMode !== 'chat';
    bar.style.display = show ? '' : 'none';

    const makeToggle = (label, options, settingKey) => {
      const group = document.createElement('div');
      group.className = `${CSS}-responses-group`;
      const lbl = document.createElement('span');
      lbl.className = `${CSS}-responses-label`;
      lbl.textContent = label;
      group.appendChild(lbl);

      for (const { value, text } of options) {
        const btn = document.createElement('button');
        btn.className = `${CSS}-responses-opt`;
        btn.textContent = text;
        btn.dataset.value = value;
        if ((this.#settings[settingKey] || '') === value) btn.classList.add('active');
        btn.addEventListener('click', () => {
          this.#settings[settingKey] = value;
          group.querySelectorAll(`.${CSS}-responses-opt`).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          chrome.storage.local.get('dvt-settings', (r) => {
            const s = r['dvt-settings'] || {};
            s[settingKey] = value;
            chrome.storage.local.set({ 'dvt-settings': s });
          });
        });
        group.appendChild(btn);
      }
      return group;
    };

    bar.appendChild(makeToggle('Reasoning', [
      { value: '', text: 'off' },
      { value: 'low', text: 'low' },
      { value: 'medium', text: 'med' },
      { value: 'high', text: 'high' },
    ], 'aiReasoning'));

    bar.appendChild(makeToggle('Web Search', [
      { value: '', text: 'off' },
      { value: 'auto', text: 'auto' },
      { value: 'required', text: 'required' },
    ], 'aiWebSearch'));

    return bar;
  }

  _refreshResponsesBar() {
    if (!this.#responsesBar) return;
    const show = this.#settings.aiProvider
      && this.#settings.aiProvider !== 'anthropic'
      && this.#settings.aiApiMode !== 'chat';
    this.#responsesBar.style.display = show ? '' : 'none';
  }

  // =========================================================================
  // Slash Commands
  // =========================================================================

  /** All available slash commands. */
  get _slashCommands() {
    return [
      { id: 'tools', label: '/tools', description: 'List all available tools', handler: () => this._cmdTools() },
      { id: 'skills', label: '/skills', description: 'Open skill manager', handler: () => this._cmdSkills() },
      { id: 'save-tool', label: '/save-tool', description: 'Save exploration as reusable tool', handler: () => this._cmdSaveTool() },
      { id: 'entity', label: '/entity', description: 'Set active entity context', hasArg: true, handler: (arg) => this._cmdEntity(arg) },
      { id: 'view', label: '/view', description: 'Set active view context', hasArg: true, handler: (arg) => this._cmdView(arg) },
      { id: 'sessions', label: '/sessions', description: 'List and switch sessions', handler: () => this._cmdSessions() },
      { id: 'export', label: '/export', description: 'Export current session', handler: () => this._cmdExport() },
      { id: 'clear', label: '/clear', description: 'Clear current session', handler: () => this._cmdClear() },
      { id: 'debug', label: '/debug', description: 'Toggle debug console', handler: () => this._cmdDebug() },
      { id: 'prompt', label: '/prompt', description: 'Open system prompt editor', handler: () => this._showSystemPromptEditor() },
      { id: 'help', label: '/help', description: 'Show available commands', handler: () => this._cmdHelp() },
    ];
  }

  /** Build the palette DOM element. */
  _buildPalette() {
    const el = document.createElement('div');
    el.className = `${CSS}-palette`;
    el.style.display = 'none';
    return el;
  }

  /** Show/hide the palette based on current input. */
  _updatePalette() {
    const text = this.#promptTextarea?.value || '';
    if (!text.startsWith('/')) {
      this._hidePalette();
      return;
    }

    const query = text.slice(1).toLowerCase();
    const matches = this._slashCommands.filter(cmd =>
      cmd.id.startsWith(query) || cmd.label.includes(query) || cmd.description.toLowerCase().includes(query)
    );

    if (!matches.length) {
      this._hidePalette();
      return;
    }

    this.#paletteItems = matches;
    this.#paletteSelection = 0;
    this.#paletteEl.innerHTML = '';

    for (let i = 0; i < matches.length; i++) {
      const cmd = matches[i];
      const row = document.createElement('div');
      row.className = `${CSS}-palette-item${i === 0 ? ' selected' : ''}`;
      row.innerHTML = `<span class="${CSS}-palette-cmd">${cmd.label}</span><span class="${CSS}-palette-desc">${cmd.description}</span>`;
      row.addEventListener('click', () => { this.#paletteSelection = i; this._paletteSelectCurrent(); });
      row.addEventListener('mouseenter', () => {
        this.#paletteSelection = i;
        this.#paletteEl.querySelectorAll(`.${CSS}-palette-item`).forEach((el, j) => el.classList.toggle('selected', j === i));
      });
      this.#paletteEl.appendChild(row);
    }

    this.#paletteEl.style.display = '';
    this.#paletteVisible = true;
  }

  _hidePalette() {
    if (!this.#paletteVisible) return;
    this.#paletteEl.style.display = 'none';
    this.#paletteVisible = false;
    this.#paletteItems = [];
  }

  _paletteMoveSelection(delta) {
    const items = this.#paletteEl.querySelectorAll(`.${CSS}-palette-item`);
    if (!items.length) return;
    this.#paletteSelection = (this.#paletteSelection + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('selected', i === this.#paletteSelection));
    items[this.#paletteSelection]?.scrollIntoView({ block: 'nearest' });
  }

  _paletteSelectCurrent() {
    const cmd = this.#paletteItems[this.#paletteSelection];
    if (!cmd) return;

    this._hidePalette();

    if (cmd.hasArg) {
      // Insert command prefix and let user type the argument
      this.#promptTextarea.value = cmd.label + ' ';
      this.#promptTextarea.focus();
      return;
    }

    this.#promptTextarea.value = '';
    cmd.handler();
  }

  /**
   * Try to handle input as a slash command.
   * @returns {boolean} true if handled, false if should proceed to agent.
   */
  _trySlashCommand(text) {
    if (!text.startsWith('/')) return false;

    const parts = text.slice(1).split(/\s+/);
    const cmdId = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    const cmd = this._slashCommands.find(c => c.id === cmdId);
    if (!cmd) return false;

    cmd.handler(arg);
    return true;
  }

  // -- Slash command handlers --

  _cmdTools() {
    const tools = this.#toolRegistry.getAll();
    const grouped = {};
    for (const t of tools) {
      (grouped[t.category] ??= []).push(t);
    }
    let md = '**Available Tools:**\n\n';
    for (const [cat, list] of Object.entries(grouped)) {
      md += `**${cat}**\n`;
      for (const t of list) {
        const confirm = t.requiresConfirmation ? ' *(confirmation)*' : '';
        md += `- \`${t.id}\` — ${t.description}${confirm}\n`;
      }
      md += '\n';
    }
    this._addSystemMessage(md);
  }

  _cmdSkills() {
    if (!this.#skillDrawer.classList.contains('open')) {
      this._toggleSkillDrawer();
    }
  }

  _cmdSaveTool() {
    // TODO: Phase 5 — tool crystallization
    this._addSystemMessage('Tool crystallization will be available in a future update. For now, describe what you want to save and the agent can help structure it.');
  }

  _cmdEntity(arg) {
    if (!arg) {
      this._addSystemMessage(`Current entity: **${this.#selectedEntity?.LogicalName || '(none)'}**\n\nUsage: \`/entity account\``);
      return;
    }
    // Find matching entity
    const match = this.#entitiesSorted.find(e =>
      e.LogicalName.toLowerCase() === arg.toLowerCase() ||
      (e.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase() === arg.toLowerCase()
    );
    if (!match) {
      this._addSystemMessage(`Entity "${arg}" not found. Try \`/entity\` to see current, or type part of the name.`);
      return;
    }
    // Set entity via the entity select dropdown
    if (this.#entitySelect) {
      this.#entitySelect.value = match.LogicalName;
      this.#entitySelect.dispatchEvent(new Event('change'));
    }
    this._addSystemMessage(`Entity set to **${match.LogicalName}** (${match.DisplayName?.UserLocalizedLabel?.Label || ''})`);
  }

  _cmdView(arg) {
    if (!arg) {
      this._addSystemMessage('Usage: `/view "Active Accounts"` — set the active view by name.');
      return;
    }
    this._addSystemMessage(`View selection via slash command is not yet implemented. Select a view from the dropdown above.`);
  }

  _cmdSessions() {
    const sessions = this.#sessionManager.getAll();
    const active = this.#sessionManager.activeId;
    let md = '**Sessions:**\n\n';
    for (const s of sessions) {
      const marker = s.id === active ? ' *(active)*' : '';
      const count = s.messages?.length || 0;
      md += `- **${s.name || 'Untitled'}**${marker} — ${count} messages\n`;
    }
    md += '\nSwitch sessions using the dropdown in the toolbar.';
    this._addSystemMessage(md);
  }

  _cmdExport() {
    const md = this.#sessionManager.exportAsMarkdown();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    this._addSystemMessage('Session exported as Markdown.');
  }

  _cmdClear() {
    if (this.#chatArea) this.#chatArea.innerHTML = '';
    this.#sessionManager.clearActive?.();
    this._addSystemMessage('Chat cleared.');
  }

  _cmdDebug() {
    this.#consoleExpanded = !this.#consoleExpanded;
    const console = this.container.querySelector(`.${CSS}-console`);
    if (console) console.classList.toggle('collapsed', !this.#consoleExpanded);
    this._addSystemMessage(`Debug console ${this.#consoleExpanded ? 'expanded' : 'collapsed'}.`);
  }

  _cmdHelp() {
    let md = '**Slash Commands:**\n\n';
    for (const cmd of this._slashCommands) {
      md += `- \`${cmd.label}\` — ${cmd.description}\n`;
    }
    md += '\nType `/` in the input to see the command palette.';
    this._addSystemMessage(md);
  }

  /** Add a system-generated message to the chat (not from agent, not from user). */
  _addSystemMessage(markdownText) {
    const wrapper = document.createElement('div');
    wrapper.className = `${CSS}-system-msg`;
    wrapper.innerHTML = this._renderMarkdown(markdownText);
    this.#chatArea?.appendChild(wrapper);
    this._scrollChat();
  }

  // =========================================================================
  // System Prompt Editor
  // =========================================================================

  _showSystemPromptEditor() {
    let defaultPrompt = '(Select an entity and view first)';
    if (this.#opContext && this.#selectedEntity) {
      try {
        const tempCtx = { ...this.#opContext, attributes: [], relationships: [] };
        defaultPrompt = this.#activeOp.buildSystemPrompt(tempCtx);
      } catch { /* ignore */ }
    }
    const currentValue = this.#systemPromptOverride ?? defaultPrompt;

    const overlay = document.createElement('div');
    overlay.className = `${CSS}-sysprompt-overlay`;
    const panel = document.createElement('div');
    panel.className = `${CSS}-sysprompt-panel`;

    const header = document.createElement('div');
    header.className = `${CSS}-sysprompt-header`;
    const title = document.createElement('span');
    title.textContent = 'System Prompt';
    title.style.cssText = 'font-weight:600;font-size:0.85rem;';
    const badge = document.createElement('span');
    badge.style.cssText = `font-size:0.65rem;padding:1px 6px;border-radius:8px;background:${this.#systemPromptOverride ? 'var(--color-warning)' : 'var(--color-success)'};color:#000;margin-left:6px;`;
    badge.textContent = this.#systemPromptOverride ? 'Custom' : 'Default';
    const tokenCount = document.createElement('span');
    tokenCount.style.cssText = 'font-size:0.68rem;color:var(--color-text-muted);margin-left:auto;';
    tokenCount.textContent = `~${estimateTokens(currentValue)} tokens`;
    header.append(title, badge, tokenCount);

    const textarea = document.createElement('textarea');
    textarea.className = `${CSS}-sysprompt-textarea`;
    textarea.value = currentValue;
    textarea.spellcheck = false;
    textarea.addEventListener('input', () => { tokenCount.textContent = `~${estimateTokens(textarea.value)} tokens`; });

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.68rem;color:var(--color-text-muted);padding:4px 0;';
    hint.textContent = 'Edit for this session. Attributes/relationships are injected at runtime. Resets on page reload.';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
    const resetBtn = document.createElement('button');
    resetBtn.className = `${CSS}-btn ${CSS}-btn-secondary`;
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => { this.#systemPromptOverride = null; overlay.remove(); this._log('META', 'System prompt reset'); });
    const cancelBtn = document.createElement('button');
    cancelBtn.className = `${CSS}-btn ${CSS}-btn-secondary`;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    const saveBtn = document.createElement('button');
    saveBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
    saveBtn.textContent = 'Use Custom';
    saveBtn.addEventListener('click', () => {
      const val = textarea.value.trim();
      if (val && val !== defaultPrompt) { this.#systemPromptOverride = val; this._log('META', `System prompt overridden (~${estimateTokens(val)} tokens)`); }
      else { this.#systemPromptOverride = null; }
      overlay.remove();
    });
    btnRow.append(resetBtn, cancelBtn, saveBtn);

    panel.append(header, textarea, hint, btnRow);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } });
    this.container.appendChild(overlay);
    textarea.focus();
  }

  // =========================================================================
  // Agent Execution
  // =========================================================================

  async _onSend() {
    const userPrompt = this.#promptTextarea?.value?.trim();
    if (!userPrompt) return;

    if (this.#runner) { this.#runner.abort(); this.#runner = null; this.#sendBtn.textContent = 'Send'; return; }

    // Try slash command first
    if (this._trySlashCommand(userPrompt)) {
      this.#promptTextarea.value = '';
      this._updateTokenEstimate();
      this._hidePalette();
      return;
    }

    // Clear input
    this.#promptTextarea.value = '';
    this._updateTokenEstimate();
    this._hidePalette();
    this.#sendBtn.textContent = 'Cancel';

    // Add user message to chat + session
    this._addUserMessage(userPrompt);
    this.#sessionManager.addMessage({ type: 'user', text: userPrompt });

    // Add agent message container
    const agentMsg = this._addAgentMessage();
    const timeline = new AgentTimeline(agentMsg.timelineEl);
    timeline.onAnswer = (answer) => this.#runner?.continueWithAnswer(answer);

    // Build conversation history from session (prior turns only, not the current message)
    const priorHistory = this.#sessionManager.getHistory().slice(0, -1) // exclude the message we just added
      .map(msg => ({ role: msg.type === 'user' ? 'user' : 'assistant', content: msg.text }))
      .filter(m => m.content);
    const isNewSession = priorHistory.length === 0;

    // Build system prompt: base context + tool list + optional override
    let systemPrompt;
    if (this.#systemPromptOverride) {
      systemPrompt = this.#systemPromptOverride;
    } else {
      const currentState = this.#activeOp.currentState;
      const contextParts = [
        `You are a Dataverse / Dynamics 365 agent running inside a Chrome extension side panel.`,
        `You can call tools to interact with the environment. Always respond with a JSON object.`,
        '',
        `## Response Format`,
        `{ "status": "tool_call", "tool": "<tool_id>", "params": {...}, "reasoning": "..." }`,
        `{ "status": "tool_calls", "calls": [...], "reasoning": "..." }  — for multiple parallel calls`,
        `{ "status": "done", "reasoning": "..." }  — when task is complete. Put your ENTIRE user-facing answer in "reasoning".`,
        `{ "status": "question", "question": "...", "reasoning": "..." }  — to ask the user`,
        `{ "status": "error", "error": "...", "reasoning": "..." }`,
        ``,
        `CRITICAL: The "reasoning" field is your MAIN output to the user. Write your complete answer there using Markdown.`,
        `For "done" status: "reasoning" IS your answer. Do NOT put your answer in "result" — put structured data there only if needed (e.g. generated XML).`,
        `Do NOT wrap JSON in code fences. Return raw JSON only.`,
        `Only call "inspect_form" when the user explicitly asks about a form or record they have open. Do NOT call it proactively.`,
        `If a tool call fails, recover gracefully — tell the user what happened and offer alternatives.`,
        `You can create skills — reusable knowledge that persists across conversations. When you learn something new and non-obvious (API patterns, correct request formats, workarounds), offer to save it as a skill.`,
        `Prefer "execute_action" for sending requests directly instead of "load_request" (which navigates away from chat). Only use navigation tools when the user needs to SEE a visual artifact.`,
      ];
      const excludeTools = new Set();
      if (isNewSession) {
        contextParts.push(`On your FIRST response, call "name_conversation" with a short 2-5 word name based on the user's question. Only call it once — never again in this conversation.`);
      } else {
        excludeTools.add('name_conversation');
      }
      contextParts.push(
        '',
        this.#toolRegistry.buildToolListForPrompt(excludeTools),
        '',
        `## Current Context`,
        `Entity: ${this.#selectedEntity?.LogicalName || '(none)'}`,
        `EntitySet: ${this.#selectedEntity?.EntitySetName || ''}`,
      );
      if (currentState.viewName) {
        contextParts.push(`View: "${currentState.viewName}"`);
        contextParts.push(`Current layoutxml: ${currentState.layoutxml || '(none)'}`);
        contextParts.push(`Current fetchxml: ${currentState.fetchxml || '(none)'}`);
      }
      // Inject skill context
      const toolIds = this.#toolRegistry.getAll().map(t => t.id);
      const skillSection = this.#skillManager.buildSkillPromptSection(toolIds);
      if (skillSection) contextParts.push(skillSection);

      // Inject active module context (what the user is currently looking at)
      if (this.#bridge) {
        const moduleCtx = this.#bridge.buildContextForPrompt();
        if (moduleCtx) contextParts.push('', moduleCtx);
      }

      systemPrompt = contextParts.join('\n');
    }

    try {
      this.#runner = new AgentRunner(this.api, this.cache, this.#settings,
        this.#toolExecutor, this.#toolRegistry, {
          onStep: (step) => { timeline.updateStep(step); this._scrollChat(); },
          onLog: (tag, summary, detail) => this._log(tag, summary, detail),
        });

      const result = await this.#runner.run(systemPrompt, userPrompt, priorHistory);
      this.#runner = null;
      this.#sendBtn.textContent = 'Send';

      this._log('META', `Agent finished \u2014 status: ${result?.status}`);
      this.#sessionManager.addMessage({ type: 'agent', text: result?.reasoning || `Status: ${result?.status}` });
      this.#sessionManager.save();

      if (result.status === 'done') {
        const res = result.result || {};
        // Check if result contains view XML (backward compat with view operations)
        if (res.layoutxml && res.fetchxml) {
          const currentState = this.#activeOp.currentState;
          const output = { layoutxml: res.layoutxml, fetchxml: res.fetchxml };
          this._renderDiffInMessage(agentMsg, output, currentState);
          this._renderActionsInMessage(agentMsg, output);
        } else {
          // Render reasoning as the main response (Markdown)
          // The reasoning is ONLY shown here, not in the timeline thinking step (that only shows for intermediate steps)
          const reasoning = result.reasoning || res.reasoning || '';
          if (reasoning) {
            const contentEl = document.createElement('div');
            contentEl.className = `${CSS}-agent-content`;
            contentEl.innerHTML = this._renderMarkdown(reasoning);
            agentMsg.bubble.appendChild(contentEl);
          }
        }
      } else if (result.status === 'error') {
        agentMsg.statusLine.textContent = `\u2717 ${result.error}`;
        agentMsg.statusLine.style.color = 'var(--color-error)';
        this._log('ERR', result.error);
      }
    } catch (err) {
      this._log('ERR', `Request failed: ${err.message}`);
      agentMsg.statusLine.textContent = `\u2717 ${err.message}`;
      agentMsg.statusLine.style.color = 'var(--color-error)';
      this.#runner = null;
      this.#sendBtn.textContent = 'Send';
    }
  }

  // =========================================================================
  // Tool Confirmation UI
  // =========================================================================

  // =========================================================================
  // Content Rendering
  // =========================================================================

  /**
   * Simple Markdown → HTML renderer.
   * Supports: bold, inline code, headings, list items, newlines.
   */
  _renderMarkdown(md) {
    if (!md) return '';
    return md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<strong style="font-size:0.82rem;">$1</strong><br>')
      .replace(/^## (.+)$/gm, '<strong style="font-size:0.88rem;">$1</strong><br>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '&nbsp;&nbsp;\u2022 $1<br>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  _escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Show a confirmation dialog for a tool call. Returns a promise that resolves
   * to true (approved) or false (rejected).
   */
  _showConfirmation(tool, params, reasoning) {
    return new Promise((resolve) => {
      const container = document.createElement('div');
      container.className = `${CSS}-confirm`;

      container.innerHTML = `
        <div class="${CSS}-confirm-header">
          <span class="${CSS}-confirm-icon">\u26A0</span>
          <span class="${CSS}-confirm-title">Tool: ${tool.name}</span>
        </div>
        <pre class="${CSS}-confirm-params">${JSON.stringify(params, null, 2)}</pre>
        ${reasoning ? `<div class="${CSS}-confirm-reasoning">${reasoning}</div>` : ''}
        <div class="${CSS}-confirm-actions"></div>
      `;

      const actions = container.querySelector(`.${CSS}-confirm-actions`);

      const approveBtn = document.createElement('button');
      approveBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
      approveBtn.textContent = 'Approve';
      approveBtn.addEventListener('click', () => { container.remove(); resolve(true); });

      const rejectBtn = document.createElement('button');
      rejectBtn.className = `${CSS}-btn ${CSS}-btn-danger`;
      rejectBtn.textContent = 'Reject';
      rejectBtn.addEventListener('click', () => { container.remove(); resolve(false); });

      const alwaysBtn = document.createElement('button');
      alwaysBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
      alwaysBtn.textContent = 'Always approve';
      if (tool.autoApprovable) {
        alwaysBtn.addEventListener('click', () => {
          this.#toolExecutor.setAutoApprove(tool.id, true);
          container.remove();
          resolve(true);
        });
      } else {
        alwaysBtn.disabled = true;
        alwaysBtn.title = 'This tool cannot be auto-approved';
      }

      actions.append(approveBtn, rejectBtn, alwaysBtn);

      // Insert into the chat area (at the bottom, before input)
      this.#chatArea.appendChild(container);
      this._scrollChat();
    });
  }

  // =========================================================================
  // Diff + Actions (inside agent message)
  // =========================================================================

  _renderDiffInMessage(agentMsg, output, baselineState) {
    const { diffEl } = agentMsg;
    diffEl.style.display = '';
    diffEl.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = `${CSS}-diff-header`;
    const title = document.createElement('span');
    title.className = `${CSS}-diff-title`;
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    fullscreenBtn.textContent = 'Fullscreen';
    fullscreenBtn.addEventListener('click', () => {
      diffEl.classList.toggle(`${CSS}-diff-fullscreen`);
      if (diffEl.classList.contains(`${CSS}-diff-fullscreen`)) {
        const onEsc = (e) => { if (e.key === 'Escape') { diffEl.classList.remove(`${CSS}-diff-fullscreen`); document.removeEventListener('keydown', onEsc); } };
        document.addEventListener('keydown', onEsc);
      }
    });
    header.append(title, fullscreenBtn);

    // Body with sections
    const body = document.createElement('div');
    body.className = `${CSS}-diff-body`;

    const makeSec = (label, beforeXml, afterXml) => {
      const sec = document.createElement('div');
      sec.className = `${CSS}-diff-section`;
      const secTitle = document.createElement('div');
      secTitle.className = `${CSS}-diff-section-title`;
      secTitle.innerHTML = `<span>${label}</span>`;
      const copyBtn = document.createElement('button');
      copyBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => { navigator.clipboard.writeText(afterXml).then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); }); });
      secTitle.appendChild(copyBtn);
      const secBody = document.createElement('div');
      sec.append(secTitle, secBody);
      body.appendChild(sec);
      return renderXmlDiff(beforeXml, afterXml, secBody);
    };

    const lStats = makeSec('layoutxml', baselineState.layoutxml, output.layoutxml);
    const fStats = makeSec('fetchxml', baselineState.fetchxml, output.fetchxml);
    title.textContent = `Changes \u2014 +${lStats.added + fStats.added} / -${lStats.removed + fStats.removed}`;

    diffEl.append(header, body);
    this._log('DIFF', `${lStats.added + fStats.added} added, ${lStats.removed + fStats.removed} removed`);
    this._scrollChat();
  }

  _renderActionsInMessage(agentMsg, output) {
    const { actionBar, statusLine } = agentMsg;
    actionBar.style.display = '';
    actionBar.innerHTML = '';

    const applyBtn = document.createElement('button');
    applyBtn.className = `${CSS}-btn ${CSS}-btn-primary`;
    applyBtn.textContent = 'Apply & Publish';
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying...';
      this._log('META', 'Applying changes...');
      try {
        const result = await this.#activeOp.apply(output, true, (tag, s, d) => this._log(tag, s, d));
        if (result.success) {
          statusLine.textContent = '\u2713 Applied & Published \u2014 Ctrl+Shift+R to see changes';
          statusLine.style.color = 'var(--color-success)';
          actionBar.style.display = 'none';
          // Collapse diff after apply
          agentMsg.diffEl.style.display = 'none';
          this._log('META', 'Done \u2014 baseline updated for follow-up prompts');
        } else {
          statusLine.textContent = `\u2717 ${result.error}`;
          statusLine.style.color = 'var(--color-error)';
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply & Publish';
        }
      } catch (err) {
        this._log('ERR', err.message);
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply & Publish';
      }
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = `${CSS}-btn ${CSS}-btn-secondary`;
    copyBtn.textContent = 'Copy XML';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(`<!-- layoutxml -->\n${output.layoutxml}\n\n<!-- fetchxml -->\n${output.fetchxml}`);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy XML'; }, 1500);
    });

    actionBar.append(applyBtn, copyBtn);
    this._scrollChat();
  }

  // =========================================================================
  // Debug Console
  // =========================================================================

  _buildDebugConsole() {
    const consoleEl = document.createElement('div');
    consoleEl.className = `${CSS}-console ${CSS}-console-expanded`;

    const header = document.createElement('div');
    header.className = `${CSS}-console-header`;
    const chevron = document.createElement('span');
    chevron.className = `${CSS}-console-chevron`;
    chevron.textContent = '\u25BC';
    const title = document.createElement('span');
    title.className = `${CSS}-console-title`;
    title.textContent = 'Debug Console';

    const filters = document.createElement('div');
    filters.className = `${CSS}-console-filters`;
    for (const f of ['All', 'Prompts', 'API', 'Errors']) {
      const btn = document.createElement('button');
      btn.className = `${CSS}-console-filter${f === 'All' ? ` ${CSS}-console-filter-active` : ''}`;
      btn.textContent = f;
      btn.addEventListener('click', (e) => { e.stopPropagation(); this._setLogFilter(f.toLowerCase(), btn); });
      filters.appendChild(btn);
    }

    const actions = document.createElement('div');
    actions.className = `${CSS}-console-actions`;
    const copyBtn = document.createElement('button');
    copyBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    copyBtn.textContent = 'Copy Log';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); this._copyLog(copyBtn); });
    const clearBtn = document.createElement('button');
    clearBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); this._clearLog(); });
    actions.append(copyBtn, clearBtn);

    header.append(chevron, title, filters, actions);
    header.addEventListener('click', () => {
      this.#consoleExpanded = !this.#consoleExpanded;
      consoleEl.classList.toggle(`${CSS}-console-collapsed`, !this.#consoleExpanded);
      consoleEl.classList.toggle(`${CSS}-console-expanded`, this.#consoleExpanded);
      chevron.textContent = this.#consoleExpanded ? '\u25BC' : '\u25B6';
    });

    const body = document.createElement('div');
    body.className = `${CSS}-console-body`;
    this.#logContainer = document.createElement('div');
    this.#logContainer.className = `${CSS}-console-log`;
    this.#logContainer.addEventListener('scroll', () => {
      this.#autoScroll = (this.#logContainer.scrollHeight - this.#logContainer.scrollTop - this.#logContainer.clientHeight) < 30;
    });
    body.appendChild(this.#logContainer);

    consoleEl.append(header, body);
    this.container.appendChild(consoleEl);

    for (const entry of this.#debugLog) this._appendLogEntry(entry);
  }

  // =========================================================================
  // Logging
  // =========================================================================

  _log(tag, summary, detail = null) {
    // Handle session naming from the name_conversation tool
    if (tag === 'SESSION_NAME' && summary) {
      this.#sessionManager.rename(this.#sessionManager.activeId, summary);
      this.#sessionManager.save();
      if (this._sessionSelect) this._populateSessionSelect(this._sessionSelect);
      return; // Don't log to console
    }

    const entry = { time: new Date().toLocaleTimeString('de-DE', { hour12: false }), tag, summary, detail, expanded: false };
    this.#debugLog.push(entry);
    if (this.#debugLog.length > MAX_LOG_ENTRIES) this.#debugLog.shift();
    this._appendLogEntry(entry);
  }

  _appendLogEntry(entry) {
    if (!this.#logContainer) return;
    const visible = this._matchesFilter(entry.tag, this.#activeFilter);
    const row = document.createElement('div');
    row.className = `${CSS}-log-entry`;
    row.dataset.tag = entry.tag;
    if (!visible) row.style.display = 'none';

    row.innerHTML = `<span class="${CSS}-log-time">${entry.time}</span><span class="${CSS}-log-tag" style="color:var(${TAG_COLORS[entry.tag] || '--color-text-muted'})">[${entry.tag}]</span><span class="${CSS}-log-summary">${entry.summary}</span>`;

    if (entry.detail) {
      const expandBtn = document.createElement('button');
      expandBtn.className = `${CSS}-log-expand`;
      expandBtn.textContent = '\u25B6';
      const detail = document.createElement('pre');
      detail.className = `${CSS}-log-detail`;
      detail.textContent = entry.detail;
      detail.style.display = 'none';
      expandBtn.addEventListener('click', () => {
        entry.expanded = !entry.expanded;
        detail.style.display = entry.expanded ? '' : 'none';
        expandBtn.textContent = entry.expanded ? '\u25BC' : '\u25B6';
      });
      row.appendChild(expandBtn);
      this.#logContainer.append(row, detail);
    } else {
      this.#logContainer.appendChild(row);
    }

    if (this.#autoScroll) this.#logContainer.scrollTop = this.#logContainer.scrollHeight;
  }

  _matchesFilter(tag, filter) {
    if (filter === 'all') return true;
    if (filter === 'prompts') return tag === 'SEND' || tag === 'RECV';
    if (filter === 'api') return tag === 'WRITE' || tag === 'PUB' || tag === 'META';
    if (filter === 'errors') return tag === 'ERR' || tag === 'WARN';
    return true;
  }

  _setLogFilter(filter, activeBtn) {
    this.#activeFilter = filter;
    activeBtn.parentElement.querySelectorAll(`.${CSS}-console-filter`).forEach(b => b.classList.remove(`${CSS}-console-filter-active`));
    activeBtn.classList.add(`${CSS}-console-filter-active`);
    if (!this.#logContainer) return;
    for (const el of this.#logContainer.children) {
      const t = el.dataset?.tag;
      if (!t) continue;
      el.style.display = this._matchesFilter(t, filter) ? '' : 'none';
    }
  }

  _copyLog(btn) {
    navigator.clipboard.writeText(this.#debugLog.map(e => `${e.time} [${e.tag}] ${e.summary}`).join('\n'));
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Log'; }, 1500);
  }

  _clearLog() {
    this.#debugLog = [];
    if (this.#logContainer) this.#logContainer.innerHTML = '';
  }
}
