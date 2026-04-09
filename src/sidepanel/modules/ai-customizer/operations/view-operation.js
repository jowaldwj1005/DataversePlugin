/**
 * AI Customizer — View Operation
 *
 * Handles Dataverse view (savedquery / userquery) modification:
 * selector UI, system prompt, validation, apply/revert/publish.
 */

import { OperationBase } from './base.js';

const CSS = 'ac';

export class ViewOperation extends OperationBase {
  #viewType = 'system';
  #views = [];
  #selectedView = null;
  #selectedEntity = null;
  #originalLayoutXml = '';
  #originalFetchXml = '';
  #backupLayoutXml = '';
  #backupFetchXml = '';
  #backupViewId = '';
  #createMode = false;
  #createName = '';

  // DOM refs
  #viewTypeSelect = null;
  #viewSelect = null;
  #newNameInput = null;
  #onReady = null;

  get id() { return 'view'; }
  get label() { return 'View'; }

  get canRevert() { return !!this.#backupViewId; }
  get isCreateMode() { return this.#createMode; }

  get currentState() {
    return {
      viewName: this.#createMode ? this.#createName : (this.#selectedView?.name || ''),
      layoutxml: this.#originalLayoutXml,
      fetchxml: this.#originalFetchXml,
    };
  }

  setEntity(entity) {
    this.#selectedEntity = entity;
    this.#createMode = false;
  }

  /**
   * Update the baseline XML after a successful apply.
   * Called to keep the context current for follow-up prompts.
   */
  refreshBaseline(layoutxml, fetchxml) {
    this.#originalLayoutXml = layoutxml;
    this.#originalFetchXml = fetchxml;
    if (this.#selectedView) {
      this.#selectedView.layoutxml = layoutxml;
      this.#selectedView.fetchxml = fetchxml;
    }
  }

  /**
   * Build view-specific selectors: view type (system/personal) + view dropdown.
   */
  buildSelectorUI(container, onReady) {
    this.#onReady = onReady;
    container.innerHTML = '';

    // View type selector
    const typeGroup = document.createElement('div');
    typeGroup.className = `${CSS}-select-group`;
    const typeLabel = document.createElement('label');
    typeLabel.className = `${CSS}-select-label`;
    typeLabel.textContent = 'Type';
    this.#viewTypeSelect = document.createElement('select');
    this.#viewTypeSelect.className = `${CSS}-select`;
    const sysOpt = document.createElement('option');
    sysOpt.value = 'system';
    sysOpt.textContent = 'System Views';
    sysOpt.selected = this.#viewType === 'system';
    const persOpt = document.createElement('option');
    persOpt.value = 'personal';
    persOpt.textContent = 'Personal Views';
    persOpt.selected = this.#viewType === 'personal';
    this.#viewTypeSelect.append(sysOpt, persOpt);
    this.#viewTypeSelect.addEventListener('change', () => {
      this.#viewType = this.#viewTypeSelect.value;
      this.loadViews();
    });
    typeGroup.append(typeLabel, this.#viewTypeSelect);

    // View selector
    const viewGroup = document.createElement('div');
    viewGroup.className = `${CSS}-select-group`;
    const viewLabel = document.createElement('label');
    viewLabel.className = `${CSS}-select-label`;
    viewLabel.textContent = 'View';

    // Row: dropdown + "+New" button side by side
    const viewRow = document.createElement('div');
    viewRow.style.cssText = 'display:flex;gap:4px;align-items:center;';

    this.#viewSelect = document.createElement('select');
    this.#viewSelect.className = `${CSS}-select`;
    this.#viewSelect.style.flex = '1';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select view...';
    this.#viewSelect.appendChild(placeholder);
    this.#viewSelect.addEventListener('change', () => this.#onViewChanged());

    const newBtn = document.createElement('button');
    newBtn.className = `${CSS}-btn ${CSS}-btn-tiny`;
    newBtn.textContent = '+New';
    newBtn.title = 'Create a new view';
    newBtn.addEventListener('click', () => this.#enterCreateMode());

    viewRow.append(this.#viewSelect, newBtn);

    // Hidden new-view name input (shown in create mode)
    this.#newNameInput = document.createElement('input');
    this.#newNameInput.type = 'text';
    this.#newNameInput.className = `${CSS}-select`;
    this.#newNameInput.placeholder = 'New view name...';
    this.#newNameInput.style.display = 'none';

    viewGroup.append(viewLabel, viewRow, this.#newNameInput);
    container.append(typeGroup, viewGroup);
  }

  #enterCreateMode() {
    if (!this.#selectedEntity) return;
    this.#createMode = true;
    this.#viewSelect.style.display = 'none';
    this.#newNameInput.style.display = '';
    this.#newNameInput.value = '';
    this.#newNameInput.focus();

    // Set blank baseline for new view
    const entityName = this.#selectedEntity.LogicalName;
    const primaryId = this.#selectedEntity.PrimaryIdAttribute || `${entityName}id`;
    const primaryName = this.#selectedEntity.PrimaryNameAttribute || 'name';

    this.#originalLayoutXml = `<grid name="resultset" object="1" jump="${primaryName}" select="1" icon="1" preview="1"><row name="result" id="${primaryId}"><cell name="${primaryName}" width="300" /></row></grid>`;
    this.#originalFetchXml = `<fetch><entity name="${entityName}"><attribute name="${primaryId}" /><attribute name="${primaryName}" /><order attribute="${primaryName}" descending="false" /><filter type="and"><condition attribute="statecode" operator="eq" value="0" /></filter></entity></fetch>`;

    this.#newNameInput.addEventListener('input', () => {
      this.#createName = this.#newNameInput.value.trim();
    }, { once: false });

    this.#onReady?.({
      operationType: 'view',
      viewType: this.#viewType,
      viewName: '(new view)',
      viewId: null,
      entityLogicalName: entityName,
      entitySetName: this.#selectedEntity.EntitySetName,
      layoutxml: this.#originalLayoutXml,
      fetchxml: this.#originalFetchXml,
    });
  }

