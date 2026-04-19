/**
 * Dataverse Toolkit - Main Application Bootstrap
 *
 * Initializes and orchestrates all side panel modules, manages tab navigation,
 * theming, keyboard shortcuts, modal/toast systems, and global event bus.
 *
 * @module app
 */

import { DataverseClient } from '../shared/api-client.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CSS_PREFIX = 'dvt-app';
const STORAGE_KEY_THEME = 'dvt-theme';
const STORAGE_KEY_SETTINGS = 'dvt-settings';

const THEMES = Object.freeze({
  DARK: 'dark',
  LIGHT: 'light',
  HIGH_CONTRAST: 'high-contrast',
});

const DEFAULT_SETTINGS = Object.freeze({
  theme: THEMES.DARK,
  cacheTTL: 3600000,
  defaultPageSize: 50,
  maxPageSize: 5000,
  aiProvider: '',
  aiEndpoint: '',
  aiApiKey: '',
  aiModel: '',
  aiMaxTokens: 4096,
  aiApiMode: 'responses',  // 'responses' (Responses API) or 'chat' (Chat Completions) — applies to OpenAI/Azure/Custom
  aiReasoning: '',         // '' (off) | 'low' | 'medium' | 'high' — Responses API only
  aiWebSearch: '',         // '' (off) | 'auto' | 'required' — Responses API only
});

const ALL_TABS = Object.freeze([
  { id: 'aicustomizer', label: 'Agent', icon: '\u2728', tip: 'Dataverse Agent — BYOK conversational AI with full plugin access' },
  { id: 'explorer', label: 'Explorer', icon: '\uD83D\uDD0D', tip: 'Browse tables, columns, relationships, solutions, and custom APIs' },
  { id: 'fetchxml', label: 'Query', icon: '\uD83D\uDCC4', tip: 'Visual FetchXML / OData query builder with code generation' },
  { id: 'request', label: 'Request', icon: '\u26A1', tip: 'Send raw Web API requests with autocomplete and response viewer' },
  { id: 'security', label: 'Security', icon: '\uD83D\uDD12', tip: 'Role privileges, user permissions, field-level security' },
  { id: 'erd', label: 'ERD', icon: '\uD83D\uDDFA\uFE0F', tip: 'Entity-relationship diagrams for any solution' },
  { id: 'bulk', label: 'Bulk Ops', icon: '\uD83D\uDCE6', tip: 'Batch operations: create, update, delete, assign, export/import' },
  { id: 'erdpro', label: 'ERD Pro', icon: '\uD83D\uDCD0', tip: 'Documentation-grade ERD with channel routing and print-ready export' },
  { id: 'toolbuilder', label: 'Tools', icon: '\uD83E\uDDE9', tip: 'Generate AI tool schemas (Claude/OpenAI/MCP) from entity metadata' },
  { id: 'formtools', label: 'Form', icon: '\uD83D\uDCCB', tip: 'Inspect and interact with the current form context' },
  { id: 'settings', label: 'Settings', icon: '\u2699\uFE0F', tip: 'Theme, cache, AI provider configuration' },
]);

