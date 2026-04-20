/**
 * Dataverse Agent — Skill Manager
 *
 * CRUD for skill files (Markdown documents) stored in chrome.storage.local.
 * Skills provide context for specific tools — loaded into the system prompt
 * when the linked tool is active.
 *
 * System skills are built-in, read-only reference docs shipped with the extension.
 * User skills are created/edited by the user or agent and persisted in storage.
 */

const STORAGE_KEY = 'dvt-agent-skills';

// ---------------------------------------------------------------------------
// System Skills — built-in, read-only
// ---------------------------------------------------------------------------

const SYSTEM_SKILLS = [
  {
    id: 'system_solution_queries',
    name: 'Solution & Component Queries',
    system: true,
    enabled: true,
    linkedTools: ['execute_odata', 'execute_action'],
    tags: ['solutions', 'metadata', 'solutioncomponents'],
    trigger: 'When working with solutions or finding which entities belong to a solution',
    content: `Query patterns for Dataverse solutions and their components.

**List unmanaged solutions:**
\`\`\`
GET solutions?$select=friendlyname,uniquename,version,ismanaged,description&$filter=ismanaged eq false
\`\`\`

**Get entity components of a solution** (componenttype 1 = Entity/Table):
\`\`\`
GET solutioncomponents?$filter=solutionid/uniquename eq '{uniqueName}' and componenttype eq 1&$select=objectid
\`\`\`

The \`objectid\` values are **MetadataId** GUIDs — resolve them to entity names via:
\`\`\`
GET EntityDefinitions({metadataId})?$select=LogicalName,DisplayName,EntitySetName
\`\`\`

**Key points:**
- A prefix (e.g. \`bec_\`) identifies the publisher, not the solution — confirm via \`publishers?$filter=customizationprefix eq 'bec'\`
- FriendlyName and UniqueName of a solution can differ
- Use \`solutioncomponents\` as the authoritative source for what's in a solution
- For large orgs (700+ entities), never iterate all entities — filter by solution components`,
  },
  {
    id: 'system_metadata_queries',
    name: 'Entity & Attribute Metadata Queries',
    system: true,
    enabled: true,
    linkedTools: ['execute_odata', 'get_entity_metadata'],
    tags: ['metadata', 'entities', 'attributes', 'relationships', 'customapis'],
    trigger: 'When querying entity/attribute metadata, relationships, or custom APIs',
    content: `OData patterns for querying Dataverse metadata.

**List entities** (filter private entities):
\`\`\`
GET EntityDefinitions?$select=LogicalName,DisplayName,SchemaName,EntitySetName,ObjectTypeCode,OwnershipType,PrimaryIdAttribute,PrimaryNameAttribute,IsCustomEntity,IsActivity,Description,MetadataId&$filter=IsPrivate eq false
\`\`\`

**Entity attributes:**
\`\`\`
GET EntityDefinitions(LogicalName='{entity}')/Attributes?$select=LogicalName,SchemaName,AttributeType,DisplayName,RequiredLevel,IsCustomAttribute,IsPrimaryId,IsPrimaryName,Description
\`\`\`

**Relationships:**
\`\`\`
GET EntityDefinitions(LogicalName='{entity}')/OneToManyRelationships
GET EntityDefinitions(LogicalName='{entity}')/ManyToOneRelationships
GET EntityDefinitions(LogicalName='{entity}')/ManyToManyRelationships
\`\`\`

**Alternate keys:**
\`\`\`
GET EntityDefinitions(LogicalName='{entity}')/Keys
\`\`\`

**Custom APIs (unbound actions/functions):**
\`\`\`
GET customapis?$select=uniquename,displayname,description,isfunction,customapiid&$filter=isfunction eq false and boundentitylogicalname eq null
GET customapis?$select=...&$filter=isfunction eq true and boundentitylogicalname eq null
\`\`\`

**Bound Custom APIs:**
\`\`\`
GET customapis?$select=...&$filter=boundentitylogicalname eq '{entity}'
\`\`\`

**Custom API parameters/responses:**
\`\`\`
GET customapirequestparameters?$select=uniquename,name,description,type,isoptional&$filter=_customapiid_value eq '{apiId}'
GET customapiresponseproperties?$select=uniquename,name,description,type&$filter=_customapiid_value eq '{apiId}'
\`\`\`

**Pitfalls:**
- \`$orderby\` is NOT supported on metadata endpoints — sort client-side
- Type-specific attribute properties (MaxLength, OptionSet, etc.) require a type-cast URL
- N:N relationships cannot be \`$expand\`ed — use FetchXML \`<link-entity>\` instead`,
  },
  {
    id: 'system_view_modification',
    name: 'View Modification Patterns',
    system: true,
    enabled: true,
    linkedTools: ['execute_action', 'execute_fetchxml'],
    tags: ['views', 'savedqueries', 'layoutxml', 'fetchxml'],
    trigger: 'When modifying or creating Dataverse saved queries (views)',
    content: `Patterns for reading and modifying Dataverse saved queries (views).

**Read views for an entity:**
\`\`\`
GET savedqueries?$select=name,layoutxml,fetchxml,savedqueryid&$filter=returnedtypecode eq '{entity}' and statecode eq 0
\`\`\`

**Update a view:**
\`\`\`
PATCH savedqueries({id})
Body: { "layoutxml": "...", "fetchxml": "..." }
\`\`\`
Then publish: \`POST PublishXml\` with \`<importexportxml><entities><entity>{entity}</entity></entities></importexportxml>\`

**layoutxml/fetchxml sync rules:**
- Every \`<cell name="X">\` in layoutxml MUST have a matching \`<attribute name="X">\` in fetchxml
- For link-entity columns: \`<cell name="navprop.attributename" width="..." />\`
- Default column widths: 150 (text/string), 100 (numbers/dates/booleans), 200 (lookups)
- layoutxml format: \`<grid name="resultset" object="..." jump="" select="1" icon="1" preview="1"><row name="result" id="{entity}id"><cell .../></row></grid>\`

**Pitfalls:**
- Never invent attribute logical names — validate against entity metadata first
- The \`object\` attribute in \`<grid>\` is the ObjectTypeCode (integer), not the logical name
- Preserve existing columns unless the user explicitly asks to remove them
- Always publish after updating a view — changes are not visible until published`,
  },
  {
    id: 'system_fetchxml_execution',
    name: 'FetchXML Execution Patterns',
    system: true,
    enabled: true,
    linkedTools: ['execute_fetchxml'],
    tags: ['fetchxml', 'queries'],
    trigger: 'When building or executing FetchXML queries',
    content: `How FetchXML queries work in the Dataverse Web API.

**Execution:** FetchXML is sent as a URL parameter on a GET request, NOT as a POST body:
\`\`\`
GET {EntitySetName}?fetchXml={url-encoded-xml}
\`\`\`
Use the **EntitySetName** (e.g. \`accounts\`), NOT the LogicalName (e.g. \`account\`).

**Key operators** (45 total, notable ones):
- Comparison: \`eq\`, \`ne\`, \`gt\`, \`ge\`, \`lt\`, \`le\`
- String: \`like\` (with %), \`not-like\`, \`begins-with\`, \`ends-with\`, \`contains\`
- Null: \`null\`, \`not-null\`
- Date: \`today\`, \`yesterday\`, \`last-x-days\`, \`next-x-days\`, \`last-x-months\`, \`this-year\`, \`last-year\`
- User: \`eq-userid\`, \`ne-userid\`, \`eq-userlanguage\`
- Multi-value: \`in\`, \`not-in\` (with \`<value>\` children)

**Aggregation:** Set \`aggregate="true"\` on \`<fetch>\`, then use \`aggregate\` and \`groupby\` on attributes:
\`\`\`xml
<fetch aggregate="true">
  <entity name="opportunity">
    <attribute name="estimatedvalue" alias="total" aggregate="sum" />
    <attribute name="statecode" alias="state" groupby="true" />
  </entity>
</fetch>
\`\`\`

**Paging:** Use \`top\`, \`page\`, and \`count\` attributes on \`<fetch>\`.

**Link entities** (joins): \`<link-entity name="..." from="..." to="..." link-type="inner|outer">\`
- N:N joins require FetchXML — OData \`$expand\` does not support N:N relationships`,
  },
];