  #exitCreateMode() {
    this.#createMode = false;
    this.#createName = '';
    if (this.#viewSelect) this.#viewSelect.style.display = '';
    if (this.#newNameInput) this.#newNameInput.style.display = 'none';
  }

  async loadViews() {
    this.#clearViewDropdown();
    if (!this.#selectedEntity) return [];

    const entity = this.#selectedEntity.LogicalName;
    const isSystem = this.#viewType === 'system';
    const entitySet = isSystem ? 'savedqueries' : 'userqueries';
    const idField = isSystem ? 'savedqueryid' : 'userqueryid';

    const data = await this.api.request('GET',
      `${entitySet}?$select=name,layoutxml,fetchxml,querytype,${idField}` +
      `&$filter=returnedtypecode eq '${entity}' and querytype eq 0 and statecode eq 0`
    );
    this.#views = data.value || [];
    this.#populateViewDropdown(idField);
    return this.#views;
  }

  #populateViewDropdown(idField) {
    if (!this.#viewSelect) return;
    for (const view of this.#views) {
      const opt = document.createElement('option');
      opt.value = view[idField];
      opt.textContent = view.name;
      this.#viewSelect.appendChild(opt);
    }
  }

  #clearViewDropdown() {
    if (!this.#viewSelect) return;
    while (this.#viewSelect.options.length > 1) this.#viewSelect.remove(1);
    this.#selectedView = null;
    this.#originalLayoutXml = '';
    this.#originalFetchXml = '';
  }

  #onViewChanged() {
    const idField = this.#viewType === 'system' ? 'savedqueryid' : 'userqueryid';
    const viewId = this.#viewSelect.value;
    if (!viewId) {
      this.#selectedView = null;
      return;
    }
    this.#selectedView = this.#views.find(v => v[idField] === viewId) || null;
    if (this.#selectedView) {
      this.#originalLayoutXml = this.#selectedView.layoutxml || '';
      this.#originalFetchXml = this.#selectedView.fetchxml || '';
      this.#onReady?.({
        operationType: 'view',
        viewType: this.#viewType,
        viewName: this.#selectedView.name,
        viewId,
        entityLogicalName: this.#selectedEntity.LogicalName,
        entitySetName: this.#selectedEntity.EntitySetName,
        layoutxml: this.#originalLayoutXml,
        fetchxml: this.#originalFetchXml,
      });
    }
  }

