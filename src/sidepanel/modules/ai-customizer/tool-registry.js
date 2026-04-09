/**
 * Dataverse Agent — Tool Registry
 *
 * Central registry for all tools the agent can call.
 * Built-in tools (hardcoded) + user-created tools (chrome.storage.local).
 * Each tool has: id, name, description, params (JSON Schema), handler,
 * confirmation requirements, and linked skill files.
 */

const STORAGE_KEY_USER_TOOLS = 'dvt-agent-user-tools';

/**
 * @typedef {Object} ToolDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} category              - 'metadata' | 'query' | 'crud' | 'customization' | 'code' | 'other'
 * @property {boolean} requiresConfirmation - Must show call details and wait for user approval
 * @property {boolean} autoApprovable       - User can toggle to auto-approve for the session
 * @property {boolean} autoApproved         - Currently auto-approved (session-only, not persisted)
 * @property {Object} params                - JSON Schema for parameters
 * @property {string[]} skillFiles          - Linked skill IDs
 * @property {(params: Object, ctx: ToolContext) => Promise<any>} handler
 */

/**
 * @typedef {Object} ToolContext
 * @property {Object} api    - DataverseClient
 * @property {Object} cache  - MetadataCache
 * @property {(tag: string, summary: string, detail?: string) => void} log
 */

export class ToolRegistry {
  #builtinTools = new Map();
  #userTools = new Map();

  registerBuiltin(tool) {
    this.#builtinTools.set(tool.id, { ...tool, autoApproved: false });
  }

  registerUser(tool) {
    this.#userTools.set(tool.id, { ...tool, autoApproved: false });
  }

  get(id) {
    return this.#builtinTools.get(id) || this.#userTools.get(id) || null;
  }

