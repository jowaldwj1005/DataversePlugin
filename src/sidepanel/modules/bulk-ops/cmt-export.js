/**
 * CMT Export Wizard — export records as Configuration Migration Tool XML.
 *
 * Steps:
 *  1. Entity Selection   (multi-select from entity list)
 *  2. Record Filter      (optional OData filter per entity)
 *  3. Export             (fetch records, generate XML, download)
 */

import { WizardBase, fetchAllRecords } from './wizard-base.js';
import { generateCmtSchemaXml, generateCmtDataXml, createZip } from './cmt-xml-utils.js';

// ---------------------------------------------------------------------------
// MultiEntityPickerStep — multi-select entity checkboxes
// ---------------------------------------------------------------------------

class MultiEntityPickerStep {
  #cache;
  #entities = [];
  #selected = new Set();
  #filter = '';

  constructor(metadataCache) {
    this.#cache = metadataCache;
  }

  async render(container) {
    container.innerHTML = '';

    if (this.#entities.length === 0) {
      try { this.#entities = await this.#cache.getEntities(); } catch { this.#entities = []; }
    }

    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.78rem; font-weight:600; color:var(--color-text-muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.04em;';
    label.textContent = `Select entities to export (${this.#selected.size} selected)`;
    container.appendChild(label);

    // Search
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Filter entities...';
    search.value = this.#filter;
    search.style.cssText = 'width:100%; box-sizing:border-box; padding:4px 8px; font-size:0.78rem; background:var(--color-bg-input); color:var(--color-text-primary); border:1px solid var(--color-border); border-radius:var(--radius-sm); margin-bottom:6px;';
    search.addEventListener('input', () => {
      this.#filter = search.value.toLowerCase();
      renderList();
    });
    container.appendChild(search);

    const list = document.createElement('div');
    list.style.cssText = 'max-height:280px; overflow-y:auto; border:1px solid var(--color-border-subtle); border-radius:var(--radius-sm); padding:4px;';
    container.appendChild(list);

    const renderList = () => {
      list.innerHTML = '';
      const filtered = this.#entities.filter(e => {
        if (!this.#filter) return true;
        const dn = e.DisplayName?.UserLocalizedLabel?.Label || '';
        return e.LogicalName.includes(this.#filter) || dn.toLowerCase().includes(this.#filter);
      });
      for (const ent of filtered) {
        const item = document.createElement('label');
        item.style.cssText = 'display:flex; align-items:center; gap:6px; padding:3px 6px; font-size:0.78rem; cursor:pointer; color:var(--color-text-primary);';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.#selected.has(ent.LogicalName);
        cb.addEventListener('change', () => {
          if (cb.checked) this.#selected.add(ent.LogicalName);
          else this.#selected.delete(ent.LogicalName);
          label.textContent = `Select entities to export (${this.#selected.size} selected)`;
        });
        const dn = ent.DisplayName?.UserLocalizedLabel?.Label;
        item.append(cb, dn ? `${dn} (${ent.LogicalName})` : ent.LogicalName);
        list.appendChild(item);
      }
    };
    renderList();
  }

  validate() {
    if (this.#selected.size === 0) return 'Select at least one entity.';
    return null;
  }

  getSelectedEntities() {
    return this.#entities.filter(e => this.#selected.has(e.LogicalName));
  }
}

// ---------------------------------------------------------------------------
// ExportStep — fetch and download
// ---------------------------------------------------------------------------

class ExportStep {
  #cache;
  #api;
  #entities = [];
  #status = '';
  #downloading = false;

  constructor(metadataCache, apiClient) {
    this.#cache = metadataCache;
    this.#api = apiClient;
  }

  setEntities(entities) { this.#entities = entities; }

  render(container) {
    container.innerHTML = '';

    const info = document.createElement('div');
    info.style.cssText = 'font-size:0.82rem; color:var(--color-text-primary); margin-bottom:12px;';
    info.innerHTML = `Ready to export <strong>${this.#entities.length}</strong> entit${this.#entities.length !== 1 ? 'ies' : 'y'}.`;
    container.appendChild(info);

    const entityList = document.createElement('div');
    entityList.style.cssText = 'font-size:0.75rem; color:var(--color-text-muted); margin-bottom:12px;';
    entityList.textContent = this.#entities.map(e => e.LogicalName).join(', ');
    container.appendChild(entityList);

    const note = document.createElement('div');
    note.style.cssText = 'font-size:0.72rem; color:var(--color-text-muted); margin-bottom:12px; line-height:1.4; background:var(--color-info-bg); border:1px solid var(--color-info-border); border-radius:var(--radius-sm); padding:8px;';
    note.textContent = 'Click "Export" to fetch all records and download as a CMT-compatible zip (data_schema.xml + data.xml). Large exports may take a moment.';
    container.appendChild(note);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = this.#downloading ? 'Exporting...' : 'Export & Download';
    exportBtn.disabled = this.#downloading;
    exportBtn.style.cssText = `padding:8px 20px; font-size:0.85rem; font-weight:600; background:var(--color-accent-primary); color:#fff; border:1px solid var(--color-accent-primary); border-radius:var(--radius-md); cursor:pointer;${this.#downloading ? ' opacity:0.5;' : ''}`;
    exportBtn.addEventListener('click', () => this.#doExport(container));
    container.appendChild(exportBtn);

    if (this.#status) {
      const statusEl = document.createElement('div');
      statusEl.style.cssText = 'font-size:0.78rem; margin-top:10px; color:var(--color-text-primary);';
      statusEl.textContent = this.#status;
      container.appendChild(statusEl);
    }
  }

  async #doExport(container) {
    this.#downloading = true;
    this.#status = 'Fetching metadata...';
    this.render(container);

    try {
      const schemaEntities = [];
      const dataEntities = [];

      for (const ent of this.#entities) {
        this.#status = `Fetching ${ent.LogicalName} attributes...`;
        this.render(container);

        const attrs = await this.#cache.getAttributes(ent.LogicalName);

        schemaEntities.push({
          logicalName: ent.LogicalName,
          displayName: ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName,
          primaryIdAttribute: ent.PrimaryIdAttribute,
          primaryNameAttribute: ent.PrimaryNameAttribute,
          attributes: attrs.map(a => ({
            logicalName: a.LogicalName,
            attributeType: a.AttributeType,
            displayName: a.DisplayName?.UserLocalizedLabel?.Label || a.LogicalName,
          })),
        });

        this.#status = `Fetching ${ent.LogicalName} records...`;
        this.render(container);

        // Always include primary ID + primary name; exclude virtual/composite attributes
        const SKIP_TYPES = new Set(['Virtual', 'EntityName', 'CalendarRules', 'ManagedProperty']);
        const exportable = attrs.filter(a =>
          !SKIP_TYPES.has(a.AttributeType) &&
          !a.AttributeOf  // composite child fields (e.g. _lookup_value) — not selectable
        );

        // Ensure primary fields are always present, deduplicate
        const priorityFields = [ent.PrimaryIdAttribute, ent.PrimaryNameAttribute].filter(Boolean);
        const rest = exportable.map(a => a.LogicalName).filter(n => !priorityFields.includes(n));
        const selectFields = [...priorityFields, ...rest];

        const select = selectFields.join(',');
        const records = await fetchAllRecords(this.#api, ent.EntitySetName, null, select, 5000);

        dataEntities.push({
          logicalName: ent.LogicalName,
          displayName: ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName,
          records,
          schema: attrs.map(a => ({
            name: a.LogicalName,
            type: this.#mapType(a.AttributeType),
          })),
        });
      }

      this.#status = 'Generating XML...';
      this.render(container);

      const schemaXml = generateCmtSchemaXml(schemaEntities);
      const dataXml = generateCmtDataXml(dataEntities);

      this.#status = 'Creating zip...';
      this.render(container);

      const blob = createZip([
        { name: 'data_schema.xml', content: schemaXml },
        { name: 'data.xml', content: dataXml },
      ]);

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cmt_export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      this.#status = 'Export complete! File downloaded.';
    } catch (err) {
      this.#status = `Export failed: ${err.message}`;
    } finally {
      this.#downloading = false;
      this.render(container);
    }
  }

  #mapType(attrType) {
    const map = { String: 'string', Memo: 'string', Integer: 'number', BigInt: 'number', Decimal: 'decimal', Double: 'decimal', Money: 'money', Boolean: 'bool', DateTime: 'datetime', Picklist: 'optionsetvalue', MultiSelectPicklist: 'optionsetvalue', State: 'state', Status: 'status', Lookup: 'entityreference', Owner: 'entityreference', Customer: 'entityreference', UniqueIdentifier: 'guid' };
    return map[attrType] || 'string';
  }

  validate() { return null; }
}

// ---------------------------------------------------------------------------
// CmtExportWizard
// ---------------------------------------------------------------------------

export class CmtExportWizard extends WizardBase {
  #entityStep;
  #exportStep;

  constructor(metadataCache, apiClient) {
    super(metadataCache, apiClient);
    this.#entityStep = new MultiEntityPickerStep(metadataCache);
    this.#exportStep = new ExportStep(metadataCache, apiClient);
  }

  get title() { return 'Data Export (CMT)'; }

  get steps() {
    return [
      {
        id: 'entities',
        label: 'Entities',
        render: el => this.#entityStep.render(el),
        validate: () => {
          const err = this.#entityStep.validate();
          if (err) return err;
          this.#exportStep.setEntities(this.#entityStep.getSelectedEntities());
          return null;
        },
      },
      {
        id: 'export',
        label: 'Export',
        render: el => this.#exportStep.render(el),
        validate: () => null,
      },
    ];
  }

  // Export wizard doesn't generate batch operations — it downloads a file
  _generateOperations() { return []; }
}