const STORAGE_KEY_SIDEBAR = 'dvt-sidebar-pinned';

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const set = this._listeners.get(event);
    if (set) set.delete(callback);
  }

  emit(event, data) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    }
  }

  clear() {
    this._listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// Metadata Cache
// ---------------------------------------------------------------------------

class MetadataCache {
  constructor(ttl = DEFAULT_SETTINGS.cacheTTL) {
    this._store = new Map();
    this._ttl = ttl;
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttl) {
    this._store.set(key, {
      value,
      expiresAt: Date.now() + (ttl || this._ttl),
    });
  }

  remove(key) {
    this._store.delete(key);
  }

  clear() {
    this._store.clear();
    // Also clear background cache
    try {
      chrome.runtime.sendMessage({ type: 'CLEAR_CACHE', payload: {} });
    } catch { /* ignore */ }
  }

  setTTL(ttl) {
    this._ttl = ttl;
  }

  init(apiClient) {
    this._apiClient = apiClient;
  }

  async getEntities() {
    const cached = this.get('entities');
    if (cached) return cached;
    const response = await this._apiClient.request(
      'GET',
      'EntityDefinitions?$select=LogicalName,DisplayName,SchemaName,EntitySetName,' +
      'ObjectTypeCode,OwnershipType,PrimaryIdAttribute,PrimaryNameAttribute,' +
      'IsCustomEntity,IsActivity&$filter=IsPrivate eq false'
    );
    const entities = (response.value || []);
    entities.sort((a, b) => a.LogicalName.localeCompare(b.LogicalName));
    this.set('entities', entities);
    return entities;
  }

  async getAttributes(entityName) {
    const key = `attrs_${entityName}`;
    const cached = this.get(key);
    if (cached) return cached;
    const response = await this._apiClient.request(
      'GET',
      `EntityDefinitions(LogicalName='${entityName}')/Attributes?$select=` +
      'LogicalName,DisplayName,AttributeType,SchemaName,RequiredLevel,IsPrimaryId,IsPrimaryName,IsLogical,AttributeOf,IsValidForCreate'
    );
    const attrs = response.value || [];
    this.set(key, attrs);
    return attrs;
  }

  async getRelationships(entityName) {
    const key = `rels_${entityName}`;
    const cached = this.get(key);
    if (cached) return cached;
    const select = 'SchemaName,ReferencedEntity,ReferencingEntity,ReferencedAttribute,' +
      'ReferencingAttribute,ReferencedEntityNavigationPropertyName,ReferencingEntityNavigationPropertyName';
    const [n2o, o2n, n2n] = await Promise.all([
      this._apiClient.request('GET', `EntityDefinitions(LogicalName='${entityName}')/ManyToOneRelationships?$select=${select}`),
      this._apiClient.request('GET', `EntityDefinitions(LogicalName='${entityName}')/OneToManyRelationships?$select=${select}`),
      this._apiClient.request('GET', `EntityDefinitions(LogicalName='${entityName}')/ManyToManyRelationships?$select=SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName`),
    ]);
    const result = {
      ManyToOne: n2o.value || [],
      OneToMany: o2n.value || [],
      ManyToMany: n2n.value || [],
    };
    this.set(key, result);
    return result;
  }

  async getOptionSet(entityName, attrName) {
    const key = `opts_${entityName}_${attrName}`;
    const cached = this.get(key);
    if (cached) return cached;

    // Try each type-cast — Picklist, State, Status have different OData types
    const casts = [
      'Microsoft.Dynamics.CRM.PicklistAttributeMetadata',
      'Microsoft.Dynamics.CRM.StateAttributeMetadata',
      'Microsoft.Dynamics.CRM.StatusAttributeMetadata',
      'Microsoft.Dynamics.CRM.MultiSelectPicklistAttributeMetadata',
    ];
    let options = [];
    for (const cast of casts) {
      try {
        const response = await this._apiClient.request(
          'GET',
          `EntityDefinitions(LogicalName='${entityName}')/Attributes(LogicalName='${attrName}')/${cast}?$select=OptionSet`
        );
        options = response.OptionSet?.Options || [];
        if (options.length) break;
      } catch { /* wrong cast — try next */ }
    }
    this.set(key, options);
    return options;
  }
}

// ---------------------------------------------------------------------------
// DataverseToolkit - Main Application
// ---------------------------------------------------------------------------

class DataverseToolkit {
  constructor() {
    this.api = new DataverseClient();
    this.cache = new MetadataCache();
    this.cache.init(this.api);
    this.events = new EventBus();

    this._activeTab = 'explorer'; // updated after settings load
    this._modules = {};
    this._moduleLoaders = {};
    this._connected = false;
    this._environment = null;
    this._settings = { ...DEFAULT_SETTINGS };
    this._toastQueue = [];
    this._modalStack = [];
    this._pageUrl = null;
    this._sidebarPinned = false;

    this._root = null;
    this._sidebar = null;
    this._tabContent = null;
    this._statusBar = null;
  }

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------

  async init() {
    await this._loadSettings();
    // AI-first: default to Agent tab when AI is configured
    const hasAi = this._settings.aiProvider && this._settings.aiApiKey;
    this._activeTab = hasAi ? 'aicustomizer' : 'explorer';
    // Restore sidebar pin state
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY_SIDEBAR);
      this._sidebarPinned = !!r[STORAGE_KEY_SIDEBAR];
    } catch { /* ignore */ }
    this._applyTheme(this._settings.theme);
    this._buildShell();
    this._attachKeyboardShortcuts();
    await this._checkConnection();

    // Easter eggs — lazy-loaded, zero impact on normal flow
    import('./modules/easter-eggs.js').then(ee => {
      this._ee = ee;
      ee.initKonamiListener();
      ee.checkTimeAchievements();
    }).catch(() => {});

    // Set up periodic connection checks
    setInterval(() => this._checkConnection(), 30000);

    // Listen for environment changes and page navigation from the background
    chrome.runtime?.onMessage?.addListener((message) => {
      if (message.type === 'ENV_CHANGED') {
        this._checkConnection();
      }
      if (message.type === 'PAGE_CHANGED') {
        this._pageUrl = message.url || null;
        const mod = this._modules.formtools;
        if (mod && typeof mod.onPageChanged === 'function') {
          mod.onPageChanged();
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // Connection management
  // -----------------------------------------------------------------------

  async _checkConnection() {
    try {
      const env = await this.api.getEnvironment();
      if (env?.url) {
        this._connected = true;
        this._environment = env;
        this._updateConnectionStatus(true, env);
        this.events.emit('connected', env);
        // Capture current page URL from the active Dynamics 365 tab
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.url?.includes('.dynamics.com')) this._pageUrl = tab.url;
        } catch { /* side panel may not have tabs permission context */ }
        // Auto-load the active tab on first connection
        if (!this._modules[this._activeTab]) {
          this._initModule(this._activeTab);
        }
      } else {
        this._setDisconnected();
      }
    } catch {
      this._setDisconnected();
    }
  }

  _setDisconnected() {
    this._connected = false;
    this._environment = null;
    this._updateConnectionStatus(false);
    this.events.emit('disconnected');
  }

  _updateConnectionStatus(connected, env) {
    if (!this._statusBar) return;
    const indicator = this._statusBar.querySelector(`.${CSS_PREFIX}-status-indicator`);
    const label = this._statusBar.querySelector(`.${CSS_PREFIX}-status-label`);

    if (indicator) {
      indicator.className = `${CSS_PREFIX}-status-indicator ${connected ? 'connected' : 'disconnected'}`;
    }
    if (label) {
      label.textContent = connected
        ? `${env.orgName || 'Connected'} - ${env.url}`
        : 'Not connected';
      label.title = connected ? env.url : '';
    }

    // Show/hide welcome screen
    const welcome = this._root?.querySelector(`.${CSS_PREFIX}-welcome`);
    const tabContent = this._tabContent;
    if (welcome && tabContent) {
      welcome.style.display = connected ? 'none' : 'flex';
      tabContent.style.display = connected ? 'block' : 'none';
    }
  }

  // -----------------------------------------------------------------------
  // Shell UI construction
  // -----------------------------------------------------------------------

  _buildShell() {
    const root = document.getElementById('app') || document.body;
    this._root = root;
    root.className = `${CSS_PREFIX}-shell`;
    root.innerHTML = '';

    // Header
    root.appendChild(this._buildHeader());

    // Main content area — sidebar + content in a row
    const main = document.createElement('div');
    main.className = `${CSS_PREFIX}-main`;

    // Sidebar (VS Code-style icon rail)
    this._sidebar = this._buildSidebar();
    main.appendChild(this._sidebar);

    // Content wrapper (tab content + welcome)
    const contentWrap = document.createElement('div');
    contentWrap.className = `${CSS_PREFIX}-content-wrap`;

    const tabContent = document.createElement('div');
    tabContent.className = `${CSS_PREFIX}-tab-content`;
    this._tabContent = tabContent;
    contentWrap.appendChild(tabContent);

    // Welcome screen (shown when disconnected)
    contentWrap.appendChild(this._buildWelcomeScreen());

    main.appendChild(contentWrap);
    root.appendChild(main);

    // Quick chat bar (only if AI configured)
    this._quickChatBar = this._buildQuickChatBar();
    if (this._quickChatBar) root.appendChild(this._quickChatBar);

    // Status bar
    root.appendChild(this._buildStatusBar());

    // Toast container
    const toastContainer = document.createElement('div');
    toastContainer.className = `${CSS_PREFIX}-toast-container`;
    toastContainer.id = 'toast-container';
    root.appendChild(toastContainer);

    // Modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.className = `${CSS_PREFIX}-modal-overlay`;
    modalOverlay.id = 'modal-overlay';
    modalOverlay.style.display = 'none';
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) this.closeModal();
    });
    root.appendChild(modalOverlay);

    this._injectStyles();

    // Activate default tab
    this._switchTab(this._activeTab);
  }

  _buildHeader() {
    const header = document.createElement('div');
    header.className = `${CSS_PREFIX}-header`;

    const title = document.createElement('div');
    title.className = `${CSS_PREFIX}-header-title`;
    title.innerHTML = `<span class="${CSS_PREFIX}-logo">DV</span> Dataverse Toolkit`;
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = `${CSS_PREFIX}-header-actions`;

    // Theme toggle
    const themeBtn = document.createElement('button');
    themeBtn.className = `${CSS_PREFIX}-icon-btn`;
    themeBtn.title = 'Toggle theme';
    themeBtn.textContent = this._settings.theme === THEMES.DARK ? '\u2600' : '\u263D';
    themeBtn.addEventListener('click', () => this._cycleTheme(themeBtn));
    actions.appendChild(themeBtn);

    header.appendChild(actions);
    return header;
  }

  /** Returns tab groups based on AI configuration. */
  _getTabGroups() {
    const hasAi = this._settings.aiProvider && this._settings.aiApiKey;
    return {
      primary: hasAi
        ? ['aicustomizer', 'explorer', 'fetchxml']
        : ['explorer', 'fetchxml', 'request'],
      secondary: hasAi
        ? ['request', 'security', 'erd']
        : ['security', 'erd', 'aicustomizer'],
      tertiary: ['bulk', 'erdpro', 'toolbuilder', 'formtools'],
      pinned: ['settings'],
    };
  }

  /** Returns flat ordered list of all tab IDs for keyboard shortcuts. */
  _getOrderedTabIds() {
    const g = this._getTabGroups();
    return [...g.primary, ...g.secondary, ...g.tertiary, ...g.pinned];
  }

  _buildSidebar() {
    const nav = document.createElement('nav');
    nav.className = `${CSS_PREFIX}-sidebar${this._sidebarPinned ? ' pinned' : ''}`;

    this._populateSidebar(nav);
    return nav;
  }

  _populateSidebar(nav) {
    nav.innerHTML = '';
    const groups = this._getTabGroups();
    const hasAi = this._settings.aiProvider && this._settings.aiApiKey;
    const tabMap = Object.fromEntries(ALL_TABS.map(t => [t.id, t]));
    let shortcutIdx = 1;

    const addItem = (id, group) => {
      const tab = tabMap[id];
      if (!tab) return;
      const btn = document.createElement('button');
      const isActive = id === this._activeTab;
      const isAgent = id === 'aicustomizer';
      let cls = `${CSS_PREFIX}-sidebar-item`;
      if (isActive) cls += ' active';
      if (group === 'tertiary') cls += ' tertiary';
      if (isAgent && !hasAi && group === 'secondary') cls += ' unconfigured';
      if (isAgent && hasAi) cls += ' agent-glow';
      btn.className = cls;
      btn.dataset.tab = id;
      const sc = shortcutIdx <= 9 ? ` (Ctrl+${shortcutIdx})` : '';
      btn.title = `${tab.tip || tab.label}${sc}`;
      btn.innerHTML = `<span class="${CSS_PREFIX}-sidebar-icon">${tab.icon}</span><span class="${CSS_PREFIX}-sidebar-label">${tab.label}</span>`;
      btn.addEventListener('click', () => this._switchTab(id));
      nav.appendChild(btn);
      shortcutIdx++;
    };

    const addSep = () => {
      const sep = document.createElement('div');
      sep.className = `${CSS_PREFIX}-sidebar-sep`;
      nav.appendChild(sep);
    };

    // Pin toggle
    const pin = document.createElement('button');
    pin.className = `${CSS_PREFIX}-sidebar-pin`;
    pin.title = this._sidebarPinned ? 'Collapse sidebar' : 'Pin sidebar open';
    pin.textContent = this._sidebarPinned ? '\u00AB' : '\u00BB'; // « / »
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      this._sidebarPinned = !this._sidebarPinned;
      nav.classList.toggle('pinned', this._sidebarPinned);
      pin.textContent = this._sidebarPinned ? '\u00AB' : '\u00BB';
      pin.title = this._sidebarPinned ? 'Collapse sidebar' : 'Pin sidebar open';
      chrome.storage.local.set({ [STORAGE_KEY_SIDEBAR]: this._sidebarPinned }).catch(() => {});
    });
    nav.appendChild(pin);

    // Primary group
    for (const id of groups.primary) addItem(id, 'primary');
    addSep();

    // Secondary group
    for (const id of groups.secondary) addItem(id, 'secondary');
    addSep();

    // Tertiary group
    for (const id of groups.tertiary) addItem(id, 'tertiary');

    // Settings — pinned to bottom
    const spacer = document.createElement('div');
    spacer.className = `${CSS_PREFIX}-sidebar-spacer`;
    nav.appendChild(spacer);
    addItem('settings', 'pinned');
  }

  /** Rebuild sidebar when AI settings change (e.g., key added/removed). */
  _rebuildSidebar() {
    if (!this._sidebar) return;
    this._populateSidebar(this._sidebar);
  }

  _buildStatusBar() {
    const bar = document.createElement('div');
    bar.className = `${CSS_PREFIX}-status-bar`;
    this._statusBar = bar;

    const status = document.createElement('div');
    status.className = `${CSS_PREFIX}-status`;
    status.innerHTML = `
      <span class="${CSS_PREFIX}-status-indicator disconnected"></span>
      <span class="${CSS_PREFIX}-status-label">Checking connection...</span>
    `;
    bar.appendChild(status);

    const version = document.createElement('span');
    version.className = `${CSS_PREFIX}-version`;
    version.textContent = 'v1.0.0';
    bar.appendChild(version);

    return bar;
  }

  // -----------------------------------------------------------------------
  // Quick Chat Bar — persistent AI input on every tab
  // -----------------------------------------------------------------------

  _buildQuickChatBar() {
    if (!this._settings.aiProvider || !this._settings.aiApiKey) return null;

    const bar = document.createElement('div');
    bar.className = `${CSS_PREFIX}-quick-chat`;

    const icon = document.createElement('span');
    icon.className = `${CSS_PREFIX}-quick-chat-icon`;
    icon.textContent = '\u2728'; // ✨
    bar.appendChild(icon);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = `${CSS_PREFIX}-quick-chat-input`;
    input.placeholder = 'Ask AI...';
    input.setAttribute('aria-label', 'Ask AI');
    this._quickChatInput = input;
    bar.appendChild(input);

    const hint = document.createElement('span');
    hint.className = `${CSS_PREFIX}-quick-chat-hint`;
    hint.textContent = 'Ctrl+I';
    bar.appendChild(hint);

    const sendBtn = document.createElement('button');
    sendBtn.className = `${CSS_PREFIX}-quick-chat-send`;
    sendBtn.textContent = '\u2192'; // →
    sendBtn.title = 'Send to AI';
    bar.appendChild(sendBtn);

    // Focus expands, blur collapses (if empty)
    input.addEventListener('focus', () => bar.classList.add('expanded'));
    input.addEventListener('blur', () => {
      if (!input.value.trim()) bar.classList.remove('expanded');
    });

    // Send on Enter
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) {
        e.preventDefault();
        this._sendQuickChat(input.value.trim());
        input.value = '';
        input.blur();
        bar.classList.remove('expanded');
      }
      if (e.key === 'Escape') {
        input.value = '';
        input.blur();
        bar.classList.remove('expanded');
      }
    });

    sendBtn.addEventListener('click', () => {
      if (input.value.trim()) {
        this._sendQuickChat(input.value.trim());
        input.value = '';
        input.blur();
        bar.classList.remove('expanded');
      }
    });

    // Hide bar when AI tab is active (it has its own input)
    this.events.on('tab-changed', (tabId) => {
      bar.style.display = tabId === 'aicustomizer' ? 'none' : '';
    });

    return bar;
  }

  _sendQuickChat(message) {
    // Switch to AI tab with the message as context
    this.switchTab('aicustomizer', { quickChatMessage: message });
  }

  /** Update quick chat bar visibility based on settings. */
  _updateQuickChatBar() {
    const hasAi = this._settings.aiProvider && this._settings.aiApiKey;
    if (hasAi && !this._quickChatBar) {
      this._quickChatBar = this._buildQuickChatBar();
      if (this._quickChatBar) {
        // Insert before status bar
        this._statusBar?.parentNode?.insertBefore(this._quickChatBar, this._statusBar);
      }
    } else if (!hasAi && this._quickChatBar) {
      this._quickChatBar.remove();
      this._quickChatBar = null;
    }
  }

  _buildWelcomeScreen() {
    const welcome = document.createElement('div');
    welcome.className = `${CSS_PREFIX}-welcome`;

    welcome.innerHTML = `
      <div class="${CSS_PREFIX}-welcome-content">
        <div class="${CSS_PREFIX}-welcome-logo">DV</div>
        <h2>Welcome to Dataverse Toolkit</h2>
        <p>Navigate to a Dynamics 365 or Power Platform environment to get started.</p>
        <div class="${CSS_PREFIX}-welcome-steps">
          <div class="${CSS_PREFIX}-welcome-step">
            <span class="${CSS_PREFIX}-step-num">1</span>
            <span>Open a Dynamics 365 / Power Apps page in another tab</span>
          </div>
          <div class="${CSS_PREFIX}-welcome-step">
            <span class="${CSS_PREFIX}-step-num">2</span>
            <span>Sign in to your environment</span>
          </div>
          <div class="${CSS_PREFIX}-welcome-step">
            <span class="${CSS_PREFIX}-step-num">3</span>
            <span>Return here - the toolkit will connect automatically</span>
          </div>
        </div>
      </div>
    `;

    return welcome;
  }

  // -----------------------------------------------------------------------
  // Tab switching and lazy module initialization
  // -----------------------------------------------------------------------

  /**
   * Switch to a tab, optionally passing context for the module.
   * @param {string} tabId
   * @param {Object|null} context — passed to module.setContext() after render
   */
  switchTab(tabId, context = null) {
    if (!ALL_TABS.find((t) => t.id === tabId)) return;

    // Notify current module it's being hidden (pause timers etc.)
    if (this._activeTab && this._modules[this._activeTab]?.onHide) {
      try { this._modules[this._activeTab].onHide(); } catch { /* ignore */ }
    }

    this._activeTab = tabId;

    // Update sidebar active state
    this._sidebar?.querySelectorAll(`.${CSS_PREFIX}-sidebar-item`).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Clear content
    if (this._tabContent) {
      this._tabContent.innerHTML = '';
    }

    // Settings tab is special - always available
    if (tabId === 'settings') {
      this._renderSettingsPanel();
      return;
    }

    // For other tabs, require connection
    if (!this._connected) return;

    // Lazy-initialize module, then apply context
    this._initModule(tabId, context);

    this.events.emit('tab-changed', tabId);
  }

  /** Alias for internal callers. */
  _switchTab(tabId, context = null) {
    this.switchTab(tabId, context);
  }

  /** Get a cached module instance (or null if not yet loaded). */
  getModule(tabId) {
    return this._modules[tabId] || null;
  }

  /** Get the currently active tab ID. */
  getActiveTab() {
    return this._activeTab;
  }

  async _initModule(tabId, context = null) {
    if (!this._tabContent) return;

    // Reuse existing module if already loaded
    if (this._modules[tabId]) {
      const container = document.createElement('div');
      container.className = `${CSS_PREFIX}-module-container`;
      container.dataset.module = tabId;
      this._tabContent.appendChild(container);
      try {
        this._modules[tabId].container = container;
        this._modules[tabId].render();
        if (context && typeof this._modules[tabId].setContext === 'function') {
          this._modules[tabId].setContext(context);
        }
      } catch (err) {
        this._showError(container, `Failed to render module: ${err.message}`);
      }
      return;
    }

    const container = document.createElement('div');
    container.className = `${CSS_PREFIX}-module-container`;
    container.dataset.module = tabId;
    this._tabContent.appendChild(container);

    // Show loading state
    container.innerHTML = `<div class="${CSS_PREFIX}-placeholder"><p>Loading...</p></div>`;

    try {
      switch (tabId) {
        case 'explorer': {
          const { default: ApiExplorer } = await import('./modules/api-explorer.js');
          const module = new ApiExplorer(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'fetchxml': {
          const { default: FetchXmlBuilder } = await import('./modules/fetchxml-builder.js');
          const module = new FetchXmlBuilder(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'request': {
          const { default: RequestBuilder } = await import('./modules/request-builder.js');
          const module = new RequestBuilder(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'bulk': {
          const { default: BulkOperations } = await import('./modules/bulk-operations.js');
          const module = new BulkOperations(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'security': {
          const { default: SecurityInspector } = await import('./modules/security-inspector.js');
          const module = new SecurityInspector(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'erd': {
          const { default: ErdViewer } = await import('./modules/erd-viewer.js');
          const module = new ErdViewer(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'erdpro': {
          const { default: ErdPro } = await import('./modules/erd-pro.js');
          const module = new ErdPro(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'toolbuilder': {
          const { default: ToolBuilder } = await import('./modules/tool-builder.js');
          const module = new ToolBuilder(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'aicustomizer': {
          const { default: AiCustomizer } = await import('./modules/ai-customizer.js');
          const module = new AiCustomizer(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        case 'formtools': {
          const { default: FormTools } = await import('./modules/form-tools.js');
          const module = new FormTools(container, this.api, this.cache);
          module.render();
          this._modules[tabId] = module;
          break;
        }

        default:
          container.textContent = 'Unknown module.';
      }

      // Apply context to freshly-loaded module
      if (context && this._modules[tabId] && typeof this._modules[tabId].setContext === 'function') {
        this._modules[tabId].setContext(context);
      }
    } catch (err) {
      console.error(`[Dataverse Toolkit] Failed to load module "${tabId}":`, err);
      this._showError(container, `Failed to load module: ${err.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Settings Panel
  // -----------------------------------------------------------------------

  _renderSettingsPanel() {
    if (!this._tabContent) return;

    const container = document.createElement('div');
    container.className = `${CSS_PREFIX}-settings`;

    container.innerHTML = `
      <h3 class="${CSS_PREFIX}-settings-title">Settings</h3>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Theme</label>
        <select id="setting-theme" class="${CSS_PREFIX}-settings-select">
          <option value="dark"${this._settings.theme === 'dark' ? ' selected' : ''}>Dark</option>
          <option value="light"${this._settings.theme === 'light' ? ' selected' : ''}>Light</option>
          <option value="high-contrast"${this._settings.theme === 'high-contrast' ? ' selected' : ''}>High Contrast</option>
        </select>
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Metadata Cache TTL (minutes)</label>
        <input id="setting-cache-ttl" type="number" min="1" max="1440"
               class="${CSS_PREFIX}-settings-input"
               value="${Math.round(this._settings.cacheTTL / 60000)}" />
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Default Page Size</label>
        <input id="setting-page-size" type="number" min="1" max="5000"
               class="${CSS_PREFIX}-settings-input"
               value="${this._settings.defaultPageSize}" />
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Max Page Size</label>
        <input id="setting-max-page-size" type="number" min="1" max="5000"
               class="${CSS_PREFIX}-settings-input"
               value="${this._settings.maxPageSize}" />
      </div>

      <h3 class="${CSS_PREFIX}-settings-title" style="margin-top:20px;">AI Provider (BYOK)</h3>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Provider</label>
        <select id="setting-ai-provider" class="${CSS_PREFIX}-settings-select">
          <option value=""${!this._settings.aiProvider ? ' selected' : ''}>Not configured</option>
          <option value="openai"${this._settings.aiProvider === 'openai' ? ' selected' : ''}>OpenAI</option>
          <option value="azure"${this._settings.aiProvider === 'azure' ? ' selected' : ''}>Azure OpenAI</option>
          <option value="anthropic"${this._settings.aiProvider === 'anthropic' ? ' selected' : ''}>Anthropic (Claude)</option>
          <option value="custom"${this._settings.aiProvider === 'custom' ? ' selected' : ''}>Custom (OpenAI-compatible)</option>
        </select>
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Endpoint URL</label>
        <input id="setting-ai-endpoint" type="url" class="${CSS_PREFIX}-settings-input"
               value="${this._settings.aiEndpoint || ''}"
               placeholder="Full endpoint URL (see examples below)" />
        <small style="color:var(--color-text-muted);font-size:0.7rem;margin-top:2px;display:block;line-height:1.5;">
          Enter the complete URL to POST to. Examples:<br/>
          OpenAI: https://api.openai.com/v1/responses<br/>
          Azure: https://YOUR.openai.azure.com/openai/deployments/MODEL/responses?api-version=2025-04-01-preview<br/>
          Anthropic: https://api.anthropic.com/v1/messages
        </small>
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">API Key</label>
        <input id="setting-ai-key" type="password" class="${CSS_PREFIX}-settings-input"
               value="${this._settings.aiApiKey || ''}"
               placeholder="sk-... or your key" />
        <small style="color:var(--color-text-muted);font-size:0.7rem;margin-top:2px;display:block;">
          Stored locally in chrome.storage.local. Never sent to Dataverse.
        </small>
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Model</label>
        <input id="setting-ai-model" type="text" class="${CSS_PREFIX}-settings-input"
               value="${this._settings.aiModel || ''}"
               placeholder="gpt-4o / claude-sonnet-4-5-20250514 / ..." />
      </div>

      <div class="${CSS_PREFIX}-settings-group" id="ai-api-mode-group" style="display:${this._settings.aiProvider && this._settings.aiProvider !== 'anthropic' ? 'block' : 'none'};">
        <label class="${CSS_PREFIX}-settings-label">API Mode</label>
        <select id="setting-ai-api-mode" class="${CSS_PREFIX}-settings-select">
          <option value="responses"${this._settings.aiApiMode !== 'chat' ? ' selected' : ''}>Responses API</option>
          <option value="chat"${this._settings.aiApiMode === 'chat' ? ' selected' : ''}>Chat Completions</option>
        </select>
        <small style="color:var(--color-text-muted);font-size:0.7rem;margin-top:2px;display:block;">
          Responses API: /responses (default, newer) · Chat Completions: /chat/completions (legacy)
        </small>
      </div>

      <div class="${CSS_PREFIX}-settings-group" id="ai-reasoning-group" style="display:${this._settings.aiProvider && this._settings.aiProvider !== 'anthropic' && this._settings.aiApiMode !== 'chat' ? 'block' : 'none'};">
        <label class="${CSS_PREFIX}-settings-label">Reasoning</label>
        <div id="setting-ai-reasoning" style="display:flex;gap:4px;">
          ${['', 'low', 'medium', 'high'].map(v => {
            const label = v || 'off';
            const active = (this._settings.aiReasoning || '') === v;
            return `<button data-value="${v}" class="${CSS_PREFIX}-btn-secondary" style="flex:1;padding:4px 0;font-size:0.72rem;${active ? 'background:var(--color-accent);color:var(--color-bg);' : ''}">${label}</button>`;
          }).join('')}
        </div>
      </div>

      <div class="${CSS_PREFIX}-settings-group" id="ai-websearch-group" style="display:${this._settings.aiProvider && this._settings.aiProvider !== 'anthropic' && this._settings.aiApiMode !== 'chat' ? 'block' : 'none'};">
        <label class="${CSS_PREFIX}-settings-label">Web Search</label>
        <div id="setting-ai-websearch" style="display:flex;gap:4px;">
          ${['', 'auto', 'required'].map(v => {
            const label = v || 'off';
            const active = (this._settings.aiWebSearch || '') === v;
            return `<button data-value="${v}" class="${CSS_PREFIX}-btn-secondary" style="flex:1;padding:4px 0;font-size:0.72rem;${active ? 'background:var(--color-accent);color:var(--color-bg);' : ''}">${label}</button>`;
          }).join('')}
        </div>
      </div>

      <div class="${CSS_PREFIX}-settings-group" id="ai-endpoint-preview-group" style="display:none;">
        <label class="${CSS_PREFIX}-settings-label">Resulting API Endpoint</label>
        <code id="ai-endpoint-preview" style="display:block;padding:6px 8px;background:var(--color-bg-input);border:1px solid var(--color-border-subtle);border-radius:var(--radius-sm);font-size:0.72rem;color:var(--color-accent-secondary);word-break:break-all;"></code>
      </div>

      <div class="${CSS_PREFIX}-settings-actions">
        <button id="setting-save" class="${CSS_PREFIX}-btn-primary">Save Settings</button>
        <button id="setting-clear-cache" class="${CSS_PREFIX}-btn-secondary">Clear Metadata Cache</button>
        <button id="setting-reset" class="${CSS_PREFIX}-btn-secondary">Reset to Defaults</button>
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Keyboard Shortcuts</label>
        <div class="${CSS_PREFIX}-shortcuts-list">
          <div class="${CSS_PREFIX}-shortcut"><kbd>Ctrl+1</kbd> - <kbd>Ctrl+9</kbd> Switch tabs</div>
          <div class="${CSS_PREFIX}-shortcut"><kbd>Ctrl+Enter</kbd> Execute current query</div>
          <div class="${CSS_PREFIX}-shortcut"><kbd>Ctrl+Shift+F</kbd> Focus search</div>
          <div class="${CSS_PREFIX}-shortcut"><kbd>Escape</kbd> Close modals/panels</div>
        </div>
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <label class="${CSS_PREFIX}-settings-label">Easter Eggs</label>
        <div class="${CSS_PREFIX}-shortcuts-list">
          <div class="${CSS_PREFIX}-shortcut"><kbd>↑</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><kbd>←</kbd><kbd>→</kbd><kbd>B</kbd><kbd>A</kbd> Matrix Rain</div>
          <div class="${CSS_PREFIX}-shortcut">Double-click <kbd>🐍</kbd> in ERD tab → Snake</div>
        </div>
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <details id="ee-achievements-details">
          <summary class="${CSS_PREFIX}-settings-label" style="cursor:pointer; user-select:none;">Achievements <span id="ee-ach-count" style="font-weight:400;"></span></summary>
          <div id="ee-achievements-grid" style="margin-top:8px;"></div>
        </details>
      </div>

      <div class="${CSS_PREFIX}-settings-group">
        <details>
          <summary class="${CSS_PREFIX}-settings-label" style="cursor:pointer; user-select:none;">Clippy Quotes</summary>
          <div id="ee-clippy-list" style="margin-top:8px;"></div>
        </details>
      </div>
    `;

    // Attach event listeners
    container.querySelector('#setting-theme')?.addEventListener('change', (e) => {
      this._settings.theme = e.target.value;
      this._applyTheme(this._settings.theme);
    });

    // AI endpoint preview — updates live as provider/endpoint/mode change
    const _updateAiPreview = () => {
      const provider = container.querySelector('#setting-ai-provider')?.value || '';
      const apiMode = container.querySelector('#setting-ai-api-mode')?.value || 'responses';
      const endpoint = (container.querySelector('#setting-ai-endpoint')?.value || '').replace(/\/+$/, '');
      const previewGroup = container.querySelector('#ai-endpoint-preview-group');
      const previewCode = container.querySelector('#ai-endpoint-preview');
      const apiModeGroup = container.querySelector('#ai-api-mode-group');
      const reasoningGroup = container.querySelector('#ai-reasoning-group');
      const websearchGroup = container.querySelector('#ai-websearch-group');
      const showResponsesOptions = provider && provider !== 'anthropic' && apiMode !== 'chat';
      if (apiModeGroup) apiModeGroup.style.display = provider && provider !== 'anthropic' ? '' : 'none';
      if (reasoningGroup) reasoningGroup.style.display = showResponsesOptions ? '' : 'none';
      if (websearchGroup) websearchGroup.style.display = showResponsesOptions ? '' : 'none';
      if (!previewGroup || !previewCode) return;

      if (!provider || !endpoint) {
        previewGroup.style.display = 'none';
        return;
      }

      let auth;
      switch (provider) {
        case 'openai':
        case 'custom':
          auth = 'Authorization: Bearer <key>';
          break;
        case 'azure':
          auth = 'api-key: <key>';
          break;
        case 'anthropic':
          auth = 'x-api-key: <key>';
          break;
        default:
          auth = '';
      }

      previewCode.textContent = `POST ${endpoint} ${auth}`;
      previewGroup.style.display = '';
    };

    container.querySelector('#setting-ai-provider')?.addEventListener('change', _updateAiPreview);
    container.querySelector('#setting-ai-endpoint')?.addEventListener('input', _updateAiPreview);
    container.querySelector('#setting-ai-api-mode')?.addEventListener('change', _updateAiPreview);

    // Toggle buttons for reasoning effort
    const _setupToggle = (containerId, settingKey) => {
      const el = container.querySelector(`#${containerId}`);
      if (!el) return;
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn) return;
        this._settings[settingKey] = btn.dataset.value;
        el.querySelectorAll('button').forEach(b => {
          b.style.background = b === btn ? 'var(--color-accent)' : '';
          b.style.color = b === btn ? 'var(--color-bg)' : '';
        });
      });
    };
    _setupToggle('setting-ai-reasoning', 'aiReasoning');
    _setupToggle('setting-ai-websearch', 'aiWebSearch');

    _updateAiPreview(); // initial render

    container.querySelector('#setting-save')?.addEventListener('click', () => {
      const ttlInput = container.querySelector('#setting-cache-ttl');
      const pageSizeInput = container.querySelector('#setting-page-size');
      const maxPageInput = container.querySelector('#setting-max-page-size');

      this._settings.cacheTTL = (parseInt(ttlInput?.value, 10) || 60) * 60000;
      this._settings.defaultPageSize = parseInt(pageSizeInput?.value, 10) || 50;
      this._settings.maxPageSize = parseInt(maxPageInput?.value, 10) || 5000;

      // AI provider settings
      this._settings.aiProvider = container.querySelector('#setting-ai-provider')?.value || '';
      this._settings.aiEndpoint = container.querySelector('#setting-ai-endpoint')?.value?.replace(/\/+$/, '') || '';
      this._settings.aiApiKey = container.querySelector('#setting-ai-key')?.value || '';
      this._settings.aiModel = container.querySelector('#setting-ai-model')?.value || '';
      this._settings.aiApiMode = container.querySelector('#setting-ai-api-mode')?.value || 'responses';
      // aiReasoning and aiWebSearch are already set live by toggle buttons

      this.cache.setTTL(this._settings.cacheTTL);
      this._saveSettings();
      this.showToast('Settings saved.', 'success');
    });

    container.querySelector('#setting-clear-cache')?.addEventListener('click', () => {
      this.cache.clear();
      this.showToast('Metadata cache cleared.', 'success');
    });

    container.querySelector('#setting-reset')?.addEventListener('click', () => {
      this._settings = { ...DEFAULT_SETTINGS };
      this._applyTheme(this._settings.theme);
      this._saveSettings();
      this._renderSettingsPanel();
      this.showToast('Settings reset to defaults.', 'success');
    });

    this._tabContent.appendChild(container);

    // Lazy-load easter egg data into settings
    import('./modules/easter-eggs.js').then(ee => {
      // Achievements grid
      const achGrid = container.querySelector('#ee-achievements-grid');
      const achCount = container.querySelector('#ee-ach-count');
      if (achGrid) {
        ee.getAllAchievementsWithStatus().then(achievements => {
          const unlocked = achievements.filter(a => a.unlocked).length;
          if (achCount) achCount.textContent = `(${unlocked}/${achievements.length} unlocked)`;
          achGrid.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px;';
          for (const ach of achievements) {
            const card = document.createElement('div');
            card.style.cssText = `display:flex; align-items:flex-start; gap:6px; padding:6px 8px; border-radius:var(--radius-sm); border:1px solid var(--color-border-subtle); background:var(--color-bg-secondary); opacity:${ach.unlocked ? '1' : '0.35'};`;
            card.innerHTML = `<span style="font-size:1.1rem; line-height:1;">${ach.icon}</span><div><div style="font-size:0.75rem; font-weight:600; color:var(--color-text-primary);">${ach.title}</div><div style="font-size:0.68rem; color:var(--color-text-muted); line-height:1.3;">${ach.desc}</div></div>`;
            achGrid.appendChild(card);
          }
        });
      }

      // Clippy quotes list
      const clippyList = container.querySelector('#ee-clippy-list');
      if (clippyList) {
        const quotes = ee.getClippyQuotes();
        // Update the summary count
        const summary = clippyList.closest('details')?.querySelector('summary');
        if (summary) summary.textContent = `Clippy Quotes (${quotes.length})`;
        clippyList.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
        for (const q of quotes) {
          const row = document.createElement('div');
          row.style.cssText = 'font-size:0.72rem; padding:5px 8px; border-radius:var(--radius-sm); background:var(--color-bg-secondary); border:1px solid var(--color-border-subtle); color:var(--color-text-primary); line-height:1.4; white-space:pre-line;';
          row.innerHTML = `<span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-muted); margin-right:6px;">${q.trigger}</span>${q.text}`;
          clippyList.appendChild(row);
        }
      }
    }).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Theme management
  // -----------------------------------------------------------------------

  _applyTheme(theme) {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);

    // Set CSS custom properties based on theme
    const themes = {
      dark: {
        '--dvt-bg': '#1e1e1e',
        '--dvt-bg-secondary': '#252526',
        '--dvt-text': '#cccccc',
        '--dvt-text-secondary': '#969696',
        '--dvt-border': '#333333',
        '--dvt-accent': '#0078d4',
        '--dvt-accent-hover': '#106ebe',
        '--dvt-hover': '#2a2d35',
        '--dvt-input-bg': '#2d2d2d',
        '--dvt-section-bg': '#252525',
        '--dvt-muted': '#888888',
        '--dvt-row-border': '#2a2a2a',
        '--dvt-success': '#4ec9b0',
        '--dvt-warning': '#dcdcaa',
        '--dvt-error': '#f48771',
        '--dvt-code-bg': '#1e1e1e',
        '--dvt-selected': '#094771',
      },
      light: {
        '--dvt-bg': '#ffffff',
        '--dvt-bg-secondary': '#f3f3f3',
        '--dvt-text': '#1e1e1e',
        '--dvt-text-secondary': '#616161',
        '--dvt-border': '#e0e0e0',
        '--dvt-accent': '#0078d4',
        '--dvt-accent-hover': '#106ebe',
        '--dvt-hover': '#f0f6ff',
        '--dvt-input-bg': '#f9f9f9',
        '--dvt-section-bg': '#f5f5f5',
        '--dvt-muted': '#999999',
        '--dvt-row-border': '#f0f0f0',
        '--dvt-success': '#107c10',
        '--dvt-warning': '#c19c00',
        '--dvt-error': '#e81123',
        '--dvt-code-bg': '#f5f5f5',
        '--dvt-selected': '#d6ebff',
      },
      'high-contrast': {
        '--dvt-bg': '#000000',
        '--dvt-bg-secondary': '#1a1a1a',
        '--dvt-text': '#ffffff',
        '--dvt-text-secondary': '#cccccc',
        '--dvt-border': '#6fc3df',
        '--dvt-accent': '#1aebff',
        '--dvt-accent-hover': '#23d8f0',
        '--dvt-hover': '#1a1a2e',
        '--dvt-input-bg': '#0a0a0a',
        '--dvt-section-bg': '#111111',
        '--dvt-muted': '#aaaaaa',
        '--dvt-row-border': '#333333',
        '--dvt-success': '#00ff00',
        '--dvt-warning': '#ffff00',
        '--dvt-error': '#ff0000',
        '--dvt-code-bg': '#0a0a0a',
        '--dvt-selected': '#0c3668',
      },
    };

    const vars = themes[theme] || themes.dark;
    for (const [prop, val] of Object.entries(vars)) {
      root.style.setProperty(prop, val);
    }
  }

  _cycleTheme(btn) {
    const order = [THEMES.DARK, THEMES.LIGHT, THEMES.HIGH_CONTRAST];
    const idx = order.indexOf(this._settings.theme);
    this._settings.theme = order[(idx + 1) % order.length];
    this._applyTheme(this._settings.theme);
    this._saveSettings();
    btn.textContent = this._settings.theme === THEMES.DARK ? '\u2600' : '\u263D';
    this.showToast(`Theme: ${this._settings.theme}`, 'info');
  }

  // -----------------------------------------------------------------------
  // Settings persistence
  // -----------------------------------------------------------------------

  async _loadSettings() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
      if (result[STORAGE_KEY_SETTINGS]) {
        this._settings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY_SETTINGS] };
      }
    } catch {
      // Use defaults
    }
  }

  async _saveSettings() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: this._settings });
      this._updateQuickChatBar();
      this._rebuildSidebar();
    } catch {
      // Ignore storage errors
    }
  }

  // -----------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------

  _attachKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+1-9: Switch tabs (ordered by sidebar groups)
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const num = parseInt(e.key, 10);
        const ordered = this._getOrderedTabIds();
        if (num >= 1 && num <= Math.min(9, ordered.length)) {
          e.preventDefault();
          this._switchTab(ordered[num - 1]);
          return;
        }
      }

      // Ctrl+Enter: Execute current query/request
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this.events.emit('execute');
        return;
      }

      // Ctrl+Shift+F: Focus search
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        this.events.emit('focus-search');
        return;
      }

      // Ctrl+I: Focus quick chat bar
      if (e.ctrlKey && !e.shiftKey && e.key === 'i') {
        if (this._quickChatInput) {
          e.preventDefault();
          this._quickChatInput.focus();
          return;
        }
      }

      // Escape: Close modals/panels
      if (e.key === 'Escape') {
        if (this._modalStack.length > 0) {
          e.preventDefault();
          this.closeModal();
        }
        this.events.emit('escape');
      }
    });
  }

  // -----------------------------------------------------------------------
  // Toast notification system
  // -----------------------------------------------------------------------

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} [type='info']
   * @param {number} [duration=3000]
   */
  showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `${CSS_PREFIX}-toast ${CSS_PREFIX}-toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
      toast.classList.remove('visible');
      toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
  }

  // -----------------------------------------------------------------------
  // Modal system
  // -----------------------------------------------------------------------

  /**
   * Show a modal dialog.
   * @param {Object} options
   * @param {string} options.title
   * @param {string|HTMLElement} options.content
   * @param {Array<{label: string, action: Function, primary?: boolean}>} [options.buttons]
   * @returns {HTMLElement} The modal element
   */
  showModal({ title, content, buttons }) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return null;

    const modal = document.createElement('div');
    modal.className = `${CSS_PREFIX}-modal`;

    const header = document.createElement('div');
    header.className = `${CSS_PREFIX}-modal-header`;
    header.innerHTML = `<h3>${title}</h3>`;

    const closeBtn = document.createElement('button');
    closeBtn.className = `${CSS_PREFIX}-modal-close`;
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => this.closeModal());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = `${CSS_PREFIX}-modal-body`;
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      body.appendChild(content);
    }
    modal.appendChild(body);

    if (buttons && buttons.length > 0) {
      const footer = document.createElement('div');
      footer.className = `${CSS_PREFIX}-modal-footer`;

      for (const btn of buttons) {
        const button = document.createElement('button');
        button.className = btn.primary ? `${CSS_PREFIX}-btn-primary` : `${CSS_PREFIX}-btn-secondary`;
        button.textContent = btn.label;
        button.addEventListener('click', () => {
          if (btn.action) btn.action();
          this.closeModal();
        });
        footer.appendChild(button);
      }

      modal.appendChild(footer);
    }

    overlay.innerHTML = '';
    overlay.appendChild(modal);
    overlay.style.display = 'flex';
    this._modalStack.push(modal);

    return modal;
  }

  closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    this._modalStack.pop();
    if (this._modalStack.length === 0) {
      overlay.style.display = 'none';
      overlay.innerHTML = '';
    }
  }

  // -----------------------------------------------------------------------
  // Error boundary
  // -----------------------------------------------------------------------

  _showError(container, message) {
    const errorEl = document.createElement('div');
    errorEl.className = `${CSS_PREFIX}-error-boundary`;
    errorEl.innerHTML = `
      <h4>Something went wrong</h4>
      <p>${message}</p>
      <button class="${CSS_PREFIX}-btn-secondary">Retry</button>
    `;
    errorEl.querySelector('button')?.addEventListener('click', () => {
      container.innerHTML = '';
      this._switchTab(this._activeTab);
    });
    container.innerHTML = '';
    container.appendChild(errorEl);
  }

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById(`${CSS_PREFIX}-styles`)) return;

    const style = document.createElement('style');
    style.id = `${CSS_PREFIX}-styles`;
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      html, body {
        height: 100%;
        overflow: hidden;
      }

      .${CSS_PREFIX}-shell {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: var(--dvt-bg, #1e1e1e);
        color: var(--dvt-text, #ccc);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
      }

      /* Header */
      .${CSS_PREFIX}-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: var(--dvt-bg-secondary, #252526);
        border-bottom: 1px solid var(--dvt-border, #333);
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-header-title {
        font-weight: 600;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .${CSS_PREFIX}-logo {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: var(--dvt-accent, #0078d4);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        border-radius: 4px;
      }
      .${CSS_PREFIX}-header-actions {
        display: flex;
        gap: 4px;
      }
      .${CSS_PREFIX}-icon-btn {
        background: none;
        border: 1px solid transparent;
        color: var(--dvt-text, #ccc);
        font-size: 16px;
        padding: 4px 6px;
        cursor: pointer;
        border-radius: 4px;
        line-height: 1;
      }
      .${CSS_PREFIX}-icon-btn:hover {
        background: var(--dvt-hover, #2a2d35);
        border-color: var(--dvt-border, #444);
      }

      /* Main area — sidebar + content row */
      .${CSS_PREFIX}-main {
        flex: 1;
        display: flex;
        flex-direction: row;
        overflow: hidden;
        position: relative;
      }

      /* VS Code-style sidebar */
      .${CSS_PREFIX}-sidebar {
        display: flex;
        flex-direction: column;
        width: 38px;
        min-width: 38px;
        background: var(--dvt-bg-secondary, #252526);
        border-right: 1px solid var(--dvt-border, #333);
        flex-shrink: 0;
        overflow: hidden;
        transition: width 0.18s ease, min-width 0.18s ease;
        z-index: 20;
      }
      .${CSS_PREFIX}-sidebar:hover,
      .${CSS_PREFIX}-sidebar.pinned {
        width: 138px;
        min-width: 138px;
      }
      .${CSS_PREFIX}-sidebar-pin {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 22px;
        background: none;
        border: none;
        border-bottom: 1px solid var(--dvt-border, #333);
        color: var(--dvt-muted, #666);
        font-size: 12px;
        cursor: pointer;
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-sidebar-pin:hover {
        color: var(--dvt-text, #ccc);
        background: var(--dvt-hover, #2a2d35);
      }
      .${CSS_PREFIX}-sidebar-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 34px;
        padding: 0 0 0 9px;
        border: none;
        background: none;
        color: var(--dvt-muted, #888);
        font-size: 12px;
        cursor: pointer;
        border-left: 2px solid transparent;
        transition: color 0.12s, background 0.12s, border-color 0.12s;
        white-space: nowrap;
        overflow: hidden;
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-sidebar-item:hover {
        color: var(--dvt-text, #ccc);
        background: var(--dvt-hover, #2a2d35);
      }
      .${CSS_PREFIX}-sidebar-item.active {
        color: var(--dvt-text, #ccc);
        border-left-color: var(--dvt-accent, #0078d4);
        background: rgba(0,120,212,0.08);
      }
      .${CSS_PREFIX}-sidebar-item.tertiary {
        opacity: 0.6;
      }
      .${CSS_PREFIX}-sidebar-item.tertiary:hover {
        opacity: 1;
      }
      .${CSS_PREFIX}-sidebar-item.unconfigured {
        opacity: 0.4;
      }
      .${CSS_PREFIX}-sidebar-item.unconfigured::after {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--dvt-warning, #dcdcaa);
        flex-shrink: 0;
        margin-left: auto;
        margin-right: 10px;
      }
      .${CSS_PREFIX}-sidebar-item.agent-glow .${CSS_PREFIX}-sidebar-icon {
        filter: drop-shadow(0 0 4px var(--dvt-accent, #0078d4));
      }
      .${CSS_PREFIX}-sidebar-icon {
        font-size: 16px;
        width: 20px;
        text-align: center;
        flex-shrink: 0;
        line-height: 1;
      }
      .${CSS_PREFIX}-sidebar-label {
        opacity: 0;
        transition: opacity 0.12s ease 0.06s;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .${CSS_PREFIX}-sidebar:hover .${CSS_PREFIX}-sidebar-label,
      .${CSS_PREFIX}-sidebar.pinned .${CSS_PREFIX}-sidebar-label {
        opacity: 1;
      }
      .${CSS_PREFIX}-sidebar-sep {
        height: 1px;
        margin: 4px 8px;
        background: var(--dvt-border, #333);
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-sidebar-spacer {
        flex: 1;
      }

      /* Content wrapper */
      .${CSS_PREFIX}-content-wrap {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
        min-width: 0;
      }

      /* Tab content */
      .${CSS_PREFIX}-tab-content {
        flex: 1;
        overflow: hidden;
      }
      .${CSS_PREFIX}-module-container {
        height: 100%;
        overflow-y: auto;
      }

      /* Welcome screen */
      .${CSS_PREFIX}-welcome {
        display: flex;
        align-items: center;
        justify-content: center;
        position: absolute;
        inset: 0;
        z-index: 10;
        background: var(--dvt-bg, #1e1e1e);
      }
      .${CSS_PREFIX}-welcome-content {
        text-align: center;
        max-width: 400px;
        padding: 32px;
      }
      .${CSS_PREFIX}-welcome-logo {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        background: var(--dvt-accent, #0078d4);
        color: #fff;
        font-size: 28px;
        font-weight: 700;
        border-radius: 12px;
        margin-bottom: 16px;
      }
      .${CSS_PREFIX}-welcome-content h2 {
        margin-bottom: 8px;
        font-size: 20px;
      }
      .${CSS_PREFIX}-welcome-content p {
        color: var(--dvt-muted, #888);
        margin-bottom: 24px;
      }
      .${CSS_PREFIX}-welcome-steps {
        display: flex;
        flex-direction: column;
        gap: 12px;
        text-align: left;
      }
      .${CSS_PREFIX}-welcome-step {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        background: var(--dvt-bg-secondary, #252526);
        border-radius: 6px;
        font-size: 13px;
      }
      .${CSS_PREFIX}-step-num {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: var(--dvt-accent, #0078d4);
        color: #fff;
        border-radius: 50%;
        font-weight: 600;
        font-size: 13px;
        flex-shrink: 0;
      }

      /* Status bar */
      /* Quick Chat Bar */
      .${CSS_PREFIX}-quick-chat {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: var(--dvt-bg-secondary, #252526);
        border-top: 1px solid var(--dvt-border, #333);
        flex-shrink: 0;
        height: 32px;
        transition: height 0.15s ease;
        cursor: text;
      }
      .${CSS_PREFIX}-quick-chat.expanded {
        height: 42px;
      }
      .${CSS_PREFIX}-quick-chat-icon {
        font-size: 14px;
        flex-shrink: 0;
        line-height: 1;
      }
      .${CSS_PREFIX}-quick-chat-input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        color: var(--dvt-text, #ccc);
        font-size: 12px;
        font-family: inherit;
        min-width: 0;
      }
      .${CSS_PREFIX}-quick-chat-input::placeholder {
        color: var(--dvt-muted, #666);
      }
      .${CSS_PREFIX}-quick-chat-input:focus::placeholder {
        color: var(--dvt-muted, #888);
      }
      .${CSS_PREFIX}-quick-chat-hint {
        font-size: 10px;
        color: var(--dvt-muted, #555);
        flex-shrink: 0;
        padding: 1px 5px;
        border: 1px solid var(--dvt-border, #333);
        border-radius: 3px;
      }
      .${CSS_PREFIX}-quick-chat.expanded .${CSS_PREFIX}-quick-chat-hint {
        display: none;
      }
      .${CSS_PREFIX}-quick-chat-send {
        background: none;
        border: none;
        color: var(--dvt-accent, #007acc);
        cursor: pointer;
        font-size: 16px;
        padding: 2px 4px;
        border-radius: 3px;
        flex-shrink: 0;
        display: none;
      }
      .${CSS_PREFIX}-quick-chat.expanded .${CSS_PREFIX}-quick-chat-send {
        display: block;
      }
      .${CSS_PREFIX}-quick-chat-send:hover {
        background: var(--dvt-hover, rgba(255,255,255,0.05));
      }

      .${CSS_PREFIX}-status-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 12px;
        background: var(--dvt-bg-secondary, #252526);
        border-top: 1px solid var(--dvt-border, #333);
        font-size: 11px;
        flex-shrink: 0;
      }
      .${CSS_PREFIX}-status {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .${CSS_PREFIX}-status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .${CSS_PREFIX}-status-indicator.connected {
        background: var(--dvt-success, #4ec9b0);
      }
      .${CSS_PREFIX}-status-indicator.disconnected {
        background: var(--dvt-error, #f48771);
      }
      .${CSS_PREFIX}-status-label {
        color: var(--dvt-muted, #888);
        max-width: 300px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .${CSS_PREFIX}-version {
        color: var(--dvt-muted, #666);
      }

      /* Toast notifications */
      .${CSS_PREFIX}-toast-container {
        position: fixed;
        bottom: 32px;
        right: 12px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
      }
      .${CSS_PREFIX}-toast {
        padding: 10px 16px;
        border-radius: 6px;
        font-size: 12px;
        color: #fff;
        opacity: 0;
        transform: translateX(20px);
        transition: opacity 0.3s, transform 0.3s;
        pointer-events: auto;
        max-width: 320px;
      }
      .${CSS_PREFIX}-toast.visible {
        opacity: 1;
        transform: translateX(0);
      }
      .${CSS_PREFIX}-toast-info { background: #0078d4; }
      .${CSS_PREFIX}-toast-success { background: #107c10; }
      .${CSS_PREFIX}-toast-warning { background: #c19c00; color: #1e1e1e; }
      .${CSS_PREFIX}-toast-error { background: #e81123; }

      /* Modal */
      .${CSS_PREFIX}-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 9998;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .${CSS_PREFIX}-modal {
        background: var(--dvt-bg, #1e1e1e);
        border: 1px solid var(--dvt-border, #444);
        border-radius: 8px;
        min-width: 320px;
        max-width: 560px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      }
      .${CSS_PREFIX}-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--dvt-border, #333);
      }
      .${CSS_PREFIX}-modal-header h3 {
        margin: 0;
        font-size: 14px;
      }
      .${CSS_PREFIX}-modal-close {
        background: none;
        border: none;
        color: var(--dvt-muted, #888);
        font-size: 20px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
      }
      .${CSS_PREFIX}-modal-close:hover {
        color: var(--dvt-text, #ccc);
      }
      .${CSS_PREFIX}-modal-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }
      .${CSS_PREFIX}-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--dvt-border, #333);
      }

      /* Buttons */
      .${CSS_PREFIX}-btn-primary {
        padding: 7px 16px;
        border: none;
        border-radius: 4px;
        background: var(--dvt-accent, #0078d4);
        color: #fff;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }
      .${CSS_PREFIX}-btn-primary:hover {
        background: var(--dvt-accent-hover, #106ebe);
      }
      .${CSS_PREFIX}-btn-secondary {
        padding: 7px 16px;
        border: 1px solid var(--dvt-border, #444);
        border-radius: 4px;
        background: var(--dvt-input-bg, #2d2d2d);
        color: var(--dvt-text, #ccc);
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      }
      .${CSS_PREFIX}-btn-secondary:hover {
        background: var(--dvt-hover, #3c3c3c);
      }

      /* Settings */
      .${CSS_PREFIX}-settings {
        padding: 16px;
        overflow-y: auto;
        height: 100%;
      }
      .${CSS_PREFIX}-settings-title {
        font-size: 16px;
        margin-bottom: 16px;
      }
      .${CSS_PREFIX}-settings-group {
        margin-bottom: 16px;
      }
      .${CSS_PREFIX}-settings-label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 4px;
        color: var(--dvt-text-secondary, #969696);
      }
      .${CSS_PREFIX}-settings-select,
      .${CSS_PREFIX}-settings-input {
        width: 100%;
        max-width: 300px;
        padding: 6px 10px;
        border: 1px solid var(--dvt-border, #444);
        border-radius: 4px;
        background: var(--dvt-input-bg, #2d2d2d);
        color: var(--dvt-text, #ccc);
        font-size: 12px;
        font-family: inherit;
        outline: none;
      }
      .${CSS_PREFIX}-settings-select:focus,
      .${CSS_PREFIX}-settings-input:focus {
        border-color: var(--dvt-accent, #0078d4);
      }
      .${CSS_PREFIX}-settings-actions {
        display: flex;
        gap: 8px;
        margin: 20px 0;
        flex-wrap: wrap;
      }
      .${CSS_PREFIX}-shortcuts-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 0;
      }
      .${CSS_PREFIX}-shortcut {
        font-size: 12px;
        color: var(--dvt-text-secondary, #969696);
      }
      .${CSS_PREFIX}-shortcut kbd {
        padding: 2px 6px;
        background: var(--dvt-input-bg, #2d2d2d);
        border: 1px solid var(--dvt-border, #444);
        border-radius: 3px;
        font-family: inherit;
        font-size: 11px;
        color: var(--dvt-text, #ccc);
      }

      /* Placeholder */
      .${CSS_PREFIX}-placeholder {
        padding: 32px;
        text-align: center;
        color: var(--dvt-muted, #888);
      }
      .${CSS_PREFIX}-placeholder h3 {
        margin-bottom: 8px;
        color: var(--dvt-text, #ccc);
      }

      /* Error boundary */
      .${CSS_PREFIX}-error-boundary {
        padding: 24px;
        text-align: center;
      }
      .${CSS_PREFIX}-error-boundary h4 {
        color: var(--dvt-error, #f48771);
        margin-bottom: 8px;
      }
      .${CSS_PREFIX}-error-boundary p {
        color: var(--dvt-muted, #888);
        margin-bottom: 16px;
      }
    `;
    document.head.appendChild(style);
  }
}

// ---------------------------------------------------------------------------
// Auto-initialize on DOMContentLoaded
// ---------------------------------------------------------------------------

const app = new DataverseToolkit();

async function startApp() {
  try {
    await app.init();
  } catch (err) {
    // Show error visually since we may not have DevTools open
    const el = document.getElementById('app') || document.body;
    el.innerHTML = `<div style="padding:20px;color:#f48771;font-family:monospace;">
      <h3>Startup Error</h3>
      <pre>${err.message}\n${err.stack || ''}</pre>
    </div>`;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

export { DataverseToolkit, EventBus, MetadataCache };
export default app;