  getAll() {
    return [...this.#builtinTools.values(), ...this.#userTools.values()];
  }

  getBuiltins() {
    return [...this.#builtinTools.values()];
  }

  getUserTools() {
    return [...this.#userTools.values()];
  }

  getByCategory(category) {
    return this.getAll().filter(t => t.category === category);
  }

  /**
   * Generate the tool list section for the system prompt.
   */
  buildToolListForPrompt() {
    const lines = ['## Available Tools', 'Call tools by responding with: { "status": "tool_call", "tool": "<tool_id>", "params": {...}, "reasoning": "..." }', ''];

    for (const tool of this.getAll()) {
      const confirm = tool.requiresConfirmation ? ' (requires user confirmation)' : '';
      lines.push(`### ${tool.id}${confirm}`);
      lines.push(tool.description);
      if (tool.params && Object.keys(tool.params).length > 0) {
        lines.push('Parameters:');
        for (const [key, schema] of Object.entries(tool.params)) {
          const req = schema.required ? ' (required)' : '';
          lines.push(`  - ${key}: ${schema.type}${req} — ${schema.description || ''}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // -- Persistence for user tools --

  async load() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY_USER_TOOLS);
      const tools = stored[STORAGE_KEY_USER_TOOLS] || [];
      for (const t of tools) {
        // User tools don't have live handler functions — they're skill-based
        this.#userTools.set(t.id, { ...t, autoApproved: false });
      }
    } catch { /* ignore */ }
  }

  async save() {
    const serializable = [...this.#userTools.values()].map(t => {
      const { handler, autoApproved, ...rest } = t;
      return rest;
    });
    await chrome.storage.local.set({ [STORAGE_KEY_USER_TOOLS]: serializable });
  }

  removeUser(id) {
    this.#userTools.delete(id);
  }

  /** Reset all auto-approve flags (for new session). */
  resetAutoApprovals() {
    for (const tool of this.getAll()) {
      tool.autoApproved = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Built-in tool definitions
// ---------------------------------------------------------------------------

/**
 * Register all built-in tools. Called once at startup.
 * Handlers receive (params, ctx) where ctx = { api, cache, log }.
 */
export function registerBuiltinTools(registry) {

  // -- Metadata (read-only, no confirmation) --------------------------------

  registry.registerBuiltin({
    id: 'get_entities',
    name: 'List Entities',
    description: 'Get a list of all entities in the environment with their logical names, display names, and entity set names.',
    category: 'metadata',
    requiresConfirmation: false,
    autoApprovable: false,
    params: {
      filter: { type: 'string', description: 'Optional: filter string to search entity names (case-insensitive)' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      const entities = await ctx.cache.getEntities();
      if (params.filter) {
        const f = params.filter.toLowerCase();
        return entities.filter(e =>
          e.LogicalName.toLowerCase().includes(f) ||
          (e.DisplayName?.UserLocalizedLabel?.Label || '').toLowerCase().includes(f)
        ).map(e => ({ LogicalName: e.LogicalName, DisplayName: e.DisplayName?.UserLocalizedLabel?.Label, EntitySetName: e.EntitySetName }));
      }
      return entities.map(e => ({ LogicalName: e.LogicalName, DisplayName: e.DisplayName?.UserLocalizedLabel?.Label, EntitySetName: e.EntitySetName }));
    },
  });

  registry.registerBuiltin({
    id: 'get_entity_metadata',
    name: 'Get Entity Metadata',
    description: 'Fetch all attributes and relationships for a specific entity. Returns attribute logical names, types, display names, and relationship details.',
    category: 'metadata',
    requiresConfirmation: false,
    autoApprovable: false,
    params: {
      entity: { type: 'string', required: true, description: 'Entity logical name (e.g. "account", "jw_thread")' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      const [attributes, relationships] = await Promise.all([
        ctx.cache.getAttributes(params.entity),
        ctx.cache.getRelationships(params.entity),
      ]);
      return {
        attributes: attributes.map(a => ({
          LogicalName: a.LogicalName,
          AttributeType: a.AttributeType,
          DisplayName: a.DisplayName?.UserLocalizedLabel?.Label || '',
          RequiredLevel: a.RequiredLevel?.Value || 'None',
          IsPrimaryId: a.IsPrimaryId,
          IsPrimaryName: a.IsPrimaryName,
        })),
        relationships: {
          ManyToOne: (relationships.ManyToOne || []).map(r => ({ SchemaName: r.SchemaName, ReferencedEntity: r.ReferencedEntity, ReferencingAttribute: r.ReferencingAttribute })),
          OneToMany: (relationships.OneToMany || []).map(r => ({ SchemaName: r.SchemaName, ReferencingEntity: r.ReferencingEntity, ReferencedAttribute: r.ReferencedAttribute })),
        },
      };
    },
  });

  registry.registerBuiltin({
    id: 'get_optionset',
    name: 'Get OptionSet Values',
    description: 'Get the available option values for a picklist/status/state field.',
    category: 'metadata',
    requiresConfirmation: false,
    autoApprovable: false,
    params: {
      entity: { type: 'string', required: true, description: 'Entity logical name' },
      attribute: { type: 'string', required: true, description: 'Attribute logical name' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      return ctx.cache.getOptionSet(params.entity, params.attribute);
    },
  });

  // -- Query (read-only, no confirmation) -----------------------------------

  registry.registerBuiltin({
    id: 'execute_fetchxml',
    name: 'Execute FetchXML',
    description: 'Run a FetchXML query against Dataverse and return results. Use this for complex queries with filters, joins, aggregation.',
    category: 'query',
    requiresConfirmation: false,
    autoApprovable: false,
    params: {
      entity_set: { type: 'string', required: true, description: 'Entity set name (e.g. "accounts", "contacts")' },
      fetchxml: { type: 'string', required: true, description: 'Complete FetchXML string' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      const encoded = encodeURIComponent(params.fetchxml);
      const data = await ctx.api.request('GET', `${params.entity_set}?fetchXml=${encoded}`);
      return { count: data.value?.length || 0, records: data.value || [] };
    },
  });

  registry.registerBuiltin({
    id: 'execute_odata',
    name: 'Execute OData Query',
    description: 'Run an OData GET query against Dataverse. Use the relative URL (e.g. "accounts?$select=name&$top=5").',
    category: 'query',
    requiresConfirmation: false,
    autoApprovable: false,
    params: {
      url: { type: 'string', required: true, description: 'Relative OData URL (e.g. "accounts?$select=name&$top=5")' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      return ctx.api.request('GET', params.url);
    },
  });

  registry.registerBuiltin({
    id: 'get_record',
    name: 'Get Record',
    description: 'Fetch a single record by entity set name and record ID.',
    category: 'query',
    requiresConfirmation: false,
    autoApprovable: false,
    params: {
      entity_set: { type: 'string', required: true, description: 'Entity set name' },
      id: { type: 'string', required: true, description: 'Record GUID' },
      select: { type: 'string', description: 'Comma-separated column names to select' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      let url = `${params.entity_set}(${params.id})`;
      if (params.select) url += `?$select=${params.select}`;
      return ctx.api.request('GET', url);
    },
  });

  // -- CRUD (requires confirmation) -----------------------------------------

  registry.registerBuiltin({
    id: 'create_record',
    name: 'Create Record',
    description: 'Create a new record in Dataverse. Returns the new record ID.',
    category: 'crud',
    requiresConfirmation: true,
    autoApprovable: true,
    params: {
      entity_set: { type: 'string', required: true, description: 'Entity set name (e.g. "accounts")' },
      data: { type: 'object', required: true, description: 'Record data as JSON object' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      const resp = await ctx.api.requestRaw('POST', params.entity_set, { body: params.data });
      const newId = resp.headers?.['odata-entityid']?.match(/\(([^)]+)\)/)?.[1];
      ctx.log('WRITE', `Created ${params.entity_set} record${newId ? ` (${newId})` : ''}`);
      return { ok: resp.ok, status: resp.status, id: newId, error: resp.error };
    },
  });

  registry.registerBuiltin({
    id: 'update_record',
    name: 'Update Record',
    description: 'Update (PATCH) an existing Dataverse record.',
    category: 'crud',
    requiresConfirmation: true,
    autoApprovable: true,
    params: {
      entity_set: { type: 'string', required: true, description: 'Entity set name' },
      id: { type: 'string', required: true, description: 'Record GUID' },
      data: { type: 'object', required: true, description: 'Fields to update as JSON object' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      const resp = await ctx.api.requestRaw('PATCH', `${params.entity_set}(${params.id})`, { body: params.data });
      ctx.log('WRITE', `Updated ${params.entity_set}(${params.id}) — ${resp.status}`);
      return { ok: resp.ok, status: resp.status, error: resp.error };
    },
  });

  registry.registerBuiltin({
    id: 'delete_record',
    name: 'Delete Record',
    description: 'Delete a Dataverse record. This is irreversible!',
    category: 'crud',
    requiresConfirmation: true,
    autoApprovable: false, // Never auto-approvable
    params: {
      entity_set: { type: 'string', required: true, description: 'Entity set name' },
      id: { type: 'string', required: true, description: 'Record GUID' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      const resp = await ctx.api.requestRaw('DELETE', `${params.entity_set}(${params.id})`);
      ctx.log('WRITE', `Deleted ${params.entity_set}(${params.id}) — ${resp.status}`);
      return { ok: resp.ok, status: resp.status, error: resp.error };
    },
  });

  // -- Customization (requires confirmation) --------------------------------

  registry.registerBuiltin({
    id: 'publish_entity',
    name: 'Publish Entity',
    description: 'Publish customizations for a specific entity via PublishXml.',
    category: 'customization',
    requiresConfirmation: true,
    autoApprovable: true,
    params: {
      entity: { type: 'string', required: true, description: 'Entity logical name to publish' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      const resp = await ctx.api.requestRaw('POST', 'PublishXml', {
        body: { ParameterXml: `<importexportxml><entities><entity>${params.entity}</entity></entities></importexportxml>` },
      });
      ctx.log('PUB', `Published ${params.entity} — ${resp.status}`);
      return { ok: resp.ok, status: resp.status, error: resp.error };
    },
  });

  registry.registerBuiltin({
    id: 'execute_action',
    name: 'Execute Action',
    description: 'Call a Dataverse bound or unbound action/function.',
    category: 'customization',
    requiresConfirmation: true,
    autoApprovable: true,
    params: {
      method: { type: 'string', required: true, description: 'HTTP method: GET for functions, POST for actions' },
      url: { type: 'string', required: true, description: 'Relative URL (e.g. "WhoAmI()" or "accounts(id)/Microsoft.Dynamics.CRM.MyAction")' },
      body: { type: 'object', description: 'Request body for POST actions' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      const resp = await ctx.api.requestRaw(params.method, params.url, { body: params.body });
      return { ok: resp.ok, status: resp.status, data: resp.data, error: resp.error };
    },
  });

  // -- Form Inspection (read-only) ------------------------------------------

  registry.registerBuiltin({
    id: 'inspect_form',
    name: 'Inspect Form',
    description: 'Read the current Dynamics 365 form context — entity name, record data, form type, control states. Only works when a D365 form is open.',
    category: 'metadata',
    requiresConfirmation: false,
    autoApprovable: false,
    params: {
      action: { type: 'string', required: true, description: 'Action: "getFormContext", "getRecordData", "getFormType"' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      return ctx.api.formInspect(params.action, {});
    },
  });

  // -- Code Execution (requires confirmation) --------------------------------

  registry.registerBuiltin({
    id: 'execute_code',
    name: 'Execute JavaScript',
    description: 'Run JavaScript code. Use context="local" for data processing (has access to api and cache objects). Use context="page" to run in the Dynamics 365 page (has access to Xrm, document, etc.).',
    category: 'code',
    requiresConfirmation: true,
    autoApprovable: false, // Never auto-approvable by default
    params: {
      code: { type: 'string', required: true, description: 'JavaScript code to execute' },
      context: { type: 'string', required: true, description: '"local" (side panel) or "page" (D365 page context)' },
    },
    skillFiles: [],
    handler: async (params, ctx) => {
      if (params.context === 'page') {
        return ctx.api.formInspect('executeCode', { code: params.code });
      }
      // Local execution in side panel context
      const logs = [];
      const mockConsole = {
        log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
        warn: (...args) => logs.push('[WARN] ' + args.join(' ')),
        error: (...args) => logs.push('[ERROR] ' + args.join(' ')),
      };
      try {
        const fn = new Function('api', 'cache', 'console', `return (async () => { ${params.code} })()`);
        const result = await fn(ctx.api, ctx.cache, mockConsole);
        return { success: true, result, logs };
      } catch (err) {
        return { success: false, error: err.message, logs };
      }
    },
  });
}