  buildSystemPrompt(context) {
    const attrLines = (context.attributes || [])
      .map(a => {
        const dn = a.DisplayName?.UserLocalizedLabel?.Label || '';
        return `  ${a.LogicalName} (${a.AttributeType})${dn ? ` — "${dn}"` : ''}`;
      })
      .join('\n');

    const relLines = (context.relationships || [])
      .map(r => {
        const dir = r.ReferencingEntity === context.entityLogicalName ? 'N:1' : '1:N';
        const related = dir === 'N:1' ? r.ReferencedEntity : r.ReferencingEntity;
        const lookupField = dir === 'N:1' ? r.ReferencingAttribute : r.ReferencedAttribute;
        const nav = dir === 'N:1'
          ? r.ReferencingEntityNavigationPropertyName
          : r.ReferencedEntityNavigationPropertyName;
        return `  ${r.SchemaName} (${dir} → ${related}) lookup: ${lookupField || '—'} nav: ${nav || '—'}`;
      })
      .join('\n');

    return `You are a Dataverse / Dynamics 365 customization assistant.
Your task: modify a Saved Query (view) based on the user's instruction.

## Response Format
Respond with a JSON object. The "status" field determines the type:

### Final answer:
{ "status": "done", "layoutxml": "<grid>...</grid>", "fetchxml": "<fetch>...</fetch>", "reasoning": "Markdown explanation of changes" }

### Need related entity metadata:
{ "status": "need_metadata", "entity": "systemuser", "reasoning": "Why I need this entity's attributes" }

### Question for the user:
{ "status": "question", "question": "Your question text", "reasoning": "Why I'm asking" }

### Error:
{ "status": "error", "error": "Error description", "reasoning": "What went wrong" }

The "reasoning" field is REQUIRED in every response. Use Markdown formatting (bold, lists, code).

## View Column Patterns — CRITICAL (study the real examples below)

### Pattern 1 — Simple fields on the main entity:
For regular fields (String, Number, DateTime, Boolean), use the attribute name directly in BOTH fetchxml and layoutxml:
  fetchxml:  <attribute name="jw_name" />
  layoutxml: <cell name="jw_name" width="300" />

### Pattern 2 — Lookup fields on the main entity:
Lookup fields automatically show the PRIMARY NAME of the related record as a CLICKABLE LINK.
This is the correct way to show a related record's name — NOT via link-entity!

The fetchxml always uses the REAL lookup attribute name.
The layoutxml cell ALSO uses the SAME attribute name — NO "name" suffix. This applies to ALL lookups, both system and custom:

  fetchxml:  <attribute name="createdby" />
  layoutxml: <cell name="createdby" width="104" />       ← shows creator as clickable link

  fetchxml:  <attribute name="ownerid" />
  layoutxml: <cell name="ownerid" width="100" />

  fetchxml:  <attribute name="jw_threadid" />
  layoutxml: <cell name="jw_threadid" width="100" />     ← shows Thread title as clickable link

  fetchxml:  <attribute name="jw_agentid" />
  layoutxml: <cell name="jw_agentid" width="100" />      ← shows Agent name as clickable link

CRITICAL: NEVER add "name" suffix to ANY lookup cell name!
  WRONG: <cell name="createdbyname" />     ← do not use!
  WRONG: <cell name="jw_threadidname" />   ← BROKEN!
  CORRECT: <cell name="createdby" />       ← correct for ALL lookups
  CORRECT: <cell name="jw_threadid" />     ← correct for ALL lookups

CRITICAL: NEVER include the primary name field of a related entity in a link-entity!
The lookup column ALREADY shows it automatically. Adding it again via link-entity is redundant and wastes a column.
  WRONG: link-entity with <attribute name="jw_title" /> when jw_threadid lookup already shows jw_title!
  WRONG: link-entity with <attribute name="jw_name" /> when the lookup already shows the name!
  WRONG: link-entity with <attribute name="fullname" /> when createdby lookup already shows the user's name!
  CORRECT: Only use link-entity for fields that are NOT the primary name (e.g. jw_status, statecode, emailaddress).
  CORRECT: The lookup cell (<cell name="jw_threadid" />) already displays the primary name as a clickable link.
Before adding ANY field via link-entity, ask yourself: "Is this the primary name of that entity?" If yes, DON'T — the lookup handles it.

For Status/StateCode fields, the cell uses the "name" suffix:
  fetchxml:  <attribute name="statecode" />
  layoutxml: <cell name="statecodename" width="150" />

  fetchxml:  <attribute name="statuscode" />
  layoutxml: <cell name="statuscodename" width="150" />

NEVER put *name suffixed values in fetchxml:
  WRONG: <attribute name="createdbyname" />     ← DOES NOT EXIST!
  WRONG: <attribute name="statecodename" />     ← DOES NOT EXIST!

### Pattern 3 — NON-primary-name fields from a related entity via link-entity:
ONLY use link-entity when the user wants a field that is NOT the primary name of the related entity.
Example: "show the thread's status" → needs link-entity (jw_status is not the primary name of jw_thread).
Example: "show the thread name" → does NOT need link-entity! Just use the lookup (Pattern 2).
When you DO need link-entity:
CRITICAL RULES for link-entity in views:
- alias: must be a unique string prefixed with "a_" followed by a random hex string (e.g. "a_" + 32-char hex). Generate a new random alias for each link-entity.
- visible="false" is REQUIRED on the link-entity tag.
- to = the lookup field on the MAIN entity (or parent link-entity field name)
- from = the primary key field on the LINKED entity
- link-type="outer" for optional relationships
- NO *name suffixes anywhere — not in fetchxml attributes, not in layoutxml cells!
- NO nested link-entities — each link-entity must be a direct child of <entity>.

REAL EXAMPLE (from a working Dataverse view):
  fetchxml:
    <attribute name="jw_threadid" />   ← lookup field on main entity
    <link-entity alias="a_499bd5b21724467f87406cdeb2003d9b" name="jw_thread" to="jw_threadid" from="jw_threadid" link-type="outer" visible="false">
      <attribute name="jw_status" />
      <attribute name="statecode" />
      <attribute name="jw_agentid" />
    </link-entity>

  layoutxml cells:
    <cell name="jw_threadid" width="100" />                                          ← lookup on main entity (no name suffix needed either)
    <cell name="a_499bd5b21724467f87406cdeb2003d9b.jw_status" width="127" />         ← OptionSet from linked entity
    <cell name="a_499bd5b21724467f87406cdeb2003d9b.statecode" width="127" />         ← StateCode from linked entity
    <cell name="a_499bd5b21724467f87406cdeb2003d9b.jw_agentid" width="127" />        ← Lookup from linked entity

KEY OBSERVATIONS from this real example:
- Cell names for link-entity fields: alias.attributename — NO *name suffix!
- Even for Lookups inside link-entity (jw_agentid): NO name suffix in the cell!
- Even for OptionSets inside link-entity (jw_status): NO name suffix in the cell!
- The alias is a_<hex>, not a human-readable word.
- The link-entity has visible="false".

WRONG patterns (will break the view):
  <cell name="alias.jw_statusname" />     ← WRONG: no *name suffix for link-entity cells!
  <cell name="alias.jw_agentidname" />    ← WRONG: no *name suffix for link-entity cells!
  <attribute name="jw_statusname" />      ← WRONG: not a real attribute!
  <link-entity alias="thread" ...>        ← WRONG: alias must be a_<hex>, not a word!
  <link-entity ... visible="true">        ← WRONG: must be visible="false"!
  <link-entity><link-entity></...>        ← WRONG: no nesting! Views only support flat link-entities.

If the user asks for grandparent/deeply nested data, explain that views only support one level of link-entity.
If you don't know the related entity's attributes, respond with status "need_metadata".

## Rules — READ CAREFULLY
- fetchxml <attribute> elements MUST use ONLY real attribute logical names. NEVER use *name suffixes in fetchxml.
- layoutxml <cell> for ALL lookups (system AND custom): use the attribute name AS-IS, NO suffix. (createdby, NOT createdbyname. jw_threadid, NOT jw_threadidname.)
- layoutxml <cell> for statecode/statuscode: these are the ONLY exception — use "name" suffix (statecodename, statuscodename).
- layoutxml <cell> for link-entity fields: use alias.attributename — NO *name suffix!
- link-entity alias: always "a_" + 32 random hex chars. Never use human-readable aliases.
- link-entity must have visible="false".
- CRITICAL: NEVER remove existing columns unless the user EXPLICITLY asks to remove them. "Fix" or "add" means keep ALL existing columns intact.
- CRITICAL: When fixing errors, fix ONLY the broken parts. Do not restructure or simplify.
- Use ONLY attributes from the attribute list below.
- Use ONLY relationships from the relationship list below.
- layoutxml: <grid name="resultset" object="..." jump="" select="1" icon="1" preview="1"><row name="result" id="${context.entityLogicalName}id"><cell name="..." width="..." /></row></grid>
- fetchxml: <fetch><entity name="${context.entityLogicalName}">...</entity></fetch>
- NEVER duplicate attributes in fetchxml.
- Default column widths: 150 for text, 100 for numbers/dates, 200 for lookups, 127 for link-entity fields.
- Never invent attribute logical names.
- Do NOT wrap JSON in markdown code fences. Return raw JSON only.

## Current View: "${context.viewName}"
Entity: ${context.entityLogicalName} (EntitySet: ${context.entitySetName})

### Current layoutxml:
${context.layoutxml}

### Current fetchxml:
${context.fetchxml}

### Available Attributes:
${attrLines}

### Available Relationships:
${relLines || '  (none)'}`;
  }

