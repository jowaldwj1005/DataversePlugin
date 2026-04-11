/**
 * Dataverse Toolkit - Bulk Operations Module
 *
 * Batch request builder for executing multiple Dataverse Web API operations
 * in a single $batch call. Supports ChangeSets (transactional groups),
 * drag-and-drop reordering, CSV/JSON import, progress tracking, and
 * result export.
 *
 * @module BulkOperations
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_METHODS = Object.freeze(['POST', 'PATCH', 'DELETE']);

const METHOD_COLORS = Object.freeze({
  POST: '#49cc90',
  PATCH: '#fca130',
  DELETE: '#f93e3e',
  GET: '#61affe',
});

const MAX_BATCH_SIZE = 1000;

const DEFAULT_THROTTLE_MS = 100;

const BATCH_BOUNDARY = 'batch_dataverse_toolkit';
const CHANGESET_BOUNDARY_PREFIX = 'changeset_';

const AGENT_ENTITY_BUILDER_PROMPT = `You are a Dataverse solution architect. The user will describe a project or business domain. Your job is to:

1. Identify all necessary custom Dataverse entities (tables) for that domain
2. Define their attributes (columns) with correct types
3. Define lookup relationships between entities
4. Output a single JSON array that can be pasted directly into a Dataverse Bulk Operations tool

Output format:
Output ONLY a JSON array. Each element is one Dataverse Metadata API operation:
[{ "method": "POST", "url": "...", "body": { ... } }, ...]

Operation ordering rules (CRITICAL):
1. Parent entities first — any entity that other entities look up to must be created before the child
2. All entities before relationships — RelationshipDefinitions operations come after both entities exist
3. Extra attributes after their entity — EntityDefinitions(LogicalName='...')/Attributes comes after the entity POST

Entity creation — URL: EntityDefinitions
Always include the primary name attribute inline in Attributes:
{
  "method": "POST",
  "url": "EntityDefinitions",
  "body": {
    "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
    "SchemaName": "new_Project",
    "DisplayName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Project", "LanguageCode": 1033 }] },
    "DisplayCollectionName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Projects", "LanguageCode": 1033 }] },
    "OwnershipType": "UserOwned",
    "HasActivities": false,
    "HasNotes": false,
    "PrimaryNameAttribute": "new_name",
    "Attributes": [{
      "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
      "SchemaName": "new_name",
      "RequiredLevel": { "Value": "ApplicationRequired" },
      "MaxLength": 100,
      "DisplayName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Name", "LanguageCode": 1033 }] }
    }]
  }
}

Extra attributes — URL: EntityDefinitions(LogicalName='new_project')/Attributes
Type mapping:
- Text (short):  StringAttributeMetadata  — add MaxLength (max 4000)
- Text (long):   MemoAttributeMetadata    — add MaxLength (max 1048576)
- Whole Number:  IntegerAttributeMetadata — add MinValue, MaxValue
- Decimal:       DecimalAttributeMetadata — add MinValue, MaxValue, Precision
- Currency:      MoneyAttributeMetadata   — add MinValue, MaxValue, Precision
- Yes/No:        BooleanAttributeMetadata — add OptionSet with TrueOption/FalseOption
- Date/Time:     DateTimeAttributeMetadata — add DateTimeBehavior: { "Value": "UserLocal" }
- Choice:        PicklistAttributeMetadata — add OptionSet with Options array
All @odata.type values use the Microsoft.Dynamics.CRM. prefix.

Lookup relationships (N:1) — URL: RelationshipDefinitions
NEVER create a lookup attribute manually — use RelationshipDefinitions (creates the lookup field automatically):
{
  "method": "POST",
  "url": "RelationshipDefinitions",
  "body": {
    "@odata.type": "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata",
    "SchemaName": "new_project_new_task",
    "ReferencedEntity": "new_project",
    "ReferencingEntity": "new_task",
    "ReferencedAttribute": "new_projectid",
    "Lookup": {
      "@odata.type": "Microsoft.Dynamics.CRM.LookupAttributeMetadata",
      "SchemaName": "new_ProjectId",
      "DisplayName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Project", "LanguageCode": 1033 }] },
      "RequiredLevel": { "Value": "None" }
    },
    "AssociatedMenuConfiguration": { "Behavior": "UseCollectionName", "Group": "Details", "Order": 10000 },
    "CascadeConfiguration": { "Assign": "NoCascade", "Delete": "RemoveLink", "Merge": "NoCascade", "Reparent": "NoCascade", "Share": "NoCascade", "Unshare": "NoCascade" }
  }
}

Naming conventions:
- Custom prefix: "new_" unless user specifies a publisher prefix
- SchemaName: PascalCase (new_ProjectName)
- LogicalName in URLs: always lowercase (new_projectname)
- Primary ID: <logicalname>id (e.g. new_projectid)
- Relationship SchemaName: <parent>_<child> (e.g. new_project_new_task)

What NOT to include:
- Do not create standard entities (account, contact, etc.) — they already exist
- Do not manually create lookup attributes — use RelationshipDefinitions
- Do not add statecode/statuscode — auto-created by Dataverse
- Do not set IsCustomizable, IsAuditEnabled unless explicitly requested

Now describe your project and I will generate the JSON array.`;

/**
 * @typedef {Object} BulkOperation
 * @property {string} id              - Unique identifier
 * @property {string} method          - HTTP method (POST, PATCH, DELETE)
 * @property {string} url             - Relative URL (e.g., accounts or accounts(guid))
 * @property {Object|null} body       - Request body (for POST/PATCH)
 * @property {Object} headers         - Additional headers
 * @property {string} description     - Human-readable description
 * @property {string|null} changeSetId - ID of the ChangeSet this operation belongs to (null = standalone)
 * @property {'pending'|'running'|'success'|'failed'|'skipped'} status
 * @property {Object|null} result     - Response after execution
 */

/**
 * @typedef {Object} ChangeSet
 * @property {string} id
 * @property {string} label
 * @property {string} color
 */

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Generate a unique ID.
 * @returns {string}
 */
function generateId() {
  return Math.random().toString(36).substring(2, 12);
}

/**
 * Generate a unique ChangeSet boundary.
 * @returns {string}
 */
function generateChangeSetBoundary() {
  return `${CHANGESET_BOUNDARY_PREFIX}${generateId()}`;
}

/**
 * Predefined colours for ChangeSet visual grouping.
 * @type {string[]}
 */
const CHANGESET_COLORS = [
  '#569cd6', '#4ec9b0', '#ce9178', '#c586c0', '#dcdcaa',
  '#4fc1ff', '#d7ba7d', '#9cdcfe', '#b5cea8', '#d4d4d4',
];

let colorIndex = 0;
function nextChangeSetColor() {
  const color = CHANGESET_COLORS[colorIndex % CHANGESET_COLORS.length];
  colorIndex++;
  return color;
}

/**
 * Debounce utility.
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Parse CSV text into an array of objects using the first row as headers.
 * @param {string} csvText
 * @returns {Object[]}
 */
function parseCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Simple CSV parser (handles quoted fields)
  function parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Convert an array of objects to CSV text.
 * @param {Object[]} data
 * @returns {string}
 */