// ---------------------------------------------------------------------------
// Skill Manager
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Skill
 * @property {string} id           - Unique identifier
 * @property {string} name         - Human-readable name
 * @property {string} content      - Markdown content
 * @property {string[]} linkedTools - Tool IDs this skill provides context for
 * @property {string[]} tags       - Free tags for categorization
 * @property {string} trigger      - When this skill is relevant (human-readable)
 * @property {boolean} enabled     - Manual toggle (default: true)
 * @property {boolean} [system]    - True for built-in read-only skills
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export class SkillManager {
  #skills = new Map();

  async load() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const skills = stored[STORAGE_KEY] || [];
      this.#skills.clear();
      for (const s of skills) {
        this.#skills.set(s.id, s);
      }
    } catch { /* ignore */ }
  }

  async save() {
    const arr = [...this.#skills.values()];
    await chrome.storage.local.set({ [STORAGE_KEY]: arr });
  }

  /** Returns all skills: system (built-in) + user skills. */
  getAll() {
    const system = SYSTEM_SKILLS.filter(s => s.enabled !== false);
    return [...system, ...this.#skills.values()];
  }

  /** Returns only user-created skills (excludes system skills). */
  getUserSkills() {
    return [...this.#skills.values()];
  }

  get(id) {
    return SYSTEM_SKILLS.find(s => s.id === id) || this.#skills.get(id) || null;
  }

  /**
   * Get all skills linked to a specific tool.
   */
  getForTool(toolId) {
    return this.getAll().filter(s => s.linkedTools?.includes(toolId));
  }

  /**
   * Build a combined prompt section from all skills linked to the active tools.
   * @param {string[]} activeToolIds - Currently relevant tool IDs
   */
  buildSkillPromptSection(activeToolIds) {
    const relevant = this.getAll().filter(s =>
      s.enabled !== false &&
      (!s.linkedTools?.length || s.linkedTools.some(t => activeToolIds.includes(t)))
    );
    if (!relevant.length) return '';

    return '\n## Skill Context\n' +
      relevant.map(s => {
        const trigger = s.trigger ? `> Trigger: ${s.trigger}\n\n` : '';
        return `### ${s.name}\n${trigger}${s.content}`;
      }).join('\n\n');
  }

  async create(name, content, { linkedTools = [], tags = [], trigger = '', enabled = true } = {}) {
    const id = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const skill = { id, name, content, linkedTools, tags, trigger, enabled, createdAt: Date.now(), updatedAt: Date.now() };
    this.#skills.set(id, skill);
    await this.save();
    return skill;
  }

  async update(id, updates) {
    if (SYSTEM_SKILLS.some(s => s.id === id)) return null; // system skills are read-only
    const skill = this.#skills.get(id);
    if (!skill) return null;
    Object.assign(skill, updates, { updatedAt: Date.now() });
    await this.save();
    return skill;
  }

  async delete(id) {
    if (SYSTEM_SKILLS.some(s => s.id === id)) return; // system skills cannot be deleted
    this.#skills.delete(id);
    await this.save();
  }

  /**
   * Export a single skill as Markdown text.
   */
  exportAsMarkdown(id) {
    const skill = this.get(id);
    if (!skill) return null;
    const fm = [
      `name: ${skill.name}`,
      skill.tags?.length ? `tags: ${skill.tags.join(', ')}` : null,
      skill.linkedTools?.length ? `linkedTools: ${skill.linkedTools.join(', ')}` : null,
      skill.trigger ? `trigger: ${skill.trigger}` : null,
    ].filter(Boolean).join('\n');
    return `---\n${fm}\n---\n\n${skill.content}`;
  }

  /**
   * Export all skills as a single JSON string.
   */
  exportAllAsJson() {
    return JSON.stringify([...this.#skills.values()], null, 2);
  }

  /**
   * Import a skill from Markdown with frontmatter.
   */
  async importFromMarkdown(md) {
    const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
    if (!fmMatch) {
      return this.create('Imported Skill', md);
    }
    const frontmatter = fmMatch[1];
    const content = fmMatch[2];
    const name = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim() || 'Imported Skill';
    const toolsStr = frontmatter.match(/linkedTools:\s*(.+)/)?.[1]?.trim() || '';
    const linkedTools = toolsStr ? toolsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
    return this.create(name, content, linkedTools);
  }

  /**
   * Import skills from a JSON array.
   */
  async importFromJson(json) {
    const arr = JSON.parse(json);
    for (const s of arr) {
      if (s.id && s.name && s.content) {
        this.#skills.set(s.id, { ...s, updatedAt: Date.now() });
      }
    }
    await this.save();
  }
}

/** Expose for testing. */
export { SYSTEM_SKILLS };