  validate(output, context) {
    const warnings = [];
    const errors = [];
    const attrSet = new Set((context.attributes || []).map(a => a.LogicalName));

    // Check <attribute name="X"> in fetchxml.
    // The *name suffix pattern is NEVER valid in fetchxml, regardless of where it appears.
    const fetchAttrs = [...(output.fetchxml || '').matchAll(/<attribute\s+name="([^"]+)"/g)].map(m => m[1]);

    // For duplicate detection: scope-aware (main entity vs link-entities)
    // Parse which attributes are in main entity vs link-entities
    const mainEntityBlock = (output.fetchxml || '').replace(/<link-entity[\s\S]*?<\/link-entity>/g, '');
    const mainAttrs = [...mainEntityBlock.matchAll(/<attribute\s+name="([^"]+)"/g)].map(m => m[1]);
    const mainSeen = new Set();

    for (const name of mainAttrs) {
      if (mainSeen.has(name)) {
        warnings.push(`fetchxml has duplicate <attribute name="${name}"> in main entity`);
      }
      mainSeen.add(name);
    }

    for (const name of fetchAttrs) {
      // Detect *name suffixed attributes — these are display names, never real attributes
      if (name.endsWith('name')) {
        const base = name.slice(0, -4);
        if (attrSet.has(base) || /^(statecode|statuscode)$/.test(base) || base.endsWith('id')) {
          errors.push(`fetchxml has <attribute name="${name}"> — "${name}" is a display name, not a real attribute. Use "${base}" instead.`);
        }
      }
    }

    // Check layoutxml cells
    const cellNames = [...(output.layoutxml || '').matchAll(/cell\s+name="([^"]+)"/g)].map(m => m[1]);
    const cellSeen = new Set();
    for (const name of cellNames) {
      // Detect duplicate cells
      if (cellSeen.has(name)) {
        errors.push(`layoutxml has duplicate <cell name="${name}"> — each cell must be unique`);
      }
      cellSeen.add(name);

      if (name.includes('.')) continue; // link-entity column — alias.attr

      // Detect *name suffix on lookup cells — only statecodename/statuscodename are allowed
      const allowedNameSuffix = new Set(['statecodename', 'statuscodename']);
      if (name.endsWith('name') && !allowedNameSuffix.has(name)) {
        const base = name.slice(0, -4);
        if (attrSet.has(base)) {
          errors.push(`layoutxml cell "${name}" uses "name" suffix — use "${base}" instead (lookups don't use name suffix in cells)`);
        }
      }

      const baseName = name.endsWith('name') ? name.slice(0, -4) : name;
      if (!attrSet.has(name) && !attrSet.has(baseName)) {
        warnings.push(`layoutxml cell "${name}" not found in entity attributes`);
      }
    }

    // Detect nested link-entities (not supported in views)
    const nestedLinkEntity = (output.fetchxml || '').match(/<link-entity[^>]*>[\s\S]*?<link-entity/);
    if (nestedLinkEntity) {
      errors.push('fetchxml contains nested link-entities — Dataverse views only support one level of link-entity. Nested link-entities will cause runtime errors.');
    }

    if (errors.length > 0) {
      return { valid: false, warnings: [...errors, ...warnings] };
    }
    return { valid: true, warnings };
  }

