/**
 * CMT Import Wizard — import Configuration Migration Tool XML as upsert operations.
 *
 * Steps:
 *  1. File Upload       (zip or xml file)
 *  2. Schema Review     (show parsed entities/record counts, deselect unwanted)
 *  3. Import Strategy   (upsert by PK, create only)
 *  4. Review            (operation count, preview)
 */

import { WizardBase } from './wizard-base.js';
import { parseCmtSchemaXml, parseCmtDataXml, cmtRecordsToOperations, unzip } from './cmt-xml-utils.js';

// ---------------------------------------------------------------------------
// FileUploadStep
// ---------------------------------------------------------------------------

class FileUploadStep {
  #schemaXml = '';
  #dataXml = '';
  #fileName = '';
  #error = '';
  #parsed = false;

  render(container) {
    container.innerHTML = '';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.78rem; font-weight:600; color:var(--color-text-muted); margin-bottom:6px;';
    label.textContent = 'Upload CMT export file (.zip or .xml)';
    container.appendChild(label);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.72rem; color:var(--color-text-muted); margin-bottom:10px; line-height:1.4;';
    hint.textContent = 'Upload a zip file containing data_schema.xml and data.xml, or a single data.xml file.';
    container.appendChild(hint);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.zip,.xml';
    fileInput.style.cssText = 'font-size:0.78rem; color:var(--color-text-primary);';
    fileInput.addEventListener('change', () => this.#handleFile(fileInput.files[0], container));
    container.appendChild(fileInput);

    if (this.#fileName) {
      const status = document.createElement('div');
      status.style.cssText = `font-size:0.78rem; margin-top:8px; color:${this.#error ? 'var(--color-error)' : 'var(--color-success)'};`;
      status.textContent = this.#error || `Loaded: ${this.#fileName}`;
      container.appendChild(status);
    }
  }

  async #handleFile(file, container) {
    if (!file) return;
    this.#fileName = file.name;
    this.#error = '';
    this.#parsed = false;

    try {
      if (file.name.endsWith('.zip')) {
        const buffer = await file.arrayBuffer();
        const files = await unzip(buffer);
        this.#schemaXml = files.get('data_schema.xml') || '';
        this.#dataXml = files.get('data.xml') || '';
        if (!this.#dataXml) {
          // Try to find any .xml file
          for (const [name, content] of files) {
            if (name.endsWith('.xml') && content.includes('<entities>')) {
              this.#dataXml = content;
              break;
            }
          }
        }
        if (!this.#dataXml) throw new Error('No data.xml found in zip.');
      } else {
        const text = await file.text();
        if (text.includes('<fields>')) {
          this.#schemaXml = text;
        } else {
          this.#dataXml = text;
        }
      }
      this.#parsed = true;
    } catch (err) {
      this.#error = `Failed to read file: ${err.message}`;
    }
    this.render(container);
  }

  validate() {
    if (!this.#parsed) return 'Please upload a CMT export file.';
    if (!this.#dataXml) return 'No data.xml found in the uploaded file.';
    return null;
  }

  getSchemaXml() { return this.#schemaXml; }
  getDataXml() { return this.#dataXml; }
}

// ---------------------------------------------------------------------------
// SchemaReviewStep
// ---------------------------------------------------------------------------

class SchemaReviewStep {
  #schema = [];
  #data = [];
  #selected = new Set();

  setData(schemaXml, dataXml) {
    this.#data = parseCmtDataXml(dataXml);
    this.#schema = schemaXml ? parseCmtSchemaXml(schemaXml) : [];
    this.#selected = new Set(this.#data.map(e => e.entity));
  }

  render(container) {
    container.innerHTML = '';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.78rem; font-weight:600; color:var(--color-text-muted); margin-bottom:6px;';
    label.textContent = `Found ${this.#data.length} entit${this.#data.length !== 1 ? 'ies' : 'y'} — deselect any you don't want to import`;
    container.appendChild(label);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:4px;';

    for (const ent of this.#data) {
      const item = document.createElement('label');
      item.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 10px; background:var(--color-bg-card); border:1px solid var(--color-border-subtle); border-radius:var(--radius-sm); font-size:0.78rem; cursor:pointer; color:var(--color-text-primary);';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.#selected.has(ent.entity);
      cb.addEventListener('change', () => {
        if (cb.checked) this.#selected.add(ent.entity);
        else this.#selected.delete(ent.entity);
      });

      const name = document.createElement('span');
      name.style.cssText = 'flex:1; font-weight:600;';
      name.textContent = ent.displayName || ent.entity;

      const count = document.createElement('span');
      count.style.cssText = 'font-size:0.72rem; color:var(--color-text-muted); background:var(--color-bg-badge); padding:1px 8px; border-radius:8px;';
      count.textContent = `${ent.records.length} records`;

      item.append(cb, name, count);
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  validate() {
    if (this.#selected.size === 0) return 'Select at least one entity to import.';
    return null;
  }

  getSelectedEntities() { return this.#selected; }
  getData() { return this.#data; }
  getSchema() { return this.#schema; }
}

// ---------------------------------------------------------------------------
// StrategyStep
// ---------------------------------------------------------------------------

class StrategyStep {
  #mode = 'upsert';

  render(container) {
    container.innerHTML = '';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.78rem; font-weight:600; color:var(--color-text-muted); margin-bottom:10px;';
    label.textContent = 'Import Strategy';
    container.appendChild(label);

    const options = [
      { value: 'upsert', label: 'Upsert (PATCH)', desc: 'Update existing records or create if not found. Uses record ID as key.' },
      { value: 'create', label: 'Create Only (POST)', desc: 'Create all records as new. Ignores existing record IDs.' },
    ];

    for (const opt of options) {
      const item = document.createElement('label');
      item.style.cssText = `display:block; padding:10px 12px; border:2px solid ${opt.value === this.#mode ? 'var(--color-accent-primary)' : 'var(--color-border)'}; border-radius:var(--radius-md); margin-bottom:8px; cursor:pointer; background:${opt.value === this.#mode ? 'var(--color-bg-active)' : 'var(--color-bg-card)'};`;

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'cmt-import-strategy';
      radio.value = opt.value;
      radio.checked = opt.value === this.#mode;
      radio.style.cssText = 'margin-right:8px;';
      radio.addEventListener('change', () => {
        this.#mode = opt.value;
        this.render(container);
      });

      const text = document.createElement('span');
      text.style.cssText = 'font-size:0.82rem; font-weight:600; color:var(--color-text-primary);';
      text.textContent = opt.label;

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:0.72rem; color:var(--color-text-muted); margin-top:4px; margin-left:22px;';
      desc.textContent = opt.desc;

      item.append(radio, text);
      item.appendChild(desc);
      container.appendChild(item);
    }
  }

  validate() { return null; }
  getMode() { return this.#mode; }
}

// ---------------------------------------------------------------------------
// CmtImportWizard
// ---------------------------------------------------------------------------

export class CmtImportWizard extends WizardBase {
  #fileStep;
  #schemaStep;
  #strategyStep;
  #entitySetMap = new Map(); // populated during confirm render

  constructor(metadataCache, apiClient) {
    super(metadataCache, apiClient);
    this.#fileStep = new FileUploadStep();
    this.#schemaStep = new SchemaReviewStep();
    this.#strategyStep = new StrategyStep();
  }

  get title() { return 'Data Import (CMT)'; }

  get steps() {
    return [
      {
        id: 'file',
        label: 'Upload',
        render: el => this.#fileStep.render(el),
        validate: () => {
          const err = this.#fileStep.validate();
          if (err) return err;
          this.#schemaStep.setData(this.#fileStep.getSchemaXml(), this.#fileStep.getDataXml());
          return null;
        },
      },
      {
        id: 'schema',
        label: 'Review',
        render: el => this.#schemaStep.render(el),
        validate: () => this.#schemaStep.validate(),
      },
      {
        id: 'strategy',
        label: 'Strategy',
        render: el => this.#strategyStep.render(el),
        validate: () => null,
      },
      {
        id: 'confirm',
        label: 'Import',
        render: el => this.#renderConfirm(el),
        validate: () => null,
      },
    ];
  }

  async #renderConfirm(container) {
    container.innerHTML = '';

    // Show loading while fetching entity metadata
    const loading = document.createElement('div');
    loading.style.cssText = 'font-size:0.78rem; color:var(--color-text-muted); padding:8px 0;';
    loading.textContent = 'Resolving entity set names...';
    container.appendChild(loading);

    // Pre-load real EntitySetName from metadata cache (best-effort; usually already cached)
    try {
      const allEntities = await this.cache.getEntities();
      for (const e of allEntities) {
        if (e.LogicalName && e.EntitySetName) {
          this.#entitySetMap.set(e.LogicalName, e.EntitySetName);
        }
      }
    } catch { /* keep fallback map */ }

    container.innerHTML = '';

    const ops = this._generateOperations();
    const mode = this.#strategyStep.getMode();

    const summary = document.createElement('div');
    summary.style.cssText = 'font-size:0.82rem; margin-bottom:12px; color:var(--color-text-primary);';
    summary.innerHTML = `<strong>${ops.length}</strong> ${mode === 'upsert' ? 'PATCH (upsert)' : 'POST (create)'} operation${ops.length !== 1 ? 's' : ''} will be generated.`;
    container.appendChild(summary);

    // Preview first 5
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--color-bg-input); border:1px solid var(--color-border); border-radius:var(--radius-sm); padding:8px 10px; font-size:0.72rem; overflow:auto; max-height:250px; white-space:pre-wrap; color:var(--color-text-primary); font-family:Consolas,monospace;';
    pre.textContent = JSON.stringify(ops.slice(0, 5), null, 2);
    container.appendChild(pre);

    if (ops.length > 5) {
      const more = document.createElement('div');
      more.style.cssText = 'font-size:0.72rem; color:var(--color-text-muted); margin-top:4px;';
      more.textContent = `... and ${ops.length - 5} more`;
      container.appendChild(more);
    }
  }

  _generateOperations() {
    const selected = this.#schemaStep.getSelectedEntities();
    const data = this.#schemaStep.getData().filter(e => selected.has(e.entity));
    const schema = this.#schemaStep.getSchema();
    const mode = this.#strategyStep.getMode();

    // Use pre-loaded entitySetMap (from metadata cache); fall back to naive plural
    const entitySetMap = new Map(this.#entitySetMap);
    for (const ent of data) {
      if (!entitySetMap.has(ent.entity)) {
        entitySetMap.set(ent.entity, ent.entity + 's');
      }
    }

    return cmtRecordsToOperations(data, schema, entitySetMap, mode);
  }
}
