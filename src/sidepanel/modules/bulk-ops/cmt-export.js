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
  #api;
  #entities = [];
  #selected = new Set();
  #filter = '';

  constructor(metadataCache, apiClient) {
    this.#cache = metadataCache;
    this.#api = apiClient;
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

    // Import from Solution button
    const solRow = document.createElement('div');
    solRow.style.cssText = 'display:flex; gap:6px; margin-bottom:6px; align-items:center;';

    const solSelect = document.createElement('select');
    solSelect.style.cssText = 'flex:1; padding:4px 8px; font-size:0.75rem; background:var(--color-bg-input); color:var(--color-text-primary); border:1px solid var(--color-border); border-radius:var(--radius-sm);';
    solSelect.innerHTML = '<option value="">Import from Solution...</option>';

    // Load solutions async
    this.#api.request('GET', 'solutions?$select=friendlyname,uniquename,solutionid&$filter=ismanaged eq false')
      .then(data => {
        for (const sol of (data.value || []).sort((a, b) => a.friendlyname.localeCompare(b.friendlyname))) {
          const opt = document.createElement('option');
          opt.value = sol.solutionid;
          opt.textContent = `${sol.friendlyname} (${sol.uniquename})`;
          solSelect.appendChild(opt);
        }
      }).catch(() => {});

    const solBtn = document.createElement('button');
    solBtn.textContent = 'Load';
    solBtn.style.cssText = 'padding:4px 12px; font-size:0.75rem; font-weight:600; background:var(--color-accent-primary); color:#fff; border:1px solid var(--color-accent-primary); border-radius:var(--radius-sm); cursor:pointer;';
    solBtn.addEventListener('click', async () => {
      const solId = solSelect.value;
      if (!solId) return;
      solBtn.textContent = 'Loading...';
      solBtn.disabled = true;
      try {
        const compData = await this.#api.request('GET',
          `solutioncomponents?$filter=_solutionid_value eq ${solId} and componenttype eq 1&$select=objectid`);
        const objectIds = new Set((compData.value || []).map(c => c.objectid).filter(Boolean));
        // Match MetadataId (always present in EntityDefinitions response)
        for (const ent of this.#entities) {
          if (objectIds.has(ent.MetadataId)) {
            this.#selected.add(ent.LogicalName);
          }
        }
        label.textContent = `Select entities to export (${this.#selected.size} selected)`;
        renderList();
      } catch (err) {
        solBtn.textContent = 'Error';
      } finally {
        solBtn.textContent = 'Load';
        solBtn.disabled = false;
      }
    });

    solRow.append(solSelect, solBtn);
    container.appendChild(solRow);

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
    list.style.cssText = 'max-height:220px; overflow-y:auto; border:1px solid var(--color-border-subtle); border-radius:var(--radius-sm); padding:4px;';
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

  constructor(metadataCache, apiClient) {
    this.#cache = metadataCache;
    this.#api = apiClient;
  }

  setEntities(entities) { this.#entities = entities; }

  async render(container) {
    container.innerHTML = '';

    const info = document.createElement('div');
    info.style.cssText = 'font-size:0.82rem; color:var(--color-text-primary); margin-bottom:8px;';
    info.innerHTML = `Ready to export <strong>${this.#entities.length}</strong> entit${this.#entities.length !== 1 ? 'ies' : 'y'}.`;
    container.appendChild(info);

    // Record count table
    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.72rem; margin-bottom:8px;';
    table.innerHTML = '<thead><tr style="border-bottom:1px solid var(--color-border-subtle);"><th style="text-align:left; padding:3px 6px; color:var(--color-text-muted);">Entity</th><th style="text-align:right; padding:3px 6px; color:var(--color-text-muted);">Records</th></tr></thead>';
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    container.appendChild(table);

    let totalCount = 0;
    // Fetch counts in parallel (best-effort)
    const countPromises = this.#entities.map(async ent => {
      const row = document.createElement('tr');
      row.style.cssText = 'border-bottom:1px solid var(--color-border-subtle);';
      const dn = ent.DisplayName?.UserLocalizedLabel?.Label || ent.LogicalName;
      row.innerHTML = `<td style="padding:3px 6px; color:var(--color-text-primary);">${dn}</td><td style="text-align:right; padding:3px 6px; color:var(--color-text-muted);">...</td>`;
      tbody.appendChild(row);
      try {
        const data = await this.#api.request('GET', `${ent.EntitySetName}?$count=true&$top=1`);
        const count = data['@odata.count'] ?? 0;
        totalCount += count;
        row.children[1].textContent = count.toLocaleString();
        row.children[1].style.color = count > 5000 ? '#fca130' : 'var(--color-text-primary)';
      } catch { row.children[1].textContent = '?'; }
    });
    await Promise.all(countPromises);

    // Total + warning
    const totalRow = document.createElement('div');
    totalRow.style.cssText = 'font-size:0.75rem; font-weight:600; color:var(--color-text-primary); margin-bottom:8px;';
    totalRow.textContent = `Total: ${totalCount.toLocaleString()} records`;
    if (totalCount > 10000) {
      totalRow.innerHTML += ' <span style="color:#fca130; font-weight:400;">— Large export, may take a moment</span>';
    }
    container.appendChild(totalRow);

    const note = document.createElement('div');
    note.style.cssText = 'font-size:0.72rem; color:var(--color-text-muted); margin-bottom:12px; line-height:1.4; background:var(--color-info-bg); border:1px solid var(--color-info-border); border-radius:var(--radius-sm); padding:8px;';
    note.textContent = 'Click "Export" to fetch all records and download as a CMT-compatible zip (data_schema.xml + data.xml).';
    container.appendChild(note);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export & Download';
    exportBtn.style.cssText = 'padding:8px 20px; font-size:0.85rem; font-weight:600; background:var(--color-accent-primary); color:#fff; border:1px solid var(--color-accent-primary); border-radius:var(--radius-md); cursor:pointer;';
    container.appendChild(exportBtn);

    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-size:0.78rem; margin-top:10px; color:var(--color-text-primary);';
    container.appendChild(statusEl);

    exportBtn.addEventListener('click', () => this.#doExport(exportBtn, statusEl));
  }

  async #doExport(exportBtn, statusEl) {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';
    exportBtn.style.opacity = '0.5';
    const setStatus = (msg) => { statusEl.textContent = msg; };

    try {
      const schemaEntities = [];
      const dataEntities = [];

      for (const ent of this.#entities) {
        setStatus(`Fetching ${ent.LogicalName} attributes...`);

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

        setStatus(`Fetching ${ent.LogicalName} records...`);

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

      setStatus('Generating XML...');
      const schemaXml = generateCmtSchemaXml(schemaEntities);
      const dataXml = generateCmtDataXml(dataEntities);

      setStatus('Creating zip...');
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

      setStatus('Export complete! File downloaded.');
      exportBtn.textContent = 'Done';
    } catch (err) {
      setStatus(`Export failed: ${err.message}`);
    } finally {
      exportBtn.disabled = false;
      exportBtn.style.opacity = '1';
      exportBtn.textContent = 'Export & Download';
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
    this.#entityStep = new MultiEntityPickerStep(metadataCache, apiClient);
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
