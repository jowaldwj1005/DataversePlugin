/**
 * Module Bridge — connects the AI agent to all extension modules.
 *
 * Provides two core capabilities:
 * 1. read_module_state(tabId) — read current state from any module without navigating
 * 2. navigateAndConfigure(tabId, context) — switch tab and pass context to the module
 *
 * Each module can optionally implement:
 * - setContext(ctx) — receive context from the agent
 * - getContext()   — expose current state to the agent
 */

/** Map of tabId → human-readable label for agent prompts */
const TAB_LABELS = {
  explorer: 'API Explorer',
  fetchxml: 'FetchXML Builder',
  request: 'Request Builder',
  bulk: 'Bulk Operations',
  security: 'Security Inspector',
  erd: 'ERD Viewer',
  erdpro: 'ERD Pro',
  toolbuilder: 'Tool Builder',
  aicustomizer: 'AI Agent',
  formtools: 'Form Tools',
  settings: 'Settings',
};

export class ModuleBridge {
  #app;

  constructor(app) {
    this.#app = app;
  }

  // -------------------------------------------------------------------------
  // Read state (no tab switch)
  // -------------------------------------------------------------------------

  /**
   * Read current state from a module without switching tabs.
   * Returns null if the module hasn't been loaded yet.
   */
  getModuleState(tabId) {
    const module = this.#app.getModule(tabId);
    if (!module) return null;
    if (typeof module.getContext === 'function') {
      return module.getContext();
    }
    return { loaded: true, note: 'Module has no getContext() method' };
  }

  /**
   * Get the currently active tab ID.
   */
  getActiveTab() {
    return this.#app.getActiveTab();
  }

  /**
   * Get human-readable label for a tab.
   */
  getTabLabel(tabId) {
    return TAB_LABELS[tabId] || tabId;
  }

  /**
   * Get all available tab IDs (excluding settings and aicustomizer).
   */
  getNavigableModules() {
    return Object.entries(TAB_LABELS)
      .filter(([id]) => id !== 'settings' && id !== 'aicustomizer')
      .map(([id, label]) => ({ id, label }));
  }

  // -------------------------------------------------------------------------
  // Navigate + configure (tab switch)
  // -------------------------------------------------------------------------

  /**
   * Switch to a tab and optionally pass context.
   * Returns a summary of what happened.
   */
  async navigateAndConfigure(tabId, context = null) {
    if (!TAB_LABELS[tabId]) {
      return { ok: false, error: `Unknown tab: ${tabId}` };
    }

    this.#app.switchTab(tabId, context);

    // Wait a tick for async module init
    await new Promise(r => setTimeout(r, 50));

    const module = this.#app.getModule(tabId);
    if (!module) {
      return { ok: true, tabId, note: 'Tab switched but module not yet loaded' };
    }

    // If context was provided and module has setContext, call it explicitly
    // (app._switchTab also calls it, but this handles race conditions)
    if (context && typeof module.setContext === 'function') {
      try {
        await module.setContext(context);
      } catch (err) {
        return { ok: true, tabId, warning: `Context applied with error: ${err.message}` };
      }
    }

    return { ok: true, tabId, label: TAB_LABELS[tabId] };
  }

  // -------------------------------------------------------------------------
  // Context for system prompt
  // -------------------------------------------------------------------------

  /**
   * Build a "Current User Context" section for the system prompt.
   * Reads state from the active module (if not the AI tab itself).
   */
  buildContextForPrompt() {
    const activeTab = this.getActiveTab();
    if (!activeTab || activeTab === 'aicustomizer' || activeTab === 'settings') {
      return '';
    }

    const state = this.getModuleState(activeTab);
    if (!state) return '';

    const label = this.getTabLabel(activeTab);
    let section = `## Current User Context\nThe user is currently on the **${label}** tab.\n`;

    // Format state based on module type
    if (activeTab === 'fetchxml' && state.xml) {
      section += `\nCurrent FetchXML query:\n\`\`\`xml\n${state.xml}\n\`\`\`\n`;
      if (state.entity) section += `Entity: ${state.entity}\n`;
    } else if (activeTab === 'request' && state.url) {
      section += `\nCurrent request: ${state.method || 'GET'} ${state.url}\n`;
      if (state.body) section += `Body:\n\`\`\`json\n${state.body}\n\`\`\`\n`;
    } else if (activeTab === 'bulk' && state.operations?.length) {
      section += `\n${state.operations.length} operations loaded.\n`;
    } else if ((activeTab === 'erd' || activeTab === 'erdpro') && state.solution) {
      section += `\nSolution: ${state.solution}\n`;
      if (state.entityCount) section += `Entities: ${state.entityCount}\n`;
    } else if (activeTab === 'security' && state.entity) {
      section += `\nInspecting entity: ${state.entity}\n`;
      section += `Active subtab: ${state.activeTab || 'entity-privileges'}\n`;
    } else if (activeTab === 'toolbuilder' && state.entity) {
      section += `\nEntity: ${state.entity}, Format: ${state.format || 'claude'}, Mode: ${state.mode || 'create'}\n`;
    } else if (activeTab === 'explorer' && state.selectedEntity) {
      section += `\nSelected entity: ${state.selectedEntity}\n`;
    } else {
      // Generic: serialize state
      const stateStr = JSON.stringify(state, null, 2);
      if (stateStr.length < 2000) {
        section += `\nModule state:\n\`\`\`json\n${stateStr}\n\`\`\`\n`;
      }
    }

    return section;
  }
}