function toCsv(data) {
  if (!data || data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const lines = [headers.join(',')];
  for (const row of data) {
    const vals = headers.map(h => {
      const v = row[h] == null ? '' : String(row[h]);
      return v.includes(',') || v.includes('"') || v.includes('\n')
        ? `"${v.replace(/"/g, '""')}"`
        : v;
    });
    lines.push(vals.join(','));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// $batch request builder
// ---------------------------------------------------------------------------

/**
 * Build an OData $batch request body from operations and change sets.
 *
 * @param {BulkOperation[]} operations - All operations in order
 * @param {ChangeSet[]} changeSets - Defined change sets
 * @returns {{ contentType: string, body: string }}
 */
function buildBatchBody(operations, changeSets) {
  const parts = [];

  // Group operations by change set
  const changeSetMap = new Map();
  const standalone = [];

  for (const op of operations) {
    if (op.changeSetId && changeSets.find(cs => cs.id === op.changeSetId)) {
      if (!changeSetMap.has(op.changeSetId)) {
        changeSetMap.set(op.changeSetId, []);
      }
      changeSetMap.get(op.changeSetId).push(op);
    } else {
      standalone.push(op);
    }
  }

  // Write change sets first, then standalone operations
  for (const [csId, csOps] of changeSetMap) {
    const csBoundary = generateChangeSetBoundary();
    parts.push(`--${BATCH_BOUNDARY}`);
    parts.push(`Content-Type: multipart/mixed; boundary=${csBoundary}`);
    parts.push('');

    for (let i = 0; i < csOps.length; i++) {
      const op = csOps[i];
      parts.push(`--${csBoundary}`);
      parts.push('Content-Type: application/http');
      parts.push('Content-Transfer-Encoding: binary');
      parts.push(`Content-ID: ${i + 1}`);
      parts.push('');
      parts.push(`${op.method} ${op.url} HTTP/1.1`);

      // Headers
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        ...op.headers,
      };
      for (const [key, val] of Object.entries(headers)) {
        parts.push(`${key}: ${val}`);
      }
      parts.push('');

      // Body
      if (op.body && ['POST', 'PATCH', 'PUT'].includes(op.method)) {
        parts.push(typeof op.body === 'string' ? op.body : JSON.stringify(op.body));
      }
    }

    parts.push(`--${csBoundary}--`);
  }

  // Standalone operations (outside change sets)
  for (const op of standalone) {
    parts.push(`--${BATCH_BOUNDARY}`);
    parts.push('Content-Type: application/http');
    parts.push('Content-Transfer-Encoding: binary');
    parts.push('');
    parts.push(`${op.method} ${op.url} HTTP/1.1`);

    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      ...op.headers,
    };
    for (const [key, val] of Object.entries(headers)) {
      parts.push(`${key}: ${val}`);
    }
    parts.push('');

    if (op.body && ['POST', 'PATCH', 'PUT'].includes(op.method)) {
      parts.push(typeof op.body === 'string' ? op.body : JSON.stringify(op.body));
    }
  }

  parts.push(`--${BATCH_BOUNDARY}--`);

  return {
    contentType: `multipart/mixed; boundary=${BATCH_BOUNDARY}`,
    body: parts.join('\r\n'),
  };
}

/**
 * Parse a $batch response body into individual operation results.
 *
 * @param {string} responseText
 * @param {string} boundary
 * @returns {Array<{ status: number, statusText: string, headers: Object, body: any }>}
 */
function parseBatchResponse(responseText, boundary) {
  const results = [];
  const cleanBoundary = boundary.replace(/^multipart\/mixed;\s*boundary=/, '');
  const parts = responseText.split(`--${cleanBoundary}`);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '--') continue;

    // Check if this is a nested change set
    const nestedBoundaryMatch = trimmed.match(/Content-Type:\s*multipart\/mixed;\s*boundary=(\S+)/i);
    if (nestedBoundaryMatch) {
      const nestedResults = parseBatchResponse(trimmed, nestedBoundaryMatch[1]);
      results.push(...nestedResults);
      continue;
    }

    // Parse individual HTTP response
    const httpMatch = trimmed.match(/HTTP\/1\.1\s+(\d+)\s+([^\r\n]*)/);
    if (!httpMatch) continue;

    const status = parseInt(httpMatch[1], 10);
    const statusText = httpMatch[2];

    // Parse headers
    const headers = {};
    const headerSection = trimmed.substring(trimmed.indexOf(httpMatch[0]) + httpMatch[0].length);
    const headerLines = headerSection.split(/\r?\n/);
    let bodyStart = -1;
    for (let i = 0; i < headerLines.length; i++) {
      const line = headerLines[i].trim();
      if (!line) {
        bodyStart = i + 1;
        break;
      }
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        headers[line.substring(0, colonIdx).trim()] = line.substring(colonIdx + 1).trim();
      }
    }

    // Parse body
    let body = null;
    if (bodyStart >= 0) {
      const bodyText = headerLines.slice(bodyStart).join('\n').trim();
      if (bodyText) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }
    }

    results.push({ status, statusText, headers, body });
  }

  return results;
}

// ---------------------------------------------------------------------------
// BulkOperations Class
// ---------------------------------------------------------------------------

/**
 * Bulk operations builder for batch requests to the Dataverse Web API.
 * Supports drag-and-drop ordering, ChangeSet grouping, CSV/JSON import,
 * progress tracking, and result export.
 *
 * @example
 * const bulk = new BulkOperations(containerEl, apiClient, metadataCache);
 * bulk.render();
 */