  async apply(output, publish, log) {
    // Handle create mode
    if (this.#createMode) {
      return this.#createView(output, publish, log);
    }

    const isSystem = this.#viewType === 'system';
    const entitySet = isSystem ? 'savedqueries' : 'userqueries';
    const idField = isSystem ? 'savedqueryid' : 'userqueryid';
    const viewId = this.#selectedView?.[idField];
    if (!viewId) return { success: false, error: 'No view selected' };

    // Backup
    this.#backupLayoutXml = this.#originalLayoutXml;
    this.#backupFetchXml = this.#originalFetchXml;
    this.#backupViewId = viewId;

    const patchUrl = `${entitySet}(${viewId})`;
    const patchBody = { layoutxml: output.layoutxml, fetchxml: output.fetchxml };
    log('WRITE', `→ PATCH ${patchUrl}`, `Request Body:\n${JSON.stringify(patchBody, null, 2)}`);

    try {
      const resp = await this.api.requestRaw('PATCH', patchUrl, { body: patchBody });
      if (!resp.ok) {
        log('ERR', `← PATCH ${resp.status} — failed`, resp.error || JSON.stringify(resp.data));
        return { success: false, error: `PATCH ${resp.status}` };
      }
      log('WRITE', `← PATCH ${resp.status} — view updated`);

      // Publish FIRST (before verify)
      if (publish && isSystem) {
        await this.#publishEntity(log);
      } else if (publish && !isSystem) {
        log('META', 'Personal views do not require publishing');
      }

      // Verify AFTER publish — re-read the view to confirm and update baseline
      try {
        const fresh = await this.api.request('GET', `${entitySet}(${viewId})?$select=layoutxml,fetchxml`);
        this.refreshBaseline(fresh.layoutxml || output.layoutxml, fresh.fetchxml || output.fetchxml);
        log('WRITE', 'Verified — baseline updated for follow-up prompts');
      } catch (e) {
        // Fallback: use what we sent
        this.refreshBaseline(output.layoutxml, output.fetchxml);
        log('WARN', `Could not re-read view: ${e.message} — using sent XML as baseline`);
      }

      return { success: true };
    } catch (err) {
      log('ERR', `PATCH exception: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async #createView(output, publish, log) {
    const entityName = this.#selectedEntity.LogicalName;
    const name = this.#createName || 'New View';

    log('WRITE', `→ POST savedqueries (create "${name}")`, `Request Body:\n${JSON.stringify({ name, returnedtypecode: entityName, layoutxml: output.layoutxml, fetchxml: output.fetchxml }, null, 2)}`);

    try {
      const resp = await this.api.requestRaw('POST', 'savedqueries', {
        body: {
          name,
          returnedtypecode: entityName,
          querytype: 0,
          layoutxml: output.layoutxml,
          fetchxml: output.fetchxml,
        },
      });

      if (!resp.ok) {
        log('ERR', `← POST ${resp.status} — create failed`, resp.error || JSON.stringify(resp.data));
        return { success: false, error: `POST ${resp.status}` };
      }

      const newId = resp.headers?.['odata-entityid']?.match(/\(([^)]+)\)/)?.[1];
      log('WRITE', `← POST ${resp.status} — view created${newId ? ` (${newId})` : ''}`);

      // Publish
      if (publish) {
        await this.#publishEntity(log);
      }

      // Update baseline with what was created
      this.refreshBaseline(output.layoutxml, output.fetchxml);

      // Reload views and exit create mode
      this.#exitCreateMode();
      await this.loadViews();

      // Select the newly created view if we got an ID
      if (newId && this.#viewSelect) {
        this.#viewSelect.value = newId;
        this.#onViewChanged();
      }

      return { success: true };
    } catch (err) {
      log('ERR', `Create exception: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async revert(log) {
    if (!this.#backupViewId) return { success: false, error: 'No backup' };

    const isSystem = this.#viewType === 'system';
    const entitySet = isSystem ? 'savedqueries' : 'userqueries';
    const patchUrl = `${entitySet}(${this.#backupViewId})`;

    log('WRITE', `→ PATCH ${patchUrl} (revert)`, `Restoring backup XML`);

    try {
      const resp = await this.api.requestRaw('PATCH', patchUrl, {
        body: { layoutxml: this.#backupLayoutXml, fetchxml: this.#backupFetchXml },
      });
      if (!resp.ok) {
        log('ERR', `← PATCH ${resp.status} — revert failed`);
        return { success: false, error: `PATCH ${resp.status}` };
      }
      log('WRITE', `← PATCH ${resp.status} — reverted`);

      this.#originalLayoutXml = this.#backupLayoutXml;
      this.#originalFetchXml = this.#backupFetchXml;
      if (this.#selectedView) {
        this.#selectedView.layoutxml = this.#backupLayoutXml;
        this.#selectedView.fetchxml = this.#backupFetchXml;
      }

      if (isSystem) await this.#publishEntity(log);

      this.#backupViewId = '';
      return { success: true };
    } catch (err) {
      log('ERR', `Revert exception: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async #publishEntity(log) {
    if (!this.#selectedEntity) return;
    const entity = this.#selectedEntity.LogicalName;
    log('PUB', `→ POST PublishXml for ${entity}`);

    try {
      const start = performance.now();
      const resp = await this.api.requestRaw('POST', 'PublishXml', {
        body: { ParameterXml: `<importexportxml><entities><entity>${entity}</entity></entities></importexportxml>` },
      });
      const duration = ((performance.now() - start) / 1000).toFixed(1);

      if (!resp.ok) {
        log('ERR', `← PublishXml ${resp.status} — failed`);
      } else {
        log('PUB', `← Published ${resp.status} — ${duration}s`);
      }
    } catch (err) {
      log('ERR', `PublishXml exception: ${err.message}`);
    }
  }

  #normalize(xml) {
    return (xml || '')
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .replace(/\s*\/>/g, '/>')
      .replace(/\s*>/g, '>')
      .replace(/<\s+/g, '<')
      .trim()
      .toLowerCase();
  }
}