export class BulkOperations {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} apiClient - API client with request(method, url, options) and baseUrl
   * @param {Object} metadataCache - Metadata cache with getEntities(), getAttributes(entity)
   */
  constructor(container, apiClient, metadataCache) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {Object} */
    this.apiClient = apiClient;

    /** @type {Object} */
    this.metadataCache = metadataCache;

    /** @type {BulkOperation[]} */
    this.operations = [];

    /** @type {ChangeSet[]} */
    this.changeSets = [];

    /** @type {boolean} - Continue on error or stop on first failure */
    this.continueOnError = true;

    /** @type {boolean} - Execute batches in parallel (multiple $batch calls) */
    this.parallelExecution = false;

    /** @type {number} - Throttle delay between batch calls in ms */
    this.throttleMs = DEFAULT_THROTTLE_MS;

    /** @type {number} - Max operations per $batch request */
    this.batchSize = MAX_BATCH_SIZE;

    /** @type {boolean} - Currently executing */
    this._executing = false;

    /** @type {AbortController|null} */
    this._abortController = null;

    /** @type {Array<Object>} - Cached entity metadata */
    this._entities = [];

    /** @type {Object|null} - Drag source data */
    this._dragSource = null;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Render the bulk operations UI.
   */
  async render() {
    this.container.innerHTML = '';
    this.container.classList.add('bulk-operations');

    await this._loadEntities();

    // Show wizard grid when no operations, otherwise show full UI
    if (this.operations.length === 0) {
      this._buildWelcomeGrid();
    } else {
      this._buildFullUI();
    }
  }

  /** Full editing UI with JSON panel, toolbar, operations list, etc. */
  _buildFullUI() {
    this._buildJsonInputPanel();
    this._buildToolbar();
    this._buildOperationsList();
    this._buildConfigSection();
    this._buildProgressSection();
    this._buildResultsSection();
  }

  /** Welcome screen with wizard cards when no operations exist. */
  _buildWelcomeGrid() {
    const grid = document.createElement('div');
    grid.className = 'bulk-welcome-grid';

    const title = document.createElement('div');
    title.className = 'bulk-welcome-title';
    title.textContent = 'Bulk Operations';
    grid.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'bulk-welcome-subtitle';
    subtitle.textContent = 'Choose a wizard to get started, or paste JSON manually.';
    grid.appendChild(subtitle);

    const cards = document.createElement('div');
    cards.className = 'bulk-welcome-cards';

    const wizards = [
      { name: 'Bulk Create',      icon: '\u2795', desc: 'Create multiple records from form input or CSV paste', file: 'wizard-bulk-create', cls: 'BulkCreateWizard' },
      { name: 'Bulk Update',      icon: '\u270F\uFE0F', desc: 'Update fields on records matching an OData filter', file: 'wizard-bulk-update', cls: 'BulkUpdateWizard' },
      { name: 'Bulk Delete',      icon: '\u274C', desc: 'Delete records with type-to-confirm safety gate', file: 'wizard-bulk-delete', cls: 'BulkDeleteWizard' },
      { name: 'Status Toggle',    icon: '\uD83D\uDD04', desc: 'Change statecode/statuscode across matching records', file: 'wizard-status-toggle', cls: 'StatusToggleWizard' },
      { name: 'Bulk Assign',      icon: '\uD83D\uDC64', desc: 'Reassign record ownership to a user or team', file: 'wizard-bulk-assign', cls: 'BulkAssignWizard' },
      { name: 'Deep Insert',      icon: '\uD83C\uDF33', desc: 'Create parent + child records in a single POST', file: 'wizard-deep-insert', cls: 'DeepInsertWizard' },
      { name: 'Data Export (CMT)', icon: '\uD83D\uDCE4', desc: 'Export records as Configuration Migration Tool zip', file: 'cmt-export', cls: 'CmtExportWizard' },
      { name: 'Data Import (CMT)', icon: '\uD83D\uDCE5', desc: 'Import CMT zip and generate upsert/create operations', file: 'cmt-import', cls: 'CmtImportWizard' },
    ];

    for (const w of wizards) {
      const card = document.createElement('div');
      card.className = 'bulk-welcome-card';
      card.innerHTML = `<span class="bulk-welcome-icon">${w.icon}</span>
        <span class="bulk-welcome-name">${w.name}</span>
        <span class="bulk-welcome-desc">${w.desc}</span>`;
      card.addEventListener('click', () => this._launchWizard(w.file, w.cls));
      cards.appendChild(card);
    }

    // AI Agent Prompt card
    const aiCard = document.createElement('div');
    aiCard.className = 'bulk-welcome-card';
    aiCard.innerHTML = `<span class="bulk-welcome-icon">\uD83E\uDD16</span>
      <span class="bulk-welcome-name">AI Entity Builder</span>
      <span class="bulk-welcome-desc">Copy a prompt for an AI agent to generate entity creation JSON</span>`;
    aiCard.addEventListener('click', () => this._showAgentPrompt());
    cards.appendChild(aiCard);

    // Manual JSON card
    const manualCard = document.createElement('div');
    manualCard.className = 'bulk-welcome-card bulk-welcome-card-manual';
    manualCard.innerHTML = `<span class="bulk-welcome-icon">{}</span>
      <span class="bulk-welcome-name">Manual JSON</span>
      <span class="bulk-welcome-desc">Paste a JSON array of operations directly</span>`;
    manualCard.addEventListener('click', () => {
      this.container.innerHTML = '';
      // Back button to return to wizard grid
      const backBtn = document.createElement('button');
      backBtn.className = 'bulk-back-btn';
      backBtn.textContent = '\u2190 Back to Wizards';
      backBtn.style.cssText = 'padding:4px 12px; font-size:0.75rem; margin:8px 12px 0; background:transparent; color:var(--color-text-muted); border:1px solid var(--color-border); border-radius:var(--radius-sm); cursor:pointer;';
      backBtn.addEventListener('click', () => { this.container.innerHTML = ''; this._buildWelcomeGrid(); });
      this.container.appendChild(backBtn);
      this._buildFullUI();
    });
    cards.appendChild(manualCard);

    grid.appendChild(cards);
    this.container.appendChild(grid);
  }

  /** Show overlay with copiable AI agent prompt for entity creation. */
  _showAgentPrompt() {
    const overlay = this._createOverlay();
    const dialog = document.createElement('div');
    dialog.className = 'bulk-dialog';
    dialog.style.cssText = 'max-width:580px; max-height:80vh; display:flex; flex-direction:column;';

    const title = document.createElement('div');
    title.className = 'bulk-dialog-title';
    title.textContent = 'AI Entity Builder — Prompt';
    dialog.appendChild(title);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.75rem; color:var(--color-text-muted); margin-bottom:8px;';
    hint.textContent = 'Copy this prompt and paste it into any AI chat (Claude, ChatGPT, etc.). Describe your project and the AI will output a JSON array you can paste into Bulk Ops.';
    dialog.appendChild(hint);

    const pre = document.createElement('pre');
    pre.className = 'bulk-json-agent-prompt-pre';
    pre.textContent = AGENT_ENTITY_BUILDER_PROMPT;
    dialog.appendChild(pre);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:6px; margin-top:8px;';

    const copyBtn = this._createButton('Copy Prompt', 'btn-primary', () => {
      navigator.clipboard.writeText(pre.textContent).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Prompt'; }, 1500);
      });
    });
    const closeBtn = this._createButton('Close', 'btn-secondary', () => overlay.remove());
    btnRow.append(copyBtn, closeBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    this.container.appendChild(overlay);
  }

  /** Build the primary JSON paste panel shown above the operation list. */
  _buildJsonInputPanel() {
    const panel = document.createElement('div');
    panel.className = 'bulk-json-panel';

    // Header with explanation
    const header = document.createElement('div');
    header.className = 'bulk-json-header';
    header.innerHTML = `
      <strong>Paste Operations (JSON)</strong>
      <span class="bulk-json-hint">Array of operations — each with <code>method</code>, <code>url</code> (relative to API base, e.g. <code>accounts</code> or <code>EntityDefinitions</code>), and optional <code>body</code>. Operations execute sequentially as a single <code>$batch</code> request.</span>
    `;
    panel.appendChild(header);

    // Example toggler
    const exampleToggle = document.createElement('button');
    exampleToggle.className = 'bulk-json-example-btn';
    exampleToggle.textContent = 'Show example';
    const exampleBlock = document.createElement('pre');
    exampleBlock.className = 'bulk-json-example';
    exampleBlock.style.display = 'none';
    // Example: create two custom tables with a custom column created in between.
    // Uses the Dataverse Metadata API (EntityDefinitions / Attributes).
    exampleBlock.textContent = JSON.stringify([
      {
        "method": "POST",
        "url": "EntityDefinitions",
        "body": {
          "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
          "SchemaName": "new_Project",
          "DisplayName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Project", "LanguageCode": 1033 }] },
          "DisplayCollectionName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Projects", "LanguageCode": 1033 }] },
          "OwnershipType": "UserOwned",
          "HasActivities": false,
          "HasNotes": false,
          "PrimaryNameAttribute": "new_name",
          "Attributes": [{
            "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
            "SchemaName": "new_name",
            "RequiredLevel": { "Value": "ApplicationRequired" },
            "MaxLength": 100,
            "DisplayName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Name", "LanguageCode": 1033 }] }
          }]
        }
      },
      {
        "method": "POST",
        "url": "EntityDefinitions(LogicalName='new_project')/Attributes",
        "body": {
          "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
          "SchemaName": "new_Description",
          "MaxLength": 2000,
          "DisplayName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Description", "LanguageCode": 1033 }] }
        }
      },
      {
        "method": "POST",
        "url": "EntityDefinitions",
        "body": {
          "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata",
          "SchemaName": "new_Task",
          "DisplayName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Task", "LanguageCode": 1033 }] },
          "DisplayCollectionName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Tasks", "LanguageCode": 1033 }] },
          "OwnershipType": "UserOwned",
          "HasActivities": false,
          "HasNotes": false,
          "PrimaryNameAttribute": "new_name",
          "Attributes": [{
            "@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata",
            "SchemaName": "new_name",
            "RequiredLevel": { "Value": "ApplicationRequired" },
            "MaxLength": 100,
            "DisplayName": { "@odata.type": "Microsoft.Dynamics.CRM.Label", "LocalizedLabels": [{ "@odata.type": "Microsoft.Dynamics.CRM.LocalizedLabel", "Label": "Name", "LanguageCode": 1033 }] }
          }]
        }
      }
    ], null, 2);
    exampleToggle.addEventListener('click', () => {
      const shown = exampleBlock.style.display !== 'none';
      exampleBlock.style.display = shown ? 'none' : '';
      exampleToggle.textContent = shown ? 'Show example' : 'Hide example';
    });
    panel.appendChild(exampleToggle);
    panel.appendChild(exampleBlock);

    // Dynamic textarea (auto-resizes with content)
    import('./bulk-ops/dynamic-textarea.js').then(({ createDynamicTextarea }) => {
      const dt = createDynamicTextarea({
        placeholder: '[{ "method": "POST", "url": "accounts", "body": { "name": "Contoso" } }, ...]',
        className: 'bulk-json-textarea',
        minRows: 3,
        maxHeight: '40vh',
      });
      // dt.element is the wrapper div; the inner textarea is the second child
      const innerTextarea = dt.element.querySelector('textarea');
      this._jsonTextarea = innerTextarea || dt.element;
      this._jsonTextareaCtrl = dt;
      panel.insertBefore(dt.element, errorEl);
    }).catch(() => {
      // Fallback: plain textarea
      const textarea = document.createElement('textarea');
      textarea.className = 'bulk-json-textarea';
      textarea.placeholder = '[{ "method": "POST", "url": "accounts", "body": { "name": "Contoso" } }, ...]';
      textarea.rows = 8;
      this._jsonTextarea = textarea;
      panel.insertBefore(textarea, errorEl);
    });

    // Parse error display
    const errorEl = document.createElement('div');
    errorEl.className = 'bulk-json-error';
    errorEl.style.display = 'none';
    this._jsonErrorEl = errorEl;
    panel.appendChild(errorEl);

    // Action row
    const actionRow = document.createElement('div');
    actionRow.className = 'bulk-json-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'bulk-btn bulk-btn-primary';
    loadBtn.textContent = 'Load Operations';
    loadBtn.addEventListener('click', () => this._loadFromJson());

    const appendBtn = document.createElement('button');
    appendBtn.className = 'bulk-btn bulk-btn-secondary';
    appendBtn.textContent = 'Append to list';
    appendBtn.addEventListener('click', () => this._loadFromJson(true));

    actionRow.append(loadBtn, appendBtn);
    panel.appendChild(actionRow);

    this.container.appendChild(panel);
  }

  /** Parse the JSON textarea and populate operations. */
  _loadFromJson(append = false) {
    const raw = this._jsonTextarea?.value?.trim();
    if (!raw) {
      this._showJsonError('Paste a JSON array of operations first.');
      return;
    }
    let ops;
    try {
      ops = JSON.parse(raw);
    } catch (e) {
      this._showJsonError(`JSON parse error: ${e.message}`);
      return;
    }
    if (!Array.isArray(ops)) {
      this._showJsonError('Expected a JSON array [ ... ].');
      return;
    }
    const invalid = ops.findIndex(o => !o.method || !o.url);
    if (invalid !== -1) {
      this._showJsonError(`Operation at index ${invalid} is missing "method" or "url".`);
      return;
    }
    this._hideJsonError();
    if (!append) {
      this.operations = [];
      this.changeSets = [];
    }
    for (const op of ops) {
      this.addOperation({ method: op.method.toUpperCase(), url: op.url, body: op.body || null, description: op.description || '' });
    }
    this._showNotification(`Loaded ${ops.length} operation${ops.length !== 1 ? 's' : ''}.`, 'success');
  }

  _showJsonError(msg) {
    if (this._jsonErrorEl) { this._jsonErrorEl.textContent = msg; this._jsonErrorEl.style.display = ''; }
  }

  _hideJsonError() {
    if (this._jsonErrorEl) this._jsonErrorEl.style.display = 'none';
  }

  /**
   * Add an operation to the list.
   * @param {Partial<BulkOperation>} opDef
   * @returns {BulkOperation}
   */
  addOperation(opDef) {
    const op = {
      id: generateId(),
      method: opDef.method || 'POST',
      url: opDef.url || '',
      body: opDef.body || null,
      headers: opDef.headers || {},
      description: opDef.description || '',
      changeSetId: opDef.changeSetId || null,
      status: 'pending',
      result: null,
    };
    this.operations.push(op);
    this._renderOperationsList();
    return op;
  }

  /**
   * Remove an operation by ID.
   * @param {string} id
   */
  removeOperation(id) {
    this.operations = this.operations.filter(o => o.id !== id);
    this._renderOperationsList();
  }

  /**
   * Create a new ChangeSet.
   * @param {string} [label]
   * @returns {ChangeSet}
   */
  addChangeSet(label) {
    const cs = {
      id: generateId(),
      label: label || `ChangeSet ${this.changeSets.length + 1}`,
      color: nextChangeSetColor(),
    };
    this.changeSets.push(cs);
    this._renderOperationsList();
    return cs;
  }

  /**
   * Get all operations.
   * @returns {BulkOperation[]}
   */
  getOperations() {
    return [...this.operations];
  }

  // -- Module Bridge integration ----------------------------------------------

  /** Receive context from the AI agent. */
  setContext(ctx) {
    if (Array.isArray(ctx.operations)) {
      for (const op of ctx.operations) {
        this.addOperation(op);
      }
      this._renderOperationsList?.();
    }
  }

  /** Expose current state to the AI agent. */
  getContext() {
    return {
      operations: this.getOperations().map(op => ({
        method: op.method, url: op.url, body: op.body, description: op.description, status: op.status,
      })),
      count: this.operations.length,
      executing: this._executing || false,
    };
  }

  /**
   * Execute all operations via $batch.
   */
  async execute() {
    if (this._executing) return;
    await this._executeAll();
  }

  // -------------------------------------------------------------------------
  // UI Construction
  // -------------------------------------------------------------------------

  /** Build the top toolbar. */
  _buildToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'bulk-toolbar';

    const addBtn = this._createButton('+ Add Operation', 'btn-primary btn-sm', () => this._showAddOperationDialog());
    const addCsBtn = this._createButton('+ ChangeSet', 'btn-secondary btn-sm', () => {
      this.addChangeSet();
      this._showNotification('ChangeSet created.', 'success');
    });
    const importJsonBtn = this._createButton('Import JSON', 'btn-outline btn-sm', () => this._importJson());
    const importCsvBtn = this._createButton('Import CSV', 'btn-outline btn-sm', () => this._importCsv());
    const pasteBtn = this._createButton('Paste Records', 'btn-outline btn-sm', () => this._pasteRecords());
    const templateBtn = this._createButton('Wizards', 'btn-outline btn-sm', () => this._showTemplateMenu(templateBtn));

    const clearBtn = this._createButton('Clear All', 'btn-danger btn-sm', () => {
      if (confirm('Remove all operations?')) {
        this.operations = [];
        this.changeSets = [];
        this._renderOperationsList();
      }
    });

    toolbar.append(addBtn, addCsBtn, importJsonBtn, importCsvBtn, pasteBtn, templateBtn, clearBtn);
    this.container.appendChild(toolbar);
  }

  /** Build the operations list area. */
  _buildOperationsList() {
    const listSection = document.createElement('div');
    listSection.className = 'bulk-operations-list';
    this._operationsList = listSection;
    this.container.appendChild(listSection);
    this._renderOperationsList();
  }

  /** Build the configuration section. */
  _buildConfigSection() {
    const section = document.createElement('div');
    section.className = 'bulk-config-section';

    const header = document.createElement('div');
    header.className = 'bulk-section-header';
    header.textContent = 'Execution Settings';
    header.addEventListener('click', () => section.classList.toggle('collapsed'));
    section.appendChild(header);

    const content = document.createElement('div');
    content.className = 'bulk-section-content';

    // Continue on error
    const continueRow = document.createElement('div');
    continueRow.className = 'bulk-row';
    const continueLabel = document.createElement('label');
    continueLabel.className = 'bulk-checkbox-label';
    const continueCheck = document.createElement('input');
    continueCheck.type = 'checkbox';
    continueCheck.checked = this.continueOnError;
    continueCheck.addEventListener('change', () => { this.continueOnError = continueCheck.checked; });
    continueLabel.append(continueCheck, document.createTextNode(' Continue on error'));
    continueRow.appendChild(continueLabel);
    content.appendChild(continueRow);

    // Parallel execution
    const parallelRow = document.createElement('div');
    parallelRow.className = 'bulk-row';
    const parallelLabel = document.createElement('label');
    parallelLabel.className = 'bulk-checkbox-label';
    const parallelCheck = document.createElement('input');
    parallelCheck.type = 'checkbox';
    parallelCheck.checked = this.parallelExecution;
    parallelCheck.addEventListener('change', () => { this.parallelExecution = parallelCheck.checked; });
    parallelLabel.append(parallelCheck, document.createTextNode(' Parallel execution (multiple $batch calls)'));
    parallelRow.appendChild(parallelLabel);
    content.appendChild(parallelRow);

    // Batch size
    const batchRow = document.createElement('div');
    batchRow.className = 'bulk-row';
    const batchLabel = document.createElement('label');
    batchLabel.textContent = 'Batch size:';
    batchLabel.className = 'bulk-label';
    const batchInput = document.createElement('input');
    batchInput.type = 'number';
    batchInput.className = 'bulk-input bulk-input-sm';
    batchInput.min = '1';
    batchInput.max = '1000';
    batchInput.value = String(this.batchSize);
    batchInput.addEventListener('input', () => {
      this.batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, parseInt(batchInput.value, 10) || MAX_BATCH_SIZE));
    });
    batchRow.append(batchLabel, batchInput);
    content.appendChild(batchRow);

    // Throttle
    const throttleRow = document.createElement('div');
    throttleRow.className = 'bulk-row';
    const throttleLabel = document.createElement('label');
    throttleLabel.textContent = 'Throttle (ms):';
    throttleLabel.className = 'bulk-label';
    const throttleInput = document.createElement('input');
    throttleInput.type = 'number';
    throttleInput.className = 'bulk-input bulk-input-sm';
    throttleInput.min = '0';
    throttleInput.value = String(this.throttleMs);
    throttleInput.addEventListener('input', () => {
      this.throttleMs = Math.max(0, parseInt(throttleInput.value, 10) || 0);
    });
    throttleRow.append(throttleLabel, throttleInput);
    content.appendChild(throttleRow);

    section.appendChild(content);
    this.container.appendChild(section);
  }

  /** Build the progress display section. */
  _buildProgressSection() {
    const section = document.createElement('div');
    section.className = 'bulk-progress-section';
    section.style.display = 'none';
    this._progressSection = section;

    const bar = document.createElement('div');
    bar.className = 'bulk-progress-bar';
    const fill = document.createElement('div');
    fill.className = 'bulk-progress-fill';
    this._progressFill = fill;
    bar.appendChild(fill);
    section.appendChild(bar);

    const label = document.createElement('div');
    label.className = 'bulk-progress-label';
    this._progressLabel = label;
    section.appendChild(label);

    // Execute / Stop buttons
    const actionRow = document.createElement('div');
    actionRow.className = 'bulk-row';

    const executeBtn = this._createButton('Execute All', 'btn-primary', () => this._executeAll());
    this._executeBtn = executeBtn;

    const stopBtn = this._createButton('Stop', 'btn-danger', () => this._stopExecution());
    stopBtn.style.display = 'none';
    this._stopBtn = stopBtn;

    const retryBtn = this._createButton('Retry Failed', 'btn-secondary', () => this._retryFailed());
    retryBtn.style.display = 'none';
    this._retryBtn = retryBtn;

    actionRow.append(executeBtn, stopBtn, retryBtn);
    section.appendChild(actionRow);

    this.container.appendChild(section);
  }

  /** Build the results summary section. */
  _buildResultsSection() {
    const section = document.createElement('div');
    section.className = 'bulk-results-section';
    section.style.display = 'none';
    this._resultsSection = section;

    const summary = document.createElement('div');
    summary.className = 'bulk-results-summary';
    this._resultsSummary = summary;
    section.appendChild(summary);

    // Export buttons
    const exportRow = document.createElement('div');
    exportRow.className = 'bulk-row';
    const exportJsonBtn = this._createButton('Export Results (JSON)', 'btn-outline btn-sm', () => this._exportResults('json'));
    const exportCsvBtn = this._createButton('Export Results (CSV)', 'btn-outline btn-sm', () => this._exportResults('csv'));
    const exportOpsBtn = this._createButton('Export Operations', 'btn-outline btn-sm', () => this._exportOperations());
    exportRow.append(exportJsonBtn, exportCsvBtn, exportOpsBtn);
    section.appendChild(exportRow);

    this.container.appendChild(section);
  }

  // -------------------------------------------------------------------------
  // Operations List Rendering
  // -------------------------------------------------------------------------

  /** Render the full operations list with ChangeSet grouping. */
  _renderOperationsList() {
    if (!this._operationsList) return;
    this._operationsList.innerHTML = '';

    // Show execute button in progress section
    this._showProgressSection();

    if (this.operations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'bulk-empty';
      empty.textContent = 'No operations yet. Click "Add Operation" to get started.';
      this._operationsList.appendChild(empty);
      return;
    }

    // Summary counts
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'bulk-summary';
    summaryDiv.textContent = `${this.operations.length} operation${this.operations.length !== 1 ? 's' : ''} | ${this.changeSets.length} ChangeSet${this.changeSets.length !== 1 ? 's' : ''}`;
    this._operationsList.appendChild(summaryDiv);

    // Render ChangeSet groups
    for (const cs of this.changeSets) {
      const csOps = this.operations.filter(o => o.changeSetId === cs.id);
      this._renderChangeSet(cs, csOps);
    }

    // Render standalone operations (not in any ChangeSet)
    const standalone = this.operations.filter(o => !o.changeSetId || !this.changeSets.find(cs => cs.id === o.changeSetId));
    if (standalone.length > 0) {
      const standaloneHeader = document.createElement('div');
      standaloneHeader.className = 'bulk-standalone-header';
      standaloneHeader.textContent = 'Standalone Operations';
      this._operationsList.appendChild(standaloneHeader);

      for (const op of standalone) {
        this._renderOperationCard(op, this._operationsList);
      }
    }
  }

  /**
   * Render a ChangeSet group.
   * @param {ChangeSet} cs
   * @param {BulkOperation[]} ops
   */
  _renderChangeSet(cs, ops) {
    const group = document.createElement('div');
    group.className = 'bulk-changeset-group';
    group.style.borderLeftColor = cs.color;
    // Parse hex to rgba with low opacity for subtle background tint
    const r = parseInt(cs.color.slice(1, 3), 16);
    const g = parseInt(cs.color.slice(3, 5), 16);
    const b = parseInt(cs.color.slice(5, 7), 16);
    group.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.08)`;

    // Header
    const header = document.createElement('div');
    header.className = 'bulk-changeset-header';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'bulk-input bulk-cs-label';
    labelInput.value = cs.label;
    labelInput.addEventListener('input', () => { cs.label = labelInput.value; });

    const countBadge = document.createElement('span');
    countBadge.className = 'bulk-cs-count';
    countBadge.textContent = `${ops.length} ops`;

    const removeCsBtn = this._createButton('Remove', 'btn-danger btn-sm', () => {
      // Move operations out of this ChangeSet
      for (const op of ops) {
        op.changeSetId = null;
      }
      this.changeSets = this.changeSets.filter(c => c.id !== cs.id);
      this._renderOperationsList();
    });

    header.append(labelInput, countBadge, removeCsBtn);
    group.appendChild(header);

    // Drop zone for dragging operations into this ChangeSet
    group.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      group.classList.add('bulk-dragover');
    });
    group.addEventListener('dragleave', () => group.classList.remove('bulk-dragover'));
    group.addEventListener('drop', (e) => {
      e.preventDefault();
      group.classList.remove('bulk-dragover');
      if (this._dragSource) {
        const op = this.operations.find(o => o.id === this._dragSource);
        if (op) {
          op.changeSetId = cs.id;
          this._renderOperationsList();
        }
        this._dragSource = null;
      }
    });

    // Render operations in this ChangeSet
    for (const op of ops) {
      this._renderOperationCard(op, group);
    }

    this._operationsList.appendChild(group);
  }

  /**
   * Render a single operation card.
   * @param {BulkOperation} op
   * @param {HTMLElement} container
   */
  _renderOperationCard(op, container) {
    const card = document.createElement('div');
    card.className = `bulk-operation-card bulk-status-${op.status}`;
    card.draggable = true;

    // Drag-and-drop
    card.addEventListener('dragstart', (e) => {
      this._dragSource = op.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      this._dragSource = null;
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (this._dragSource && this._dragSource !== op.id) {
        // Reorder: move dragged operation to this position
        const srcIdx = this.operations.findIndex(o => o.id === this._dragSource);
        const targetIdx = this.operations.findIndex(o => o.id === op.id);
        if (srcIdx >= 0 && targetIdx >= 0) {
          const [moved] = this.operations.splice(srcIdx, 1);
          // Also adopt the ChangeSet of the drop target
          moved.changeSetId = op.changeSetId;
          this.operations.splice(targetIdx, 0, moved);
          this._renderOperationsList();
        }
        this._dragSource = null;
      }
    });

    // Drag handle
    const grip = document.createElement('span');
    grip.className = 'bulk-drag-handle';
    grip.textContent = '\u2261';
    grip.title = 'Drag to reorder';

    // Method badge
    const methodBadge = document.createElement('span');
    methodBadge.className = `bulk-method-badge bulk-method-${op.method.toLowerCase()}`;
    methodBadge.textContent = op.method;

    // URL / description
    const desc = document.createElement('span');
    desc.className = 'bulk-op-desc';
    desc.textContent = op.description || op.url;
    desc.title = `${op.method} ${op.url}`;

    // Status indicator
    const statusEl = document.createElement('span');
    statusEl.className = `bulk-op-status bulk-op-status-${op.status}`;
    statusEl.textContent = op.status;

    // Result indicator
    const resultBadge = document.createElement('span');
    resultBadge.className = 'bulk-op-result';
    if (op.result) {
      const ok = op.result.status >= 200 && op.result.status < 300;
      resultBadge.classList.add(ok ? 'bulk-result-ok' : 'bulk-result-err');
      resultBadge.textContent = op.result.status ? `${op.result.status}` : '';
    }

    // Action buttons wrapper
    const actions = document.createElement('span');
    actions.className = 'bulk-op-actions';
    const editBtn = this._createButton('Edit', 'btn-outline btn-xs', () => this._showEditOperationDialog(op));
    const removeBtn = this._createButton('\u00d7', 'btn-danger btn-xs', () => {
      this.removeOperation(op.id);
    });
    actions.append(editBtn, removeBtn);

    card.append(grip, methodBadge, desc, statusEl, resultBadge, actions);
    container.appendChild(card);
  }

  /** Show/update the progress section. */
  _showProgressSection() {
    if (!this._progressSection) return;
    this._progressSection.style.display = this.operations.length > 0 ? '' : 'none';
    this._executeBtn.style.display = this._executing ? 'none' : '';
    this._stopBtn.style.display = this._executing ? '' : 'none';
  }

  // -------------------------------------------------------------------------
  // Operation Dialogs
  // -------------------------------------------------------------------------

  /** Show the Add Operation dialog (enhanced with Entity Body Builder). */
  async _showAddOperationDialog() {
    try {
      const { EntityBodyBuilder } = await import('./bulk-ops/entity-body-builder.js');
      const builder = new EntityBodyBuilder(this.metadataCache);
      const result = await builder.show(this.container, { changeSets: this.changeSets });
      if (result) {
        this.addOperation(result);
      }
    } catch {
      // Fallback: simple raw dialog
      this._showAddOperationDialogSimple();
    }
  }

  /** Fallback Add Operation dialog (no metadata, raw JSON). */
  _showAddOperationDialogSimple() {
    const overlay = this._createOverlay();
    const dialog = document.createElement('div');
    dialog.className = 'bulk-dialog';

    const title = document.createElement('h3');
    title.textContent = 'Add Operation';
    dialog.appendChild(title);

    const methodRow = this._createFormRow('Method');
    const methodSelect = document.createElement('select');
    methodSelect.className = 'bulk-select';
    for (const m of HTTP_METHODS) {
      methodSelect.innerHTML += `<option value="${m}">${m}</option>`;
    }
    methodRow.appendChild(methodSelect);
    dialog.appendChild(methodRow);

    const urlRow = this._createFormRow('URL (relative)');
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'bulk-input';
    urlInput.placeholder = 'accounts or accounts(guid)';
    urlRow.appendChild(urlInput);
    dialog.appendChild(urlRow);

    const bodyRow = this._createFormRow('Body (JSON)');
    const bodyTextarea = document.createElement('textarea');
    bodyTextarea.className = 'bulk-textarea';
    bodyTextarea.rows = 8;
    bodyTextarea.placeholder = '{\n  "name": "Sample"\n}';
    bodyRow.appendChild(bodyTextarea);
    dialog.appendChild(bodyRow);

    const btnRow = document.createElement('div');
    btnRow.className = 'bulk-dialog-buttons';
    const addBtn = this._createButton('Add', 'btn-primary', () => {
      let body = null;
      if (bodyTextarea.value.trim()) {
        try { body = JSON.parse(bodyTextarea.value); }
        catch (err) { this._showNotification(`Invalid JSON: ${err.message}`, 'error'); return; }
      }
      this.addOperation({ method: methodSelect.value, url: urlInput.value, body });
      overlay.remove();
    });
    const cancelBtn = this._createButton('Cancel', 'btn-secondary', () => overlay.remove());
    btnRow.append(addBtn, cancelBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    this.container.appendChild(overlay);
  }

  /**
   * Show the edit operation dialog.
   * @param {BulkOperation} op
   */
  _showEditOperationDialog(op) {
    const overlay = this._createOverlay();
    const dialog = document.createElement('div');
    dialog.className = 'bulk-dialog';

    const title = document.createElement('h3');
    title.textContent = 'Edit Operation';
    dialog.appendChild(title);

    // Method
    const methodRow = this._createFormRow('Method');
    const methodSelect = document.createElement('select');
    methodSelect.className = 'bulk-select';
    for (const m of HTTP_METHODS) {
      methodSelect.innerHTML += `<option value="${m}" ${m === op.method ? 'selected' : ''}>${m}</option>`;
    }
    methodRow.appendChild(methodSelect);
    dialog.appendChild(methodRow);

    // URL
    const urlRow = this._createFormRow('URL');
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'bulk-input';
    urlInput.value = op.url;
    urlRow.appendChild(urlInput);
    dialog.appendChild(urlRow);

    // Description
    const descRow = this._createFormRow('Description');
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'bulk-input';
    descInput.value = op.description;
    descRow.appendChild(descInput);
    dialog.appendChild(descRow);

    // Body
    const bodyRow = this._createFormRow('Body (JSON)');
    const bodyTextarea = document.createElement('textarea');
    bodyTextarea.className = 'bulk-textarea';
    bodyTextarea.rows = 8;
    bodyTextarea.value = op.body ? JSON.stringify(op.body, null, 2) : '';
    bodyRow.appendChild(bodyTextarea);
    dialog.appendChild(bodyRow);

    // ChangeSet
    const csRow = this._createFormRow('ChangeSet');
    const csSelect = document.createElement('select');
    csSelect.className = 'bulk-select';
    csSelect.innerHTML = '<option value="">(None)</option>';
    for (const cs of this.changeSets) {
      csSelect.innerHTML += `<option value="${cs.id}" ${cs.id === op.changeSetId ? 'selected' : ''}>${cs.label}</option>`;
    }
    csRow.appendChild(csSelect);
    dialog.appendChild(csRow);

    // Result display (if executed)
    if (op.result) {
      const resultRow = this._createFormRow('Last Result');
      const resultPre = document.createElement('pre');
      resultPre.className = 'bulk-result-display';
      resultPre.textContent = JSON.stringify(op.result, null, 2);
      resultRow.appendChild(resultPre);
      dialog.appendChild(resultRow);
    }

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'bulk-dialog-buttons';

    const saveBtn = this._createButton('Save', 'btn-primary', () => {
      let body = null;
      if (bodyTextarea.value.trim()) {
        try {
          body = JSON.parse(bodyTextarea.value);
        } catch (err) {
          this._showNotification(`Invalid JSON: ${err.message}`, 'error');
          return;
        }
      }
      op.method = methodSelect.value;
      op.url = urlInput.value;
      op.body = body;
      op.description = descInput.value;
      op.changeSetId = csSelect.value || null;
      this._renderOperationsList();
      overlay.remove();
    });

    const cancelBtn = this._createButton('Cancel', 'btn-secondary', () => overlay.remove());
    btnRow.append(saveBtn, cancelBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    this.container.appendChild(overlay);
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  /**
   * Show the template menu.
   * @param {HTMLElement} anchor
   */
  _showTemplateMenu(anchor) {
    const menu = document.createElement('div');
    menu.className = 'bulk-dropdown-menu';

    const wizards = [
      { name: 'Bulk Create',     icon: '\u2795', file: 'wizard-bulk-create',    cls: 'BulkCreateWizard' },
      { name: 'Bulk Update',     icon: '\u270F\uFE0F', file: 'wizard-bulk-update',    cls: 'BulkUpdateWizard' },
      { name: 'Bulk Delete',     icon: '\u274C', file: 'wizard-bulk-delete',    cls: 'BulkDeleteWizard' },
      { name: 'Status Toggle',   icon: '\uD83D\uDD04', file: 'wizard-status-toggle', cls: 'StatusToggleWizard' },
      { name: 'Bulk Assign',     icon: '\uD83D\uDC64', file: 'wizard-bulk-assign',   cls: 'BulkAssignWizard' },
      { name: 'Deep Insert',     icon: '\uD83C\uDF33', file: 'wizard-deep-insert',   cls: 'DeepInsertWizard' },
      { separator: true },
      { name: 'Data Export (CMT)', icon: '\uD83D\uDCE4', file: 'cmt-export', cls: 'CmtExportWizard' },
      { name: 'Data Import (CMT)', icon: '\uD83D\uDCE5', file: 'cmt-import', cls: 'CmtImportWizard' },
    ];

    for (const w of wizards) {
      if (w.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px solid var(--color-border-subtle); margin:4px 0;';
        menu.appendChild(sep);
        continue;
      }
      const item = document.createElement('div');
      item.className = 'bulk-menu-item';
      item.textContent = `${w.icon} ${w.name}`;
      item.addEventListener('click', () => {
        menu.remove();
        this._launchWizard(w.file, w.cls);
      });
      menu.appendChild(item);
    }

    anchor.style.position = 'relative';
    anchor.appendChild(menu);

    const close = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  /**
   * Launch a wizard by dynamically importing its module.
   * @param {string} moduleFile - filename in bulk-ops/ (without .js)
   * @param {string} className  - exported class name
   */
  async _launchWizard(moduleFile, className) {
    try {
      const module = await import(`./bulk-ops/${moduleFile}.js`);
      const WizardClass = module[className] || module.default;
      const wizard = new WizardClass(this.metadataCache, this.apiClient);
      const operations = await wizard.show(this.container);
      if (operations && operations.length > 0) {
        // Switch from welcome grid to full UI if needed
        const wasEmpty = this.operations.length === 0;
        for (const op of operations) {
          this.operations.push({
            id: generateId(), method: op.method || 'POST', url: op.url || '',
            body: op.body || null, headers: op.headers || {}, description: op.description || '',
            changeSetId: op.changeSetId || null, status: 'pending', result: null,
          });
        }
        if (wasEmpty) {
          this.container.innerHTML = '';
          this._buildFullUI();
        } else {
          this._renderOperationsList();
        }
        this._showNotification(`Added ${operations.length} operation(s) from wizard.`, 'success');
      }
    } catch (err) {
      this._showNotification(`Wizard error: ${err.message}`, 'error');
      console.error('Wizard error:', err);
    }
  }

  /** Template: Bulk create from JSON. Prompt user for entity and JSON array. */
  _templateBulkCreateJson() {
    const entitySet = prompt('Entity set name (e.g., accounts):');
    if (!entitySet) return;

    const jsonStr = prompt('Paste JSON array of records (or enter number to create empty records):');
    if (!jsonStr) return;

    try {
      const count = parseInt(jsonStr, 10);
      if (!isNaN(count) && count > 0) {
        for (let i = 0; i < Math.min(count, MAX_BATCH_SIZE); i++) {
          this.addOperation({
            method: 'POST',
            url: entitySet,
            body: {},
            description: `Create ${entitySet} #${i + 1}`,
          });
        }
        return;
      }

      const records = JSON.parse(jsonStr);
      if (!Array.isArray(records)) {
        this._showNotification('Expected a JSON array.', 'error');
        return;
      }

      for (let i = 0; i < records.length; i++) {
        this.addOperation({
          method: 'POST',
          url: entitySet,
          body: records[i],
          description: `Create ${entitySet} #${i + 1}`,
        });
      }
    } catch (err) {
      this._showNotification(`Invalid JSON: ${err.message}`, 'error');
    }
  }

  /** Template: Bulk update. */
  _templateBulkUpdate() {
    const entitySet = prompt('Entity set name (e.g., accounts):');
    if (!entitySet) return;
    const guids = prompt('Comma-separated GUIDs of records to update:');
    if (!guids) return;
    const updateJson = prompt('JSON update body (applied to all records):');
    if (!updateJson) return;

    try {
      const body = JSON.parse(updateJson);
      const ids = guids.split(',').map(g => g.trim()).filter(Boolean);
      for (const id of ids) {
        this.addOperation({
          method: 'PATCH',
          url: `${entitySet}(${id})`,
          body,
          description: `Update ${entitySet} ${id}`,
        });
      }
    } catch (err) {
      this._showNotification(`Invalid JSON: ${err.message}`, 'error');
    }
  }

  /** Template: Bulk delete. */
  _templateBulkDelete() {
    const entitySet = prompt('Entity set name (e.g., accounts):');
    if (!entitySet) return;
    const guids = prompt('Comma-separated GUIDs of records to delete:');
    if (!guids) return;

    const ids = guids.split(',').map(g => g.trim()).filter(Boolean);
    for (const id of ids) {
      this.addOperation({
        method: 'DELETE',
        url: `${entitySet}(${id})`,
        description: `Delete ${entitySet} ${id}`,
      });
    }
  }

  /** Template: Bulk associate. */
  _templateBulkAssociate() {
    const primaryEntitySet = prompt('Primary entity set (e.g., accounts):');
    if (!primaryEntitySet) return;
    const primaryId = prompt('Primary record GUID:');
    if (!primaryId) return;
    const relationship = prompt('Relationship name:');
    if (!relationship) return;
    const relatedEntitySet = prompt('Related entity set (e.g., contacts):');
    if (!relatedEntitySet) return;
    const relatedIds = prompt('Comma-separated related record GUIDs:');
    if (!relatedIds) return;

    const baseUrl = this.apiClient.baseUrl || '/api/data/v9.2';
    const ids = relatedIds.split(',').map(g => g.trim()).filter(Boolean);
    for (const id of ids) {
      this.addOperation({
        method: 'POST',
        url: `${primaryEntitySet}(${primaryId})/${relationship}/$ref`,
        body: { '@odata.id': `${baseUrl}/${relatedEntitySet}(${id})` },
        description: `Associate ${relatedEntitySet} ${id}`,
      });
    }
  }

  /** Template: Bulk disassociate. */
  _templateBulkDisassociate() {
    const primaryEntitySet = prompt('Primary entity set (e.g., accounts):');
    if (!primaryEntitySet) return;
    const primaryId = prompt('Primary record GUID:');
    if (!primaryId) return;
    const relationship = prompt('Relationship name:');
    if (!relationship) return;
    const relatedIds = prompt('Comma-separated related record GUIDs to disassociate:');
    if (!relatedIds) return;

    const ids = relatedIds.split(',').map(g => g.trim()).filter(Boolean);
    for (const id of ids) {
      this.addOperation({
        method: 'DELETE',
        url: `${primaryEntitySet}(${primaryId})/${relationship}(${id})/$ref`,
        description: `Disassociate ${id}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Import / Export
  // -------------------------------------------------------------------------

  /** Import operations from a JSON file. */
  _importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (Array.isArray(data)) {
          // Array of operation definitions
          for (const item of data) {
            this.addOperation(item);
          }
          this._showNotification(`Imported ${data.length} operations.`, 'success');
        } else if (data.operations) {
          // Exported format with operations and change sets
          if (data.changeSets) {
            for (const cs of data.changeSets) {
              this.changeSets.push(cs);
            }
          }
          for (const op of data.operations) {
            this.addOperation(op);
          }
          this._showNotification(`Imported ${data.operations.length} operations.`, 'success');
        } else {
          // Single record -> single create operation
          const entitySet = prompt('Entity set for this record:');
          if (entitySet) {
            this.addOperation({ method: 'POST', url: entitySet, body: data, description: 'Create from import' });
          }
        }
      } catch (err) {
        this._showNotification(`Import failed: ${err.message}`, 'error');
      }
    });
    input.click();
  }

  /** Import records from a CSV file. */
  _importCsv() {
    const entitySet = prompt('Entity set name for these records (e.g., accounts):');
    if (!entitySet) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const records = parseCsv(text);
        if (records.length === 0) {
          this._showNotification('No records found in CSV.', 'warning');
          return;
        }

        // Show column mapping dialog
        this._showCsvMappingDialog(entitySet, records);
      } catch (err) {
        this._showNotification(`CSV import failed: ${err.message}`, 'error');
      }
    });
    input.click();
  }

  /**
   * Show a dialog to map CSV columns to entity attributes.
   * @param {string} entitySet
   * @param {Object[]} records
   */
  _showCsvMappingDialog(entitySet, records) {
    const overlay = this._createOverlay();
    const dialog = document.createElement('div');
    dialog.className = 'bulk-dialog bulk-dialog-wide';

    const title = document.createElement('h3');
    title.textContent = `Map CSV Columns to ${entitySet} attributes`;
    dialog.appendChild(title);

    const info = document.createElement('p');
    info.textContent = `${records.length} records found. Map each CSV column to a Dataverse attribute name.`;
    dialog.appendChild(info);

    const csvColumns = Object.keys(records[0]);
    const mappings = {};

    for (const col of csvColumns) {
      const row = document.createElement('div');
      row.className = 'bulk-row';

      const label = document.createElement('label');
      label.className = 'bulk-label';
      label.textContent = col;

      const attrInput = document.createElement('input');
      attrInput.type = 'text';
      attrInput.className = 'bulk-input';
      attrInput.placeholder = 'Dataverse attribute name (leave blank to skip)';
      attrInput.value = col; // Default: same name
      mappings[col] = col;
      attrInput.addEventListener('input', () => {
        mappings[col] = attrInput.value.trim();
      });

      row.append(label, attrInput);
      dialog.appendChild(row);
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'bulk-dialog-buttons';

    const importBtn = this._createButton('Import', 'btn-primary', () => {
      for (let i = 0; i < records.length; i++) {
        const body = {};
        for (const [csvCol, attrName] of Object.entries(mappings)) {
          if (attrName) {
            body[attrName] = records[i][csvCol];
          }
        }
        this.addOperation({
          method: 'POST',
          url: entitySet,
          body,
          description: `CSV import #${i + 1}`,
        });
      }
      this._showNotification(`Imported ${records.length} records as create operations.`, 'success');
      overlay.remove();
    });

    const cancelBtn = this._createButton('Cancel', 'btn-secondary', () => overlay.remove());
    btnRow.append(importBtn, cancelBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    this.container.appendChild(overlay);
  }

  /** Paste JSON records to create operations. */
  _pasteRecords() {
    const entitySet = prompt('Entity set name (e.g., accounts):');
    if (!entitySet) return;

    const jsonStr = prompt('Paste JSON array of record objects:');
    if (!jsonStr) return;

    try {
      const records = JSON.parse(jsonStr);
      if (!Array.isArray(records)) {
        this._showNotification('Expected a JSON array.', 'error');
        return;
      }
      for (let i = 0; i < records.length; i++) {
        this.addOperation({
          method: 'POST',
          url: entitySet,
          body: records[i],
          description: `Create ${entitySet} #${i + 1}`,
        });
      }
      this._showNotification(`Added ${records.length} create operations.`, 'success');
    } catch (err) {
      this._showNotification(`Invalid JSON: ${err.message}`, 'error');
    }
  }

  /** Export operation definitions as JSON. */
  _exportOperations() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      operations: this.operations.map(op => ({
        method: op.method,
        url: op.url,
        body: op.body,
        headers: op.headers,
        description: op.description,
        changeSetId: op.changeSetId,
      })),
      changeSets: this.changeSets,
    };
    this._downloadJson(data, 'dataverse-bulk-operations.json');
  }

  /**
   * Export results in the specified format.
   * @param {'json'|'csv'} format
   */
  _exportResults(format) {
    const results = this.operations.map(op => ({
      method: op.method,
      url: op.url,
      description: op.description,
      status: op.status,
      responseStatus: op.result?.status || '',
      responseBody: op.result?.body ? JSON.stringify(op.result.body) : '',
    }));

    if (format === 'csv') {
      const csv = toCsv(results);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bulk-results.csv';
      a.click();
      URL.revokeObjectURL(url);
    } else {
      this._downloadJson(results, 'bulk-results.json');
    }

    this._showNotification(`Results exported as ${format.toUpperCase()}.`, 'success');
  }

  /**
   * Download data as a JSON file.
   * @param {*} data
   * @param {string} filename
   */
  _downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /** Execute all pending operations. */
  async _executeAll() {
    if (this._executing) return;
    this._executing = true;
    this._abortController = new AbortController();

    this._executeBtn.style.display = 'none';
    this._stopBtn.style.display = '';
    this._retryBtn.style.display = 'none';
    this._progressSection.style.display = '';
    this._resultsSection.style.display = 'none';

    // Reset statuses
    for (const op of this.operations) {
      if (op.status !== 'success') {
        op.status = 'pending';
        op.result = null;
      }
    }
    this._renderOperationsList();

    const pending = this.operations.filter(o => o.status === 'pending');

    try {
      if (this.parallelExecution) {
        await this._executeParallel(pending);
      } else {
        await this._executeSequential(pending);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        this._showNotification(`Execution error: ${err.message}`, 'error');
      }
    } finally {
      this._executing = false;
      this._executeBtn.style.display = '';
      this._stopBtn.style.display = 'none';
      this._showResultsSummary();
      this._renderOperationsList();

      // Show retry button if any failed
      const failed = this.operations.filter(o => o.status === 'failed');
      this._retryBtn.style.display = failed.length > 0 ? '' : 'none';

      // Easter egg achievements
      import('./easter-eggs.js').then(ee => {
        ee.unlockAchievement('first_bulk');
        if (pending.length >= 100) ee.unlockAchievement('bulk_100');
        ee.maybeShowClippy('bulk');
      }).catch(() => {});
    }
  }

  /**
   * Execute operations sequentially in batches.
   * @param {BulkOperation[]} operations
   */
  async _executeSequential(operations) {
    const batches = this._chunkOperations(operations);
    let completed = 0;
    const total = operations.length;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (this._abortController.signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const batch = batches[batchIdx];

      // Mark batch operations as running
      for (const op of batch) op.status = 'running';
      this._renderOperationsList();

      try {
        await this._executeBatch(batch);
      } catch (err) {
        for (const op of batch) {
          if (op.status === 'running') {
            op.status = 'failed';
            op.result = { status: 0, statusText: err.message, body: null };
          }
        }
        if (!this.continueOnError) throw err;
      }

      completed += batch.length;
      this._updateProgress(completed, total);

      // Throttle between batches
      if (this.throttleMs > 0 && batchIdx < batches.length - 1) {
        await new Promise(r => setTimeout(r, this.throttleMs));
      }
    }
  }

  /**
   * Execute operations in parallel batches.
   * @param {BulkOperation[]} operations
   */
  async _executeParallel(operations) {
    const batches = this._chunkOperations(operations);
    const total = operations.length;
    let completed = 0;

    // Execute all batches concurrently
    const promises = batches.map(async (batch, batchIdx) => {
      // Stagger parallel requests to avoid thundering herd
      if (this.throttleMs > 0 && batchIdx > 0) {
        await new Promise(r => setTimeout(r, this.throttleMs * batchIdx));
      }

      if (this._abortController.signal.aborted) return;

      for (const op of batch) op.status = 'running';

      try {
        await this._executeBatch(batch);
      } catch (err) {
        for (const op of batch) {
          if (op.status === 'running') {
            op.status = 'failed';
            op.result = { status: 0, statusText: err.message, body: null };
          }
        }
      }

      completed += batch.length;
      this._updateProgress(completed, total);
    });

    await Promise.all(promises);
  }

  /**
   * Execute a single batch of operations via $batch API.
   * @param {BulkOperation[]} batchOps
   */
  async _executeBatch(batchOps) {
    const { contentType, body } = buildBatchBody(batchOps, this.changeSets);

    const response = await this.apiClient.requestRaw('POST', '$batch', {
      headers: {
        'Content-Type': contentType,
        Accept: 'application/json',
      },
      body,
    });

    // Parse individual results from the batch response
    if (response.ok) {
      // For simplified $batch responses (JSON), results may be in response.data
      if (response.data && Array.isArray(response.data.responses)) {
        // JSON batch response format
        for (let i = 0; i < batchOps.length && i < response.data.responses.length; i++) {
          const result = response.data.responses[i];
          batchOps[i].result = result;
          batchOps[i].status = (result.status >= 200 && result.status < 300) ? 'success' : 'failed';
        }
      } else if (typeof response.data === 'string') {
        // Multipart response - parse
        const respContentType = response.headers?.['content-type'] || '';
        const results = parseBatchResponse(response.data, respContentType);
        for (let i = 0; i < batchOps.length && i < results.length; i++) {
          batchOps[i].result = results[i];
          batchOps[i].status = (results[i].status >= 200 && results[i].status < 300) ? 'success' : 'failed';
        }
      } else {
        // If response doesn't have individual results, mark all as success
        for (const op of batchOps) {
          op.status = 'success';
          op.result = { status: response.status, statusText: response.statusText, body: null };
        }
      }
    } else {
      // Entire batch failed
      for (const op of batchOps) {
        op.status = 'failed';
        op.result = { status: response.status, statusText: response.statusText, body: response.data };
      }
    }
  }

  /**
   * Chunk operations into batches of the configured batch size.
   * @param {BulkOperation[]} operations
   * @returns {BulkOperation[][]}
   */
  _chunkOperations(operations) {
    const chunks = [];
    for (let i = 0; i < operations.length; i += this.batchSize) {
      chunks.push(operations.slice(i, i + this.batchSize));
    }
    return chunks;
  }

  /**
   * Update the progress bar.
   * @param {number} completed
   * @param {number} total
   */
  _updateProgress(completed, total) {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (this._progressFill) {
      this._progressFill.style.width = `${pct}%`;
    }
    if (this._progressLabel) {
      this._progressLabel.textContent = `${completed} / ${total} (${pct}%)`;
    }
  }

  /** Stop the current execution. */
  _stopExecution() {
    if (this._abortController) {
      this._abortController.abort();
    }
    // Mark running operations as skipped
    for (const op of this.operations) {
      if (op.status === 'running' || op.status === 'pending') {
        op.status = 'skipped';
      }
    }
    this._renderOperationsList();
    this._showNotification('Execution stopped.', 'warning');
  }

  /** Retry all failed operations. */
  async _retryFailed() {
    for (const op of this.operations) {
      if (op.status === 'failed' || op.status === 'skipped') {
        op.status = 'pending';
        op.result = null;
      }
    }
    this._renderOperationsList();
    await this._executeAll();
  }

  /** Show the results summary. */
  _showResultsSummary() {
    this._resultsSection.style.display = '';

    const succeeded = this.operations.filter(o => o.status === 'success').length;
    const failed = this.operations.filter(o => o.status === 'failed').length;
    const skipped = this.operations.filter(o => o.status === 'skipped').length;
    const pending = this.operations.filter(o => o.status === 'pending').length;
    const total = this.operations.length;

    this._resultsSummary.innerHTML = '';

    const stats = document.createElement('div');
    stats.className = 'bulk-results-stats';
    stats.innerHTML = [
      `<span class="bulk-stat bulk-stat-total">Total: ${total}</span>`,
      `<span class="bulk-stat bulk-stat-success">Succeeded: ${succeeded}</span>`,
      `<span class="bulk-stat bulk-stat-failed">Failed: ${failed}</span>`,
      skipped > 0 ? `<span class="bulk-stat bulk-stat-skipped">Skipped: ${skipped}</span>` : '',
      pending > 0 ? `<span class="bulk-stat bulk-stat-pending">Pending: ${pending}</span>` : '',
    ].filter(Boolean).join(' ');
    this._resultsSummary.appendChild(stats);
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  /** Load entities from cache. */
  async _loadEntities() {
    try {
      this._entities = await this.metadataCache.getEntities() || [];
    } catch {
      this._entities = [];
    }
  }

  // -------------------------------------------------------------------------
  // UI Helpers
  // -------------------------------------------------------------------------

  /**
   * Create a styled button.
   * @param {string} text
   * @param {string} className
   * @param {Function} onClick
   * @returns {HTMLButtonElement}
   */
  _createButton(text, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bulk-btn ${className}`;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * Create an overlay for dialogs.
   * @returns {HTMLElement}
   */
  _createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'bulk-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    return overlay;
  }

  /**
   * Create a form row with label.
   * @param {string} label
   * @returns {HTMLElement}
   */
  _createFormRow(label) {
    const row = document.createElement('div');
    row.className = 'bulk-form-row';
    const lbl = document.createElement('label');
    lbl.className = 'bulk-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    return row;
  }

  /**
   * Show a temporary notification.
   * @param {string} message
   * @param {'success'|'error'|'warning'|'info'} type
   */
  _showNotification(message, type = 'info') {
    const existing = this.container.querySelector('.bulk-notification');
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.className = `bulk-notification bulk-notification-${type}`;
    notif.textContent = message;
    this.container.prepend(notif);
    setTimeout(() => notif.remove(), 4000);
  }
}

// ---------------------------------------------------------------------------
// Static exports for testing / reuse
// ---------------------------------------------------------------------------

export { buildBatchBody, parseBatchResponse, parseCsv, toCsv };

export default BulkOperations;
